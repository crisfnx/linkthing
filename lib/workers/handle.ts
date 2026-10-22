import type { LinkVaultDb } from "@/lib/db/schema";
import { InputError } from "@/lib/extract/input";
import type { ImportOptions } from "@/lib/import/options";
import { saveImport } from "@/lib/import/save";
import { scanInput, type Scan } from "@/lib/import/scan";
import { loadRows, transferablesOf } from "@/lib/library/rows";
import type {
  WorkerErrorCode,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

export interface WorkerContext {
  db: LinkVaultDb;
  // transfer: buffers to move to the page rather than copy (library rows)
  post: (response: WorkerResponse, transfer?: Transferable[]) => void;
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

// The worker's side of the protocol, kept apart from extract.worker.ts so it
// can be tested without a Worker.
export function createHandler({ db, post }: WorkerContext) {
  // The last scan's text waits here for the start that follows it.
  let scanned: Scan | undefined;
  let running: AbortController | undefined;

  async function run(
    id: number,
    task: (options: ImportOptions) => Promise<WorkerResponse>,
  ) {
    const controller = new AbortController();
    running = controller;
    try {
      post(
        await task({
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
      case "load":
        // Not through run(): that would make the load what Cancel stops.
        try {
          const rows = await loadRows(db);
          return post({ id, type: "rows", rows }, transferablesOf(rows));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return post({ id, type: "error", code: "unexpected", message });
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
