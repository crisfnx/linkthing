import type { LinkVaultDb } from "@/lib/db/schema";
import { detectAdapter, type Detection } from "@/lib/extract/adapters";
import { scanWhatsApp } from "@/lib/extract/adapters/whatsapp";
import {
  InputError,
  prepareFile,
  preparePaste,
  type PreparedInput,
} from "@/lib/extract/input";
import { sha256 } from "@/lib/extract/keys";
import { linkCounts, linkIdsFor, type LinkCount } from "@/lib/extract/pipeline";
import type { DateOrder, SourceKind } from "@/lib/extract/types";
import type { ExtractOptions } from "@/lib/extract/url/extract";
import { inputSize, MAX_INPUT_BYTES } from "./limits";
import { checkpoint, type ImportOptions } from "./options";

export type ScanInput = { file: File } | { text: string };

// What the import dialog may have to settle before the parse (PRD §6.1). An
// empty list means the parse starts straight away.
export type Question = "adapter" | "date-order" | "duplicate" | "update";

export interface DuplicateOf {
  sourceId: string;
  sourceName: string;
  importedAt: number; // when this file was imported ("on 12 Aug")
}

export interface UpdateCandidate {
  sourceId: string;
  sourceName: string;
  newLinks: number; // links the update would add
}

export interface ScanResult {
  fileName?: string; // as dropped or picked; none for pasted text
  chatName?: string;
  encoding: PreparedInput["encoding"]; // windows-1252 means the import warns
  byteSize: number; // the decoded text as UTF-8, before compression
  contentHash: string;
  detection: Detection;
  // When the text reads as WhatsApp: the day/month order its dates settle.
  // Ambiguous when every date fits both, and the dialog asks.
  dateOrder?: DateOrder;
  dateOrderAmbiguous: boolean;
  // When it is: the chat's last date as written, read both ways (local
  // midnight), for the dialog to show.
  dateSample?: { written: string; dayFirst: number; monthFirst: number };
  duplicateOf?: DuplicateOf;
  updateCandidate?: UpdateCandidate;
  questions: Question[];
}

export interface Scan {
  text: string; // prepared; the worker keeps it for the parse
  result: ScanResult;
}

// Chat sources take a newer export as an update (§6.1). Telegram joins them in
// Phase 1.5.
export const CHAT_KINDS: ReadonlySet<SourceKind> = new Set(["whatsapp"]);

// A chat sharing at least this much of the smaller set of links is offered as
// an update (§6.1). update-older and update-newer share 14 of 17.
const UPDATE_OVERLAP = 0.5;

// The kind the import will use, or offer when detection is unsure (§3), so
// the scan can answer for it too.
export function likelyKind(detection: Detection): SourceKind {
  if (!detection.needsConfirmation) return detection.kind;
  const offered = detection.scores.find((s) => s.kind !== "plaintext");
  return offered?.kind ?? detection.kind;
}

// Too large is refused before reading, so a zip full of media isn't loaded
// into memory only to be turned away.
async function readInput(
  input: ScanInput,
): Promise<{ text: string } | { bytes: Uint8Array; name: string }> {
  if (inputSize(input) > MAX_INPUT_BYTES) throw new InputError("too-large");
  if ("text" in input) return { text: input.text };
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  return { bytes, name: input.file.name };
}

// Size and hash of the text as UTF-8. Its own function, so a 100 MB copy of
// the text isn't held through the rest of the scan.
async function measure(text: string) {
  const bytes = new TextEncoder().encode(text);
  return { byteSize: bytes.byteLength, contentHash: await sha256(bytes) };
}

// The latest import of the same file, if there was one.
async function findDuplicate(
  db: LinkVaultDb,
  contentHash: string,
): Promise<DuplicateOf | undefined> {
  const parts = await db.sourceParts
    .where("contentHash")
    .equals(contentHash)
    .reverse()
    .sortBy("importedAt");
  const latest = parts[0];
  const source = latest && (await db.sources.get(latest.sourceId));
  if (!latest || !source) return undefined;
  return {
    sourceId: source.id,
    sourceName: source.name,
    importedAt: latest.importedAt,
  };
}

// A stored chat this text is a newer export of (§6.1). The ids its links
// would get in that chat, keyed with the chat's own day/month order, are
// compared with the ids stored there. Reading ids takes only the sourceId
// index; message keys would mean reading every stored link.
async function findUpdate(
  db: LinkVaultDb,
  text: string,
  kind: SourceKind,
  options: ExtractOptions,
): Promise<UpdateCandidate | undefined> {
  const chats = await db.sources.filter((s) => s.kind === kind).toArray();
  const countsByOrder = new Map<DateOrder | undefined, LinkCount[]>();
  let best: { candidate: UpdateCandidate; overlap: number } | undefined;

  for (const chat of chats) {
    const { dateOrder } = chat.options;
    let counts = countsByOrder.get(dateOrder);
    if (!counts) {
      counts = linkCounts(text, kind, { ...options, dateOrder });
      countsByOrder.set(dateOrder, counts);
    }
    const ids = linkIdsFor(chat.id, counts);
    const stored = new Set(
      await db.links.where("sourceId").equals(chat.id).primaryKeys(),
    );
    const smaller = Math.min(ids.length, stored.size);
    if (smaller === 0) continue;

    const shared = ids.filter((id) => stored.has(id)).length;
    const overlap = shared / smaller;
    if (overlap >= UPDATE_OVERLAP && overlap > (best?.overlap ?? 0)) {
      best = {
        candidate: {
          sourceId: chat.id,
          sourceName: chat.name,
          newLinks: ids.length - shared,
        },
        overlap,
      };
    }
  }
  return best?.candidate;
}

function questionsFor(result: ScanResult): Question[] {
  const questions: Question[] = [];
  if (result.detection.needsConfirmation) questions.push("adapter");
  if (result.dateOrderAmbiguous) questions.push("date-order");
  if (result.duplicateOf) questions.push("duplicate");
  if (result.updateCandidate) questions.push("update");
  return questions;
}

// The scan pass (PRD §6.1): reads the whole input once and finds out whether
// the import dialog has to ask anything before the parse. A file imported
// before isn't also offered as an update: it would add nothing.
export async function scanInput(
  db: LinkVaultDb,
  input: ScanInput,
  options: ImportOptions = {},
): Promise<Scan> {
  const { onProgress, signal } = options;
  onProgress?.({ phase: "reading" });
  const read = await readInput(input);
  await checkpoint(signal);

  onProgress?.({ phase: "scanning" });
  const prepared =
    "bytes" in read
      ? prepareFile(read.bytes, read.name)
      : preparePaste(read.text);
  const { text } = prepared;
  const detection = detectAdapter({ text, fileName: prepared.fileName });
  const kind = likelyKind(detection);

  const result: ScanResult = {
    encoding: prepared.encoding,
    ...(await measure(text)),
    detection,
    dateOrderAmbiguous: false,
    questions: [],
  };
  if ("file" in input) result.fileName = input.file.name;
  if (prepared.chatName !== undefined) result.chatName = prepared.chatName;

  if (kind === "whatsapp") {
    const { dateOrder, lastDate } = scanWhatsApp(text);
    if (dateOrder) result.dateOrder = dateOrder;
    else result.dateOrderAmbiguous = true;
    if (lastDate) {
      const { written, a, b, c } = lastDate;
      const year = c < 100 ? 2000 + c : c;
      result.dateSample = {
        written,
        dayFirst: new Date(year, b - 1, a).getTime(),
        monthFirst: new Date(year, a - 1, b).getTime(),
      };
    }
  }

  await checkpoint(signal);
  const duplicateOf = await findDuplicate(db, result.contentHash);
  if (duplicateOf) result.duplicateOf = duplicateOf;
  else if (CHAT_KINDS.has(kind)) {
    const update = await findUpdate(db, text, kind, options);
    if (update) result.updateCandidate = update;
  }

  result.questions = questionsFor(result);
  return { text, result };
}
