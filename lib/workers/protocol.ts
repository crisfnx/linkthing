// Messages between the UI and the extraction worker (PRD §8.2). Start,
// progress, done, cancel and load arrive with the pieces of M2 and M3 that
// need them.
import type { InputError } from "@/lib/extract/input";
import type { ScanInput, ScanResult } from "@/lib/import/scan";

export type WorkerRequest =
  { id: number; type: "ping" } | { id: number; type: "scan"; input: ScanInput };

// "unexpected" covers anything without its own message in the UI yet, such
// as a corrupt zip or a database error.
export type WorkerErrorCode = InputError["code"] | "unexpected";

export type WorkerResponse =
  | { id: number; type: "pong" }
  | { id: number; type: "scanned"; scan: ScanResult }
  | { id: number; type: "error"; code: WorkerErrorCode; message: string };
