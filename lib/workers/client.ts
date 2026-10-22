import type { ImportProgress } from "@/lib/import/options";
import type { Imported, ImportChoice } from "@/lib/import/save";
import type { ScanInput, ScanResult } from "@/lib/import/scan";
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
  cancel(): void;
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
    cancel: () => send({ type: "cancel" }),
    terminate: () => worker.terminate(),
  };
}
