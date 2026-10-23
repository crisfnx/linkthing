"use client";

import { createContext } from "react";
import type { ReextractChoice } from "@/lib/import/reextract";

// What the library needs from the import flow, which the Importer owns: one
// job at a time, imports and re-extracts alike, with one progress bar,
// cancel and summary (§6.4). Several sources are read again one after
// another, as a Settings change needs.
export interface ImportFlow {
  reextract: (
    sources: readonly { id: string; name: string }[],
    choice: ReextractChoice,
  ) => void;
  busy: boolean; // a job is running; another can't start
}

export const ImportFlowContext = createContext<ImportFlow | null>(null);
