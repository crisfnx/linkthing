import { compressText, decompressText } from "@/lib/db/raw";
import type { LinkVaultDb } from "@/lib/db/schema";
import type { Source, SourcePart } from "@/lib/db/types";
import { adapterFor } from "@/lib/extract/adapters";
import { linksFrom, mergeExports } from "@/lib/extract/pipeline";
import type {
  DateOrder,
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
}

export interface Imported {
  sourceId: string;
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
async function storedTexts(db: LinkVaultDb, sourceId: string) {
  const parts = await db.sourceParts
    .where("sourceId")
    .equals(sourceId)
    .sortBy("importedAt");
  return Promise.all(parts.map((part) => decompressText(part.raw)));
}

// The save pass (PRD §6.1, §8.2): parse and extract in memory, then write the
// source, its part and its links in one transaction, so a cancel, a closed
// tab or a full disk leaves nothing behind.
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
  const target =
    choice.updateOf === undefined
      ? undefined
      : await db.sources.get(choice.updateOf);
  if (choice.updateOf !== undefined && !target) {
    throw new Error(`There is no source ${choice.updateOf} to update`);
  }
  // Only chat messages have keys to merge by; other sources get Replace (M4).
  if (target && !CHAT_KINDS.has(target.kind)) {
    throw new Error(`A ${target.kind} source can't take an update`);
  }

  const kind = target?.kind ?? choice.kind ?? result.detection.kind;
  // An update keeps the source's order, so its keys match the stored ones.
  const dateOrder =
    kind === "whatsapp"
      ? (target?.options.dateOrder ??
        choice.dateOrder ??
        result.dateOrder ??
        "DMY")
      : undefined;
  const parse = (text: string): Message[] =>
    adapterFor(kind).parse({ text }, { dateOrder });

  onProgress?.({ phase: "parsing" });
  const messages = target
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

  const source: Source = target
    ? { ...target, updatedAt: now, stats }
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

  let newLinks = 0;
  await db.transaction("rw", db.sources, db.sourceParts, db.links, async () => {
    const stored = new Set(
      target
        ? await db.links.where("sourceId").equals(sourceId).primaryKeys()
        : [],
    );
    const added = links.filter((link) => !stored.has(link.id));
    newLinks = added.length;
    await db.sources.put(source);
    await db.sourceParts.add(part);

    onProgress?.({ phase: "saving", done: 0, total: added.length });
    for (let done = 0; done < added.length;) {
      signal?.throwIfAborted();
      const chunk = added.slice(done, done + CHUNK);
      await db.links.bulkAdd(chunk);
      done += chunk.length;
      onProgress?.({ phase: "saving", done, total: added.length });
    }
    // Throwing aborts the transaction, so a cancel that arrives with the last
    // chunk still leaves nothing behind.
    signal?.throwIfAborted();
  });

  return { sourceId, stats, newLinks };
}
