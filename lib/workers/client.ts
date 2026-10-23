import type { BackupCounts } from "@/lib/backup/format";
import type { Restored } from "@/lib/backup/restore";
import type { ExportFormat } from "@/lib/export/rows";
import type { ImportProgress } from "@/lib/import/options";
import type { ReextractChoice } from "@/lib/import/reextract";
import type { Imported, ImportChoice } from "@/lib/import/save";
import type { ScanInput, ScanResult } from "@/lib/import/scan";
import type { LibraryRows } from "@/lib/library/rows";
import type {
  WorkerErrorCode,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

// The subset of Worker the client uses, so tests can pass a fake.
export type WorkerPort = Pick<
  Worker,
  "postMessage" | "addEventListener" | "terminate"
>;

// A failure the worker reported. The UI turns the code into a message that
// says what happened and what to do (§7, Copy).
export class WorkerError extends Error {
  constructor(
    readonly code: WorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

type OnProgress = (progress: ImportProgress) => void;

export interface ExtractClient {
  ping(): Promise<WorkerResponse>;
  // The scan pass (§6.1): what the file is, and whether the dialog must ask.
  scan(input: ScanInput, onProgress?: OnProgress): Promise<ScanResult>;
  // The save pass, for the last scan. Rejects with "cancelled" on cancel.
  start(choice?: ImportChoice, onProgress?: OnProgress): Promise<Imported>;
  // A stored source read again (§6.4). Rejects with "cancelled" on cancel.
  reextract(
    sourceId: string,
    choice: ReextractChoice,
    onProgress?: OnProgress,
  ): Promise<Imported>;
  cancel(): void;
  // The whole library as rows (§5), for browsing.
  load(): Promise<LibraryRows>;
  // A source and its links, in one transaction (§6.4).
  deleteSource(sourceId: string): Promise<{ links: number }>;
  // The whole library as one file (§6.5).
  backup(): Promise<{ file: Blob; counts: BackupCounts }>;
  // A backup merged into the library. Rejects with "invalid-backup", its
  // message saying why, or "cancelled" on cancel.
  restore(file: Blob, onProgress?: OnProgress): Promise<Restored>;
  // These links as a file (§6.5); links: how many it holds.
  exportLinks(
    ids: string[],
    format: ExportFormat,
    shared?: number[],
  ): Promise<{ file: Blob; links: number }>;
  terminate(): void;
}

// Omit<WorkerRequest, "id"> would collapse the union into its common fields.
type Unsent<T> = T extends unknown ? Omit<T, "id"> : never;
type Reply<T extends WorkerResponse["type"]> = Extract<
  WorkerResponse,
  { type: T }
>;

export function startExtractWorker(): Worker {
  return new Worker(new URL("./extract.worker.ts", import.meta.url), {
    type: "module",
  });
}

export function createExtractClient(
  worker: WorkerPort = startExtractWorker(),
): ExtractClient {
  interface Pending {
    resolve: (response: WorkerResponse) => void;
    onProgress?: OnProgress;
  }
  let nextId = 0;
  const pending = new Map<number, Pending>();

  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (response.type === "progress") {
      request?.onProgress?.(response.progress);
      return;
    }
    pending.delete(response.id);
    request?.resolve(response);
  });

  function send(message: Unsent<WorkerRequest>, waiting?: Pending) {
    const id = nextId++;
    if (waiting) pending.set(id, waiting);
    worker.postMessage({ ...message, id });
  }

  // Sends a request and waits for its reply of the given type.
  async function call<T extends WorkerResponse["type"]>(
    message: Unsent<WorkerRequest>,
    type: T,
    onProgress?: OnProgress,
  ): Promise<Reply<T>> {
    const response = await new Promise<WorkerResponse>((resolve) => {
      send(message, { resolve, onProgress });
    });
    if (response.type === type) return response as Reply<T>;
    if (response.type === "error") {
      throw new WorkerError(response.code, response.message);
    }
    throw new WorkerError("unexpected", `Expected ${type}: ${response.type}`);
  }

  return {
    ping: () => call({ type: "ping" }, "pong"),
    async scan(input, onProgress) {
      return (await call({ type: "scan", input }, "scanned", onProgress)).scan;
    },
    async start(choice = {}, onProgress) {
      const reply = await call({ type: "start", choice }, "done", onProgress);
      return reply.imported;
    },
    async reextract(sourceId, choice, onProgress) {
      const message = { type: "reextract" as const, sourceId, choice };
      return (await call(message, "done", onProgress)).imported;
    },
    cancel: () => send({ type: "cancel" }),
    load: async () => (await call({ type: "load" }, "rows")).rows,
    deleteSource: async (sourceId) => {
      const reply = await call({ type: "delete", sourceId }, "deleted");
      return { links: reply.links };
    },
    backup: async () => {
      const reply = await call({ type: "backup" }, "backedUp");
      return { file: reply.file, counts: reply.counts };
    },
    restore: async (file, onProgress) => {
      const reply = await call(
        { type: "restore", file },
        "restored",
        onProgress,
      );
      return reply.restored;
    },
    exportLinks: async (ids, format, shared) => {
      const reply = await call(
        { type: "export", ids, format, ...(shared ? { shared } : {}) },
        "exported",
      );
      return { file: reply.file, links: reply.links };
    },
    terminate: () => worker.terminate(),
  };
}
