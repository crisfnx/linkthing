import { useEffect, useRef, useState } from "react";
import { inputSize } from "@/lib/import/limits";
import type { ImportProgress } from "@/lib/import/options";
import type { Imported, ImportChoice } from "@/lib/import/save";
import type { ScanInput, ScanResult } from "@/lib/import/scan";
import { strings } from "@/lib/strings";
import {
  createExtractClient,
  WorkerError,
  type ExtractClient,
} from "@/lib/workers/client";
import type { WorkerErrorCode } from "@/lib/workers/protocol";

export type ImportState =
  | { status: "idle" }
  | {
      status: "running";
      label: string; // the file's name, or "Pasted text"
      size: number; // in bytes, for the large-file note
      progress: ImportProgress;
      remaining: number; // files queued after this one
    }
  | { status: "done"; results: Imported[] }
  | { status: "cancelled"; results: Imported[] }
  | {
      status: "failed";
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
  connect?: () => ExtractClient;
  decide?: Decide;
}

export interface Item {
  label: string;
  input: ScanInput;
}

// Imports files or text one at a time through the worker (§8.2): scan, decide,
// save. A cancel or a failure stops the rest of the queue.
export function useImport({
  connect = createExtractClient,
  decide = acceptScan,
}: Options = {}) {
  const [state, setState] = useState<ImportState>({ status: "idle" });
  const client = useRef<ExtractClient | null>(null);
  const busy = useRef(false);
  // A cancel can land after the scan's last check and be missed by the
  // worker, so the queue checks it before every save as well.
  const cancelled = useRef(false);

  // The worker starts with the first import and lasts as long as the page.
  useEffect(
    () => () => {
      client.current?.terminate();
      client.current = null;
    },
    [],
  );

  async function importAll(items: Item[], earlier: Imported[] = []) {
    if (items.length === 0 || busy.current) return;
    busy.current = true;
    cancelled.current = false;
    client.current ??= connect();
    const worker = client.current;
    const results = [...earlier];
    let last: ImportState = { status: "done", results };

    for (const [i, { label, input }] of items.entries()) {
      const report = (progress: ImportProgress) =>
        setState({
          status: "running",
          label,
          size: inputSize(input),
          progress,
          remaining: items.length - i - 1,
        });
      report({ phase: "reading" });
      try {
        const choice = await decide(await worker.scan(input, report));
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
    importText: (text: string) =>
      importAll(
        text.trim() === ""
          ? []
          : [{ label: strings.pastedText, input: { text } }],
      ),
    cancel: () => {
      cancelled.current = true;
      client.current?.cancel();
    },
    retry: () => {
      if (state.status === "failed") void importAll(state.rest, state.results);
    },
  };
}
