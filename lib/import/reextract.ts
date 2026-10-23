// Re-extract (PRD §6.4): a source read again from the text it keeps, with
// the current adapter, or with another adapter or day/month order when the
// first reading was wrong.
import type { LinkVaultDb } from "@/lib/db/schema";
import type { Source } from "@/lib/db/types";
import { adapterFor } from "@/lib/extract/adapters";
import { linksFrom, mergeExports } from "@/lib/extract/pipeline";
import type { DateOrder, Message, SourceKind } from "@/lib/extract/types";
import { checkpoint, type ImportOptions } from "./options";
import { storedTexts, writeSource, type Imported } from "./save";
import { CHAT_KINDS } from "./scan";

export interface ReextractChoice {
  kind?: SourceKind; // how to read it; the source's own kind by default
  dateOrder?: DateOrder; // for a chat; the source's own order by default
}

// Every stored part is parsed again, a chat's merged by message key as an
// update merges them (§6.1), and the source's links are rewritten in one
// transaction: a cancel or a failure leaves them as they were. Stars and
// other annotations stay, keyed by urlKey (§4.4).
export async function reextractSource(
  db: LinkVaultDb,
  sourceId: string,
  choice: ReextractChoice = {},
  options: ImportOptions = {},
): Promise<Imported> {
  const { onProgress, signal } = options;
  onProgress?.({ phase: "reading" });
  const source = await db.sources.get(sourceId);
  if (!source) throw new Error(`No source ${sourceId}`);
  // Read before the transaction: it would commit while waiting on anything
  // but IndexedDB.
  const texts = await storedTexts(db, sourceId);
  await checkpoint(signal);

  const kind = choice.kind ?? source.kind;
  // Only chat messages have keys to merge several exports by.
  if (texts.length > 1 && !CHAT_KINDS.has(kind)) {
    throw new Error(`A source of ${texts.length} exports is read as a chat`);
  }
  const dateOrder =
    kind === "whatsapp"
      ? (choice.dateOrder ?? source.options.dateOrder ?? "DMY")
      : undefined;
  const parse = (text: string): Message[] =>
    adapterFor(kind).parse({ text }, { dateOrder });

  onProgress?.({ phase: "parsing" });
  const messages = CHAT_KINDS.has(kind)
    ? mergeExports(texts.map(parse))
    : parse(texts[0] ?? "");
  await checkpoint(signal);

  onProgress?.({ phase: "extracting" });
  const { links, stats } = linksFrom(messages, sourceId, options);
  await checkpoint(signal);

  const reread: Source = {
    ...source,
    kind,
    adapterVersion: adapterFor(kind).version,
    updatedAt: Date.now(),
    stats,
    options: dateOrder ? { dateOrder } : {},
  };
  const newLinks = await writeSource(
    db,
    { source: reread, links, how: "reextracted" },
    options,
  );
  return { sourceId, name: source.name, how: "reextracted", stats, newLinks };
}
