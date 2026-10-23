// Restoring a backup, in the worker (PRD §6.5). The whole file is read and
// every line checked against a schema before anything is written; then one
// transaction adds what's missing. A restore merges, never replaces: a source
// already here, by id or by the same content, is left as it is, so restoring
// the same backup twice changes nothing. Stars and tags merge as a re-key
// merges them. Loaded only when restoring, with zod.
import { z } from "zod";
import type { LinkVaultDb } from "@/lib/db/schema";
import { compressText } from "@/lib/db/raw";
import type {
  Annotation,
  Source,
  SourcePart,
  StoredSettings,
} from "@/lib/db/types";
import { LINK_KINDS, type Link } from "@/lib/extract/types";
import { checkpoint, type ImportOptions } from "@/lib/import/options";
import {
  mergeAnnotations,
  rekeyIfNeeded,
  type Canonicalizer,
} from "@/lib/library/rekey";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type Backup,
  type BackupCounts,
  type BackupPart,
} from "./format";

// A file that can't be restored, and why, for the person restoring it.
export class BackupError extends Error {
  readonly code = "invalid-backup";
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

// --- Schemas ----------------------------------------------------------------------

const time = z.number().finite();
const count = z.number().int().nonnegative();
const DATE_ORDERS = ["DMY", "MDY", "YMD"] as const;
const SOURCE_KINDS = [
  "plaintext",
  "whatsapp",
  "markdown",
  "netscape",
  "html",
  "telegram-json",
] as const;

const header = z.object({
  linkvault: z.literal(BACKUP_FORMAT),
  version: count,
  exportedAt: time,
  canonicalizerVersion: count,
  counts: z.object({
    sources: count,
    parts: count,
    links: count,
    annotations: count,
  }),
});

const source = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(SOURCE_KINDS),
  adapterVersion: count,
  importedAt: time,
  updatedAt: time,
  stats: z.object({
    messages: count,
    links: count,
    uniqueLinks: count,
    domains: count,
    skippedNonWeb: count,
    earliest: time.optional(),
    latest: time.optional(),
  }),
  options: z.object({ dateOrder: z.enum(DATE_ORDERS).optional() }),
}) satisfies z.ZodType<Source>;

const part = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  fileName: z.string().optional(),
  importedAt: time,
  byteSize: count,
  contentHash: z.string().min(1),
  text: z.string(),
}) satisfies z.ZodType<BackupPart>;

const link = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  messageKey: z.string().optional(),
  url: z.string().min(1),
  canonicalUrl: z.string().min(1),
  urlKey: z.string().min(1),
  host: z.string(),
  domain: z.string(),
  path: z.string(),
  title: z.string().optional(),
  folder: z.string().optional(),
  context: z.string().optional(),
  nearby: z.string().optional(),
  timestamp: time.optional(),
  sender: z.string().optional(),
  kind: z.enum(LINK_KINDS),
  isShortened: z.boolean(),
  isBare: z.boolean().optional(),
  position: z.object({ line: count, column: count, messageIndex: count }),
}) satisfies z.ZodType<Link>;

const annotation = z.object({
  urlKey: z.string().min(1),
  url: z.string().min(1),
  starred: z.literal(1).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["unread", "read", "archived"]).optional(),
  note: z.string().optional(),
  rejectedTags: z.array(z.string()).optional(),
  updatedAt: time,
}) satisfies z.ZodType<Annotation>;

const settings = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  defaultDateOrder: z.enum(["DMY", "MDY"]).optional(),
  findBareDomains: z.boolean().optional(),
  dedupeByDefault: z.boolean().optional(),
}) satisfies z.ZodType<Omit<StoredSettings, "key">>;

// Each line is one record, named by its only key.
const record = z.union([
  z.strictObject({ settings }),
  z.strictObject({ source }),
  z.strictObject({ part }),
  z.strictObject({ link }),
  z.strictObject({ annotation }),
]);

// --- Reading ----------------------------------------------------------------------

// The file's lines, gzipped or not, read as they arrive rather than as one
// string, which a large backup would be too long for.
async function* linesOf(file: Blob): AsyncGenerator<string> {
  const start = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzipped = start[0] === 0x1f && start[1] === 0x8b;
  const bytes = gzipped
    ? file.stream().pipeThrough(new DecompressionStream("gzip"))
    : file.stream();
  const reader = bytes.pipeThrough(new TextDecoderStream()).getReader();
  let rest = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = rest + value;
      let from = 0;
      for (
        let at = text.indexOf("\n");
        at !== -1;
        at = text.indexOf("\n", from)
      ) {
        yield text.slice(from, at);
        from = at + 1;
      }
      rest = text.slice(from);
    }
  } catch {
    throw new BackupError("The file is damaged: it couldn't be decompressed.");
  }
  if (rest.trim() !== "") yield rest;
}

const formatNumber = new Intl.NumberFormat();

function problem(lineNumber: number, error: z.ZodError): BackupError {
  const first = z.prettifyError(error).split("\n").slice(0, 2).join(" ");
  return new BackupError(
    `Line ${formatNumber.format(lineNumber)} isn't a record LinkVault can read: ${first}`,
  );
}

// The whole backup, checked: its header, every record, that it holds what
// the header says (a file cut short is caught here), and that every part and
// link belongs to a source in it.
export async function readBackup(file: Blob): Promise<Backup> {
  const backup: Omit<Backup, "header"> = {
    sources: [],
    parts: [],
    links: [],
    annotations: [],
  };
  let head: Backup["header"] | undefined;
  let lineNumber = 0;
  for await (const text of linesOf(file)) {
    lineNumber++;
    if (text.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      if (!head) throw new BackupError("This isn't a LinkVault backup.");
      throw new BackupError(
        `Line ${formatNumber.format(lineNumber)} isn't valid JSON: the file may be damaged.`,
      );
    }
    if (!head) {
      const parsed = header.safeParse(json);
      if (!parsed.success) {
        throw new BackupError("This isn't a LinkVault backup.");
      }
      if (parsed.data.version > BACKUP_VERSION) {
        throw new BackupError(
          "This backup is from a newer version of LinkVault. Reload the page to update it, then try again.",
        );
      }
      head = parsed.data;
      continue;
    }
    const parsed = record.safeParse(json);
    if (!parsed.success) throw problem(lineNumber, parsed.error);
    const data = parsed.data;
    if ("settings" in data) backup.settings = data.settings;
    else if ("source" in data) backup.sources.push(data.source);
    else if ("part" in data) backup.parts.push(data.part);
    else if ("link" in data) backup.links.push(data.link);
    else backup.annotations.push(data.annotation);
  }
  if (!head) throw new BackupError("This file is empty.");

  const found: BackupCounts = {
    sources: backup.sources.length,
    parts: backup.parts.length,
    links: backup.links.length,
    annotations: backup.annotations.length,
  };
  for (const key of Object.keys(found) as (keyof BackupCounts)[]) {
    if (found[key] !== head.counts[key]) {
      throw new BackupError(
        "The backup is incomplete: it holds less than it says, as if the download was cut short.",
      );
    }
  }
  const ids = new Set(backup.sources.map((s) => s.id));
  if (![...backup.parts, ...backup.links].every((r) => ids.has(r.sourceId))) {
    throw new BackupError(
      "The backup doesn't hold together: some links belong to no source in it.",
    );
  }
  return { header: head, ...backup };
}

// --- Restoring --------------------------------------------------------------------

export interface Restored {
  sources: number; // added
  links: number; // added
  stars: number; // starred links added or merged
  alreadyHere: number; // sources left as they were
}

const CHUNK = 1000;

export async function restoreBackup(
  db: LinkVaultDb,
  file: Blob,
  options: ImportOptions & { canonicalizer?: Canonicalizer } = {},
): Promise<Restored> {
  const { onProgress, signal, canonicalizer } = options;
  onProgress?.({ phase: "reading" });
  const backup = await readBackup(file);
  await checkpoint(signal);

  // Sources already here by id, or with every part's text already stored
  // (the same chats imported again since), are left as they are.
  const [ids, hashes] = await db.transaction(
    "r",
    db.sources,
    db.sourceParts,
    async () =>
      [
        new Set(await db.sources.toCollection().primaryKeys()),
        new Set(
          (await db.sourceParts.orderBy("contentHash").keys()).map(String),
        ),
      ] as const,
  );
  const partsOf = new Map<string, Backup["parts"]>();
  for (const p of backup.parts) {
    partsOf.set(p.sourceId, [...(partsOf.get(p.sourceId) ?? []), p]);
  }
  const added = backup.sources.filter((s) => {
    const parts = partsOf.get(s.id) ?? [];
    const sameContent =
      parts.length > 0 && parts.every((p) => hashes.has(p.contentHash));
    return !ids.has(s.id) && !sameContent;
  });
  const addedIds = new Set(added.map((s) => s.id));
  const links: Link[] = backup.links.filter((l) => addedIds.has(l.sourceId));

  // Compressing waits on a stream, which would end a Dexie transaction.
  onProgress?.({ phase: "parsing" });
  const parts: SourcePart[] = await Promise.all(
    backup.parts
      .filter((p) => addedIds.has(p.sourceId))
      .map(async ({ text, ...p }) => ({ ...p, raw: await compressText(text) })),
  );
  await checkpoint(signal);

  let stars = 0;
  await db.transaction(
    "rw",
    [db.sources, db.sourceParts, db.links, db.annotations, db.settings],
    async () => {
      await db.sources.bulkAdd(added);
      await db.sourceParts.bulkAdd(parts);
      onProgress?.({ phase: "saving", done: 0, total: links.length });
      for (let done = 0; done < links.length;) {
        signal?.throwIfAborted();
        const chunk = links.slice(done, done + CHUNK);
        await db.links.bulkPut(chunk);
        done += chunk.length;
        onProgress?.({ phase: "saving", done, total: links.length });
      }

      const here = new Map(
        (
          await db.annotations.bulkGet(backup.annotations.map((a) => a.urlKey))
        ).map((a, i) => [backup.annotations[i]!.urlKey, a]),
      );
      const changed: Annotation[] = [];
      for (const theirs of backup.annotations) {
        const ours = here.get(theirs.urlKey);
        const merged = ours ? mergeAnnotations(ours, theirs) : theirs;
        if (ours && JSON.stringify(merged) === JSON.stringify(ours)) continue;
        changed.push(merged);
        if (merged.starred && !ours?.starred) stars++;
      }
      await db.annotations.bulkPut(changed);

      // Settings come back only to a browser that has none: a restore
      // doesn't undo choices made here since.
      if (backup.settings && !(await db.settings.get("settings"))) {
        await db.settings.put({ ...backup.settings, key: "settings" });
      }
      // Keys from another canonicalizer version are brought up to date by
      // the re-key below, which starts from the backup's version.
      if (
        canonicalizer &&
        backup.header.canonicalizerVersion !== canonicalizer.version
      ) {
        await db.settings.put({
          key: "meta",
          canonicalizerVersion: backup.header.canonicalizerVersion,
        });
      }
      signal?.throwIfAborted();
    },
  );
  if (canonicalizer) await rekeyIfNeeded(db, canonicalizer);

  return {
    sources: added.length,
    links: links.length,
    stars,
    alreadyHere: backup.sources.length - added.length,
  };
}
