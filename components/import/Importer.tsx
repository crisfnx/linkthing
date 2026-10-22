"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useImport, type Decide, type ImportState } from "@/hooks/useImport";
import type { ImportChoice } from "@/lib/import/save";
import type { ScanResult } from "@/lib/import/scan";
import { strings } from "@/lib/strings";
import type { ExtractClient } from "@/lib/workers/client";
import type { WorkerErrorCode } from "@/lib/workers/protocol";
import { DropZone } from "./DropZone";
import { ImportDialog } from "./ImportDialog";
import { ImportForm } from "./ImportForm";
import { ImportProgress } from "./ImportProgress";
import { ImportSummary } from "./ImportSummary";

interface Props {
  connect: () => ExtractClient; // the page's worker (useExtractClient)
  empty?: boolean; // the library has no sources: offer the sample data
  children?: ReactNode;
}

// Failures that may not happen twice. A zip without a chat, or a damaged
// one, fails the same way again: its message says what to do instead.
const RETRYABLE: ReadonlySet<WorkerErrorCode> = new Set([
  "quota-exceeded",
  "unexpected",
]);

// What a screen reader hears: each phase as it starts, then the outcome.
function announcement(state: ImportState): string {
  switch (state.status) {
    case "running":
      return strings.phaseStatus(state.progress.phase);
    case "done":
      return strings.imported(state.results.length);
    case "cancelled":
      return strings.cancelled;
    default:
      return "";
  }
}

// The first screen (M2): drop, pick or paste, watch the progress, read the
// summary. Browsing the links arrives with M3.
export function Importer({ connect, empty = false, children }: Props) {
  // The question the dialog is asking, and where its answer goes.
  const [asking, setAsking] = useState<{
    scan: ScanResult;
    answer: (choice: ImportChoice | null) => void;
  } | null>(null);
  const decide: Decide = (scan) =>
    scan.questions.length === 0
      ? {}
      : new Promise((answer) => setAsking({ scan, answer }));

  const { state, importFiles, importText, cancel, retry } = useImport({
    connect,
    decide,
  });
  const running = state.status === "running";
  const results = "results" in state ? state.results : [];

  // Cancel goes with the progress bar, and the sample button once the library
  // has a source, in whichever order the two arrive. If either had focus, put
  // it back on "Choose files" rather than leave the keyboard user nowhere.
  const chooseFiles = useRef<HTMLButtonElement>(null);
  const before = useRef({ running, empty });
  useEffect(() => {
    const gone =
      (before.current.running && !running) || (before.current.empty && !empty);
    if (gone && document.activeElement === document.body) {
      chooseFiles.current?.focus();
    }
    before.current = { running, empty };
  }, [running, empty]);

  return (
    <DropZone disabled={running} onFiles={importFiles} onText={importText}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">{strings.appName}</h1>
          <p className="text-lg">{strings.tagline}</p>
          <p className="text-sm opacity-70">{strings.privacy}</p>
        </header>

        <ImportForm
          ref={chooseFiles}
          busy={running}
          sample={empty}
          onFiles={importFiles}
          onText={importText}
        />

        <p role="status" className="sr-only">
          {announcement(state)}
        </p>
        {state.status === "running" && (
          <ImportProgress
            label={state.label}
            size={state.size}
            progress={state.progress}
            remaining={state.remaining}
            onCancel={cancel}
          />
        )}
        {asking && (
          <ImportDialog
            scan={asking.scan}
            onDecide={(choice) => {
              setAsking(null);
              asking.answer(choice);
            }}
          />
        )}
        {state.status === "cancelled" && <p>{strings.cancelled}</p>}
        {state.status === "done" && state.results.length === 0 && (
          <p>{strings.imported(0)}</p>
        )}
        {state.status === "failed" && (
          <div role="alert" className="flex flex-col gap-1">
            <p>{strings.errors[state.code](state.label)}</p>
            {state.code === "unexpected" && (
              <p className="font-mono text-sm opacity-70">{state.message}</p>
            )}
            {RETRYABLE.has(state.code) && (
              <div>
                <button
                  type="button"
                  className="rounded-md border border-current px-3 py-1.5 font-medium"
                  onClick={retry}
                >
                  {strings.tryAgain}
                </button>
              </div>
            )}
          </div>
        )}
        {results.length > 0 && <ImportSummary results={results} />}

        {children}
      </main>
    </DropZone>
  );
}
