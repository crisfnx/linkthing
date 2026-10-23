"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DownloadBackup, RestoreBackup } from "@/components/backup/Backup";
import { useImport, type Decide, type ImportState } from "@/hooks/useImport";
import type { DateOrder } from "@/lib/extract/types";
import type { ImportChoice } from "@/lib/import/save";
import type { ScanResult } from "@/lib/import/scan";
import { strings } from "@/lib/strings";
import type { ExtractClient } from "@/lib/workers/client";
import type { WorkerErrorCode } from "@/lib/workers/protocol";
import { DropZone } from "./DropZone";
import { ImportFlowContext } from "./ImportFlow";
import { ImportDialog } from "./ImportDialog";
import { ImportForm } from "./ImportForm";
import { ImportPanel } from "./ImportPanel";
import { ImportProgress } from "./ImportProgress";
import { ImportSummary } from "./ImportSummary";

interface Props {
  connect: () => ExtractClient; // the page's worker (useExtractClient)
  empty?: boolean; // the library has no sources: offer the sample data
  // The library has links: the list takes the page (children), and the ways
  // in move behind an Import button.
  library?: boolean;
  actions?: ReactNode; // the library's header, before Import: Settings
  // The dialog's answer for dates that fit both orders (Settings, §6.7).
  defaultDateOrder?: DateOrder;
  children?: ReactNode;
}

const button = "rounded-md border border-current px-3 py-1.5 font-medium";

// An import adding this many links is worth a backup (§15): the library
// lives only in this browser.
const BACKUP_NUDGE = 1000;

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

// Owns the import flow on either screen. The first screen (M2): drop, pick
// or paste, watch the progress, read the summary. The library (M3): a header
// with an Import button, the progress and summary above the list.
export function Importer({
  connect,
  empty = false,
  library = false,
  actions,
  defaultDateOrder,
  children,
}: Props) {
  // The question the dialog is asking, and where its answer goes.
  const [asking, setAsking] = useState<{
    scan: ScanResult;
    answer: (choice: ImportChoice | null) => void;
  } | null>(null);
  const decide: Decide = (scan) =>
    scan.questions.length === 0
      ? {}
      : new Promise((answer) => setAsking({ scan, answer }));

  const { state, importFiles, importText, reextract, cancel, retry, dismiss } =
    useImport({ connect, decide });
  const running = state.status === "running";
  // A restore from the first screen: imports wait for it, and it for them.
  const [restoring, setRestoring] = useState(false);
  const results = "results" in state ? state.results : [];
  const added = results.reduce(
    (sum, result) => sum + (result.how === "reextracted" ? 0 : result.newLinks),
    0,
  );
  const [panelOpen, setPanelOpen] = useState(false);

  // Cancel goes with the progress bar, the sample button once the library
  // has a source, and the whole first screen once it has links, in whichever
  // order these arrive. If what went had focus, put it on "Choose files", or
  // on Import in the library, rather than leave the keyboard user nowhere.
  const returnFocus = useRef<HTMLButtonElement>(null);
  const before = useRef({ running, empty, library });
  useEffect(() => {
    const gone =
      (before.current.running && !running) ||
      (before.current.empty && !empty) ||
      before.current.library !== library;
    if (gone && document.activeElement === document.body) {
      returnFocus.current?.focus();
    }
    before.current = { running, empty, library };
  }, [running, empty, library]);

  const announced = (
    <p role="status" className="sr-only">
      {announcement(state)}
    </p>
  );
  const outcome = (
    <>
      {state.status === "running" && (
        <ImportProgress
          job={state.job}
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
          defaultDateOrder={defaultDateOrder}
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
          <p>
            {state.job === "reextract" && state.code === "unexpected"
              ? strings.reextractFailed(state.label)
              : strings.errors[state.code](state.label)}
          </p>
          {state.code === "unexpected" && (
            <p className="font-mono text-sm opacity-70">{state.message}</p>
          )}
          {RETRYABLE.has(state.code) && (
            <div>
              <button type="button" className={button} onClick={retry}>
                {strings.tryAgain}
              </button>
            </div>
          )}
        </div>
      )}
      {results.length > 0 && <ImportSummary results={results} />}
      {!running && added >= BACKUP_NUDGE && (
        <div className="flex flex-col items-start gap-2">
          <p>{strings.backup.nudge}</p>
          <DownloadBackup connect={connect} />
        </div>
      )}
    </>
  );

  if (library) {
    const finished = !running && state.status !== "idle";
    return (
      <DropZone disabled={running} onFiles={importFiles} onText={importText}>
        <ImportFlowContext
          value={{
            busy: running,
            reextract: (sources, choice) => void reextract(sources, choice),
          }}
        >
          <div className="flex h-dvh flex-col">
            <header className="flex items-center justify-between gap-4 border-b border-current/15 px-4 py-3">
              <h1 className="text-xl font-bold">{strings.appName}</h1>
              <div className="flex items-center gap-2">
                {actions}
                <button
                  ref={returnFocus}
                  type="button"
                  className={`${button} aria-disabled:opacity-50`}
                  aria-disabled={running}
                  onClick={() => {
                    if (!running) setPanelOpen(true);
                  }}
                >
                  {strings.importButton}
                </button>
              </div>
            </header>
            {panelOpen && (
              <ImportPanel
                busy={running}
                onFiles={importFiles}
                onText={importText}
                onClose={() => setPanelOpen(false)}
              />
            )}
            {announced}
            {state.status !== "idle" && (
              <div className="flex max-h-[40dvh] shrink-0 flex-col gap-4 overflow-y-auto border-b border-current/15 px-4 py-4">
                {outcome}
                {finished && (
                  <div>
                    <button type="button" className={button} onClick={dismiss}>
                      {strings.dismiss}
                    </button>
                  </div>
                )}
              </div>
            )}
            {children}
          </div>
        </ImportFlowContext>
      </DropZone>
    );
  }

  return (
    <DropZone
      disabled={running || restoring}
      onFiles={importFiles}
      onText={importText}
    >
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">{strings.appName}</h1>
          <p className="text-lg">{strings.tagline}</p>
          <p className="text-sm opacity-70">{strings.privacy}</p>
        </header>

        <ImportForm
          ref={returnFocus}
          busy={running || restoring}
          sample={empty}
          onFiles={importFiles}
          onText={importText}
        />
        {empty && (
          <RestoreBackup
            connect={connect}
            busy={running}
            onRunning={setRestoring}
          />
        )}

        {announced}
        {outcome}
        {children}
      </main>
    </DropZone>
  );
}
