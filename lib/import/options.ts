import type { ExtractOptions } from "@/lib/extract/url/extract";

// The progress bar's phases (PRD §6.1). Reading and scanning belong to the
// scan pass, the rest to the save pass.
export type ImportPhase =
  "reading" | "scanning" | "parsing" | "extracting" | "saving";

// Saving counts the links written. The other phases are one synchronous step
// each, so they only report that they started.
export interface ImportProgress {
  phase: ImportPhase;
  done?: number;
  total?: number;
}

export interface ImportOptions extends ExtractOptions {
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
}

// Lets a queued cancel message through between long synchronous steps, then
// stops if it asked to.
export async function checkpoint(signal: AbortSignal | undefined) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  signal?.throwIfAborted();
}
