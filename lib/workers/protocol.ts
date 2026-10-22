// Messages between the UI and the extraction worker (PRD §8.2). Load arrives
// with M3.
import type { InputError } from "@/lib/extract/input";
import type { ImportProgress } from "@/lib/import/options";
import type { Imported, ImportChoice } from "@/lib/import/save";
import type { ScanInput, ScanResult } from "@/lib/import/scan";

// One import at a time: start imports the last scan, and cancel stops
// whichever of the two is running. Cancel gets no reply of its own; the
// request it stops replies with the code "cancelled".
export type WorkerRequest =
  | { id: number; type: "ping" }
  | { id: number; type: "scan"; input: ScanInput }
  | { id: number; type: "start"; choice: ImportChoice }
  | { id: number; type: "cancel" };

// "unexpected" covers anything without its own message in the UI yet, such
// as a corrupt zip or a database error.
export type WorkerErrorCode =
  InputError["code"] | "cancelled" | "quota-exceeded" | "unexpected";

export type WorkerResponse =
  | { id: number; type: "pong" }
  | { id: number; type: "progress"; progress: ImportProgress }
  | { id: number; type: "scanned"; scan: ScanResult }
  | { id: number; type: "done"; imported: Imported }
  | { id: number; type: "error"; code: WorkerErrorCode; message: string };
