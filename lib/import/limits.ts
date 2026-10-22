import type { ScanInput } from "./scan";

// How much one import may be (PRD §6.1, §9), in megabytes as file managers
// count them. Above the warning size an import still runs, but takes a while:
// a 100 MB chat of little but links holds about a million, and Chrome takes a
// minute and a half to save them.
export const MAX_INPUT_BYTES = 100_000_000;
export const LARGE_INPUT_BYTES = 25_000_000;

// A file's size, known before it is read. Pasted text counts its characters,
// which is close enough for a limit.
export function inputSize(input: ScanInput): number {
  return "text" in input ? input.text.length : input.file.size;
}
