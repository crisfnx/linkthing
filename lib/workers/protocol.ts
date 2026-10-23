// Messages between the UI and the extraction worker (PRD §8.2).
import type { InputError } from "@/lib/extract/input";
import type { ImportProgress } from "@/lib/import/options";
import type { ReextractChoice } from "@/lib/import/reextract";
import type { Imported, ImportChoice } from "@/lib/import/save";
import type { ScanInput, ScanResult } from "@/lib/import/scan";
import type { LibraryRows } from "@/lib/library/rows";

// One import at a time: start imports the last scan, reextract reads a
// stored source again (§6.4), and cancel stops whichever is running. Cancel gets no reply of its own; the
// request it stops replies with the code "cancelled". Load reads the library
// as rows (§5) and delete removes a source with its links (§6.4); both can run
// beside an import, and a cancel touches neither.
export type WorkerRequest =
  | { id: number; type: "ping" }
  | { id: number; type: "scan"; input: ScanInput }
  | { id: number; type: "start"; choice: ImportChoice }
  | {
      id: number;
      type: "reextract";
      sourceId: string;
      choice: ReextractChoice;
    }
  | { id: number; type: "cancel" }
  | { id: number; type: "load" }
  | { id: number; type: "delete"; sourceId: string };

// "unexpected" covers anything without its own message in the UI yet, such
// as a database error.
export type WorkerErrorCode =
  InputError["code"] | "cancelled" | "quota-exceeded" | "unexpected";

export type WorkerResponse =
  | { id: number; type: "pong" }
  | { id: number; type: "progress"; progress: ImportProgress }
  | { id: number; type: "scanned"; scan: ScanResult }
  | { id: number; type: "done"; imported: Imported }
  | { id: number; type: "rows"; rows: LibraryRows }
  | { id: number; type: "deleted"; links: number }
  | { id: number; type: "error"; code: WorkerErrorCode; message: string };
