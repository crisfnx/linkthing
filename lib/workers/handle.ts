import type { LinkVaultDb } from "@/lib/db/schema";
import { InputError } from "@/lib/extract/input";
import type { ImportOptions } from "@/lib/import/options";
import { reextractSource } from "@/lib/import/reextract";
import { saveImport } from "@/lib/import/save";
import { scanInput, type Scan } from "@/lib/import/scan";
import {
  CURRENT_CANONICALIZER,
  rekeyIfNeeded,
  type Canonicalizer,
} from "@/lib/library/rekey";
import { loadRows, transferablesOf } from "@/lib/library/rows";
import { deleteSource } from "@/lib/library/sources";
import { readSettings } from "@/lib/settings";
import type {
  WorkerErrorCode,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

export interface WorkerContext {
  db: LinkVaultDb;
  // transfer: buffers to move to the page rather than copy (library rows)
  post: (response: WorkerResponse, transfer?: Transferable[]) => void;
  canonicalizer?: Canonicalizer; // the current one; tests pass another
}

// IndexedDB reports a full disk as QuotaExceededError, and Dexie can wrap it
// in the AbortError of the transaction it ended.
function isQuotaError(error: unknown): boolean {
  const inner = (error as { inner?: unknown } | null)?.inner;
  return [error, inner].some(
    (e) => e instanceof Error && e.name === "QuotaExceededError",
  );
}

function errorCode(error: unknown, signal: AbortSignal): WorkerErrorCode {
  if (signal.aborted) return "cancelled";
  if (error instanceof InputError) return error.code;
  if (isQuotaError(error)) return "quota-exceeded";
  return "unexpected";
}

function unexpected(id: number, error: unknown): WorkerResponse {
  const message = error instanceof Error ? error.message : String(error);
  return { id, type: "error", code: "unexpected", message };
}

// The worker's side of the protocol, kept apart from extract.worker.ts so it
// can be tested without a Worker.
export function createHandler({
  db,
  post,
  canonicalizer = CURRENT_CANONICALIZER,
}: WorkerContext) {
  // The last scan's text waits here for the start that follows it.
  let scanned: Scan | undefined;
  let running: AbortController | undefined;
  // Stored links follow the canonicalizer's version (§4.4): brought up to it
  // once, before the first request that reads or writes them. A failure is
  // reported to that request, and the next one tries again.
  let rekeyed: Promise<unknown> | undefined;
  function upToDate(): Promise<unknown> {
    rekeyed ??= rekeyIfNeeded(db, canonicalizer).catch((error: unknown) => {
      rekeyed = undefined;
      throw error;
    });
    return rekeyed;
  }

  async function run(
    id: number,
    task: (options: ImportOptions) => Promise<WorkerResponse>,
  ) {
    const controller = new AbortController();
    running = controller;
    try {
      await upToDate();
      // Read for each request, so a change in Settings, from this tab or
      // another, applies to the next import.
      const { findBareDomains } = await readSettings(db);
      post(
        await task({
          bareDomains: findBareDomains,
          onProgress: (progress) => post({ id, type: "progress", progress }),
          signal: controller.signal,
        }),
      );
    } catch (error) {
      const code = errorCode(error, controller.signal);
      const message = error instanceof Error ? error.message : String(error);
      post({ id, type: "error", code, message });
    } finally {
      if (running === controller) running = undefined;
    }
  }

  return async function handle(request: WorkerRequest): Promise<void> {
    const { id } = request;
    switch (request.type) {
      case "ping":
        return post({ id, type: "pong" });
      case "cancel":
        running?.abort();
        return;
      // Neither goes through run(): that would make it what Cancel stops.
      case "load":
        try {
          await upToDate();
          const rows = await loadRows(db);
          return post({ id, type: "rows", rows }, transferablesOf(rows));
        } catch (error) {
          return post(unexpected(id, error));
        }
      case "delete":
        try {
          await upToDate();
          const { links } = await deleteSource(db, request.sourceId);
          return post({ id, type: "deleted", links });
        } catch (error) {
          return post(unexpected(id, error));
        }
      case "scan":
        scanned = undefined;
        return run(id, async (options) => {
          const scan = await scanInput(db, request.input, options);
          // A cancel that came after the scan's last check: nothing was
          // written, so it still counts.
          options.signal?.throwIfAborted();
          scanned = scan;
          return { id, type: "scanned", scan: scan.result };
        });
      case "reextract":
        return run(id, async (options) => {
          const imported = await reextractSource(
            db,
            request.sourceId,
            request.choice,
            options,
          );
          return { id, type: "done", imported };
        });
      case "start": {
        // Used once: trying again after a failure starts from a new scan,
        // which also sees what the failed attempt changed.
        const scan = scanned;
        scanned = undefined;
        return run(id, async (options) => {
          if (!scan) throw new Error("There is no scanned input to import");
          const imported = await saveImport(db, scan, request.choice, options);
          return { id, type: "done", imported };
        });
      }
    }
  };
}
