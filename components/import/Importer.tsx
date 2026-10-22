"use client";

import type { ReactNode } from "react";
import { useImport, type Decide, type ImportState } from "@/hooks/useImport";
import { strings } from "@/lib/strings";
import type { ExtractClient } from "@/lib/workers/client";
import { DropZone } from "./DropZone";
import { ImportForm } from "./ImportForm";
import { ImportProgress } from "./ImportProgress";
import { ImportSummary } from "./ImportSummary";

interface Props {
  connect?: () => ExtractClient;
  decide?: Decide;
  children?: ReactNode;
}

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
export function Importer({ connect, decide, children }: Props) {
  const { state, importFiles, importText, cancel } = useImport({
    connect,
    decide,
  });
  const running = state.status === "running";
  const results = "results" in state ? state.results : [];

  return (
    <DropZone disabled={running} onFiles={importFiles} onText={importText}>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">{strings.appName}</h1>
          <p className="text-lg">{strings.tagline}</p>
          <p className="text-sm opacity-70">{strings.privacy}</p>
        </header>

        <ImportForm
          disabled={running}
          onFiles={importFiles}
          onText={importText}
        />

        <p role="status" className="sr-only">
          {announcement(state)}
        </p>
        {state.status === "running" && (
          <ImportProgress
            label={state.label}
            progress={state.progress}
            remaining={state.remaining}
            onCancel={cancel}
          />
        )}
        {state.status === "cancelled" && <p>{strings.cancelled}</p>}
        {state.status === "failed" && (
          <div role="alert" className="flex flex-col gap-1">
            <p>{strings.errors[state.code](state.label)}</p>
            {state.code === "unexpected" && (
              <p className="font-mono text-sm opacity-70">{state.message}</p>
            )}
          </div>
        )}
        {results.length > 0 && <ImportSummary results={results} />}

        {children}
      </main>
    </DropZone>
  );
}
