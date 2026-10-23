import { compressText, decompressText } from "@/lib/db/raw";
import type { LinkVaultDb } from "@/lib/db/schema";
import type { Source, SourcePart } from "@/lib/db/types";
import { adapterFor } from "@/lib/extract/adapters";
import { linksFrom, mergeExports } from "@/lib/extract/pipeline";
import type {
  DateOrder,
  Link,
  Message,
  SourceKind,
  SourceStats,
} from "@/lib/extract/types";
import { checkpoint, type ImportOptions } from "./options";
import { CHAT_KINDS, type Scan } from "./scan";

// What the dialog settled, or nothing when it didn't ask: then the scan's
// answers stand.
export interface ImportChoice {
  kind?: SourceKind;
  dateOrder?: DateOrder;
  updateOf?: string; // the source id of the scan's updateCandidate
  replaceOf?: string; // the source id of the scan's replaceCandidate
}

// What became of the input: a new source, a newer export added to a chat, a
// non-chat source replaced by a file of the same name, or a source read
// again from its stored text (§6.1, §6.4).
export type ImportHow = "new" | "updated" | "replaced" | "reextracted";

// What the result summary shows (§6.1).
export interface Imported {
  sourceId: string;
  name: string;
  how: ImportHow;
  stats: SourceStats; // the whole source's, after an update too
  newLinks: number; // links written: all of them, or an update's new ones
}

// Links written per step of the transaction, each followed by a progress
// message (§8.2).
const CHUNK = 1000;

function pastedName(at: number): string {
  const when = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(at);
  return `Pasted text, ${when}`;
}

// The texts of a source's stored parts, oldest first.
export async function storedTexts(db: LinkVaultDb, sourceId: string) {
  const parts = await db.sourceParts
    .where("sourceId")
    .equals(sourceId)
    .sortBy("importedAt");
  return Promise.all(parts.map((part) => decompressText(part.raw)));
}

// Writes a source and its links in one transaction (§8.2), so a cancel, a
// closed tab or a full disk leaves the library as it was. An update adds only
// links whose ids are new and leaves stored ones alone; a replace swaps the
// source's parts and links for the new file's; a re-extract rewrites its
// links and keeps its parts. Returns the links written.
export async function writeSource(
  db: LinkVaultDb,
  write: {
    source: Source;
    part?: SourcePart;
    links: Link[];
    how: ImportHow;
  },
  { onProgress, signal }: ImportOptions = {},
): Promise<number> {
  const { source, part, links, how } = write;
  let written = 0;
  await db.transaction("rw", db.sources, db.sourceParts, db.links, async () => {
    let added = links;
    if (how === "updated") {
      const stored = new Set(
        await db.links.where("sourceId").equals(source.id).primaryKeys(),
      );
      added = links.filter((link) => !stored.has(link.id));
    }
    // A rewrite deletes only the links that are gone and puts the rest over
    // their stored selves: ids carry the source and the message (§5), so most
    // come back. Deleting them all first made a 98 k-link re-extract take
    // 10.9 s instead of 7.5 s.
    const rewrite = how === "replaced" || how === "reextracted";
    if (rewrite) {
      const kept = new Set(links.map((link) => link.id));
      const stored = await db.links
        .where("sourceId")
        .equals(source.id)
        .primaryKeys();
      await db.links.bulkDelete(stored.filter((id) => !kept.has(id)));
    }
    if (how === "replaced") {
      await db.sourceParts.where("sourceId").equals(source.id).delete();
    }
    written = added.length;
    await db.sources.put(source);
    if (part) await db.sourceParts.add(part);

    onProgress?.({ phase: "saving", done: 0, total: added.length });
    for (let done = 0; done < added.length;) {
      signal?.throwIfAborted();
      const chunk = added.slice(done, done + CHUNK);
      await (rewrite ? db.links.bulkPut(chunk) : db.links.bulkAdd(chunk));
      done += chunk.length;
      onProgress?.({ phase: "saving", done, total: added.length });
    }
    // Throwing aborts the transaction, so a cancel that arrives with the last
    // chunk still leaves nothing behind.
    signal?.throwIfAborted();
  });
  return written;
}

// The save pass (PRD §6.1, §8.2): parse and extract in memory, then write the
// source, its part and its links in one transaction (writeSource).
//
// An update parses the chat's stored parts too and merges their messages by
// key, so the stats count every message and link the source now holds,
// including those the newer export lacks. It writes only links whose ids are
// new and leaves the stored ones alone.
export async function saveImport(
  db: LinkVaultDb,
  scan: Scan,
  choice: ImportChoice = {},
  options: ImportOptions = {},
): Promise<Imported> {
  const { onProgress, signal } = options;
  const { result } = scan;
  const now = Date.now();
  const targetId = choice.updateOf ?? choice.replaceOf;
  const target =
    targetId === undefined ? undefined : await db.sources.get(targetId);
  if (targetId !== undefined && !target) {
    throw new Error(`There is no source ${targetId} to update or replace`);
  }
  // Only chat messages have keys to merge by; other sources are replaced.
  const updating = target !== undefined && choice.updateOf !== undefined;
  const replacing = target !== undefined && !updating;
  if (updating && !CHAT_KINDS.has(target.kind)) {
    throw new Error(`A ${target.kind} source can't take an update`);
  }
  if (replacing && CHAT_KINDS.has(target.kind)) {
    throw new Error(`A ${target.kind} source takes updates, not a replace`);
  }

  const kind = updating ? target.kind : (choice.kind ?? result.detection.kind);
  // An update keeps the source's order, so its keys match the stored ones.
  const dateOrder =
    kind === "whatsapp"
      ? ((updating ? target.options.dateOrder : undefined) ??
        choice.dateOrder ??
        result.dateOrder ??
        "DMY")
      : undefined;
  const parse = (text: string): Message[] =>
    adapterFor(kind).parse({ text }, { dateOrder });

  onProgress?.({ phase: "parsing" });
  const messages = updating
    ? mergeExports([
        ...(await storedTexts(db, target.id)).map(parse),
        parse(scan.text),
      ])
    : parse(scan.text);
  await checkpoint(signal);

  onProgress?.({ phase: "extracting" });
  const sourceId = target?.id ?? crypto.randomUUID();
  const { links, stats } = linksFrom(messages, sourceId, options);
  // Before the transaction: it would commit while waiting on anything but
  // IndexedDB.
  const raw = await compressText(scan.text);
  await checkpoint(signal);

  const source: Source = updating
    ? { ...target, updatedAt: now, stats }
    : replacing
      ? {
          ...target,
          kind,
          adapterVersion: adapterFor(kind).version,
          updatedAt: now,
          stats,
          options: dateOrder ? { dateOrder } : {},
        }
      : {
          id: sourceId,
          name: result.chatName ?? result.fileName ?? pastedName(now),
          kind,
          adapterVersion: adapterFor(kind).version,
          importedAt: now,
          updatedAt: now,
          stats,
          options: dateOrder ? { dateOrder } : {},
        };
  const part: SourcePart = {
    id: crypto.randomUUID(),
    sourceId,
    importedAt: now,
    byteSize: result.byteSize,
    contentHash: result.contentHash,
    raw,
  };
  if (result.fileName !== undefined) part.fileName = result.fileName;

  const how: ImportHow = updating ? "updated" : replacing ? "replaced" : "new";
  const newLinks = await writeSource(db, { source, part, links, how }, options);
  return { sourceId, name: source.name, how, stats, newLinks };
}
