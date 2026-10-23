import { useRef, useState } from "react";
import { inputSize } from "@/lib/import/limits";
import type { ImportProgress } from "@/lib/import/options";
import type { ReextractChoice } from "@/lib/import/reextract";
import type { Imported, ImportChoice } from "@/lib/import/save";
import type { ScanInput, ScanResult } from "@/lib/import/scan";
import { strings } from "@/lib/strings";
import { WorkerError, type ExtractClient } from "@/lib/workers/client";
import type { WorkerErrorCode } from "@/lib/workers/protocol";

// An import, or a stored source read again (§6.4): the same queue, progress,
// cancel and summary.
export type Job = "import" | "reextract";

export type ImportState =
  | { status: "idle" }
  | {
      status: "running";
      job: Job;
      label: string; // the file's name, "Pasted text", or the source's name
      size: number; // in bytes, for the large-file note
      progress: ImportProgress;
      remaining: number; // files queued after this one
    }
  | { status: "done"; results: Imported[] }
  | { status: "cancelled"; results: Imported[] }
  | {
      status: "failed";
      job: Job;
      label: string;
      code: WorkerErrorCode;
      message: string;
      results: Imported[]; // files imported before this one
      rest: Item[]; // this one and those queued after it, for Try again
    };

// Settles the scan's questions before the save (§6.1), or skips the input
// with null. The import dialog plugs in here.
export type Decide = (
  scan: ScanResult,
) => ImportChoice | null | Promise<ImportChoice | null>;

// Until the dialog exists, the scan's own answers stand.
const acceptScan: Decide = () => ({});

interface Options {
  connect: () => ExtractClient; // the page's worker (useExtractClient)
  decide?: Decide;
}

export type Item =
  | { label: string; input: ScanInput }
  | {
      label: string;
      reextract: { sourceId: string; choice: ReextractChoice };
    };

// Imports files or text one at a time through the worker (§8.2): scan, decide,
// save. A re-extract skips the scan and goes straight to the worker. A cancel
// or a failure stops the rest of the queue.
export function useImport({ connect, decide = acceptScan }: Options) {
  const [state, setState] = useState<ImportState>({ status: "idle" });
  const busy = useRef(false);
  // A cancel can land after the scan's last check and be missed by the
  // worker, so the queue checks it before every save as well.
  const cancelled = useRef(false);

  async function importAll(items: Item[], earlier: Imported[] = []) {
    if (items.length === 0 || busy.current) return;
    busy.current = true;
    cancelled.current = false;
    const worker = connect();
    const results = [...earlier];
    let last: ImportState = { status: "done", results };

    for (const [i, item] of items.entries()) {
      const { label } = item;
      const job: Job = "reextract" in item ? "reextract" : "import";
      const report = (progress: ImportProgress) =>
        setState({
          status: "running",
          job,
          label,
          size: "input" in item ? inputSize(item.input) : 0,
          progress,
          remaining: items.length - i - 1,
        });
      report({ phase: "reading" });
      try {
        if ("reextract" in item) {
          const { sourceId, choice } = item.reextract;
          results.push(await worker.reextract(sourceId, choice, report));
          continue;
        }
        const choice = await decide(await worker.scan(item.input, report));
        if (cancelled.current) {
          throw new WorkerError("cancelled", "Cancelled before saving");
        }
        if (choice !== null) results.push(await worker.start(choice, report));
      } catch (error) {
        const code = error instanceof WorkerError ? error.code : "unexpected";
        const message = error instanceof Error ? error.message : String(error);
        last =
          code === "cancelled"
            ? { status: "cancelled", results }
            : {
                status: "failed",
                job,
                label,
                code,
                message,
                results,
                rest: items.slice(i),
              };
        break;
      }
    }
    busy.current = false;
    setState(last);
  }

  return {
    state,
    importFiles: (files: File[]) =>
      importAll(files.map((file) => ({ label: file.name, input: { file } }))),
    reextract: (
      sources: readonly { id: string; name: string }[],
      choice: ReextractChoice,
    ) =>
      importAll(
        sources.map((source) => ({
          label: source.name,
          reextract: { sourceId: source.id, choice },
        })),
      ),
    importText: (text: string) =>
      importAll(
        text.trim() === ""
          ? []
          : [{ label: strings.pastedText, input: { text } }],
      ),
    cancel: () => {
      cancelled.current = true;
      if (busy.current) connect().cancel();
    },
    retry: () => {
      if (state.status === "failed") void importAll(state.rest, state.results);
    },
    // Puts away what the last import left on screen.
    dismiss: () => {
      if (!busy.current) setState({ status: "idle" });
    },
  };
}
