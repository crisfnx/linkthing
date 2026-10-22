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

export interface ExtractClient {
  ping(): Promise<WorkerResponse>;
  // The scan pass (§6.1): what the file is, and whether the dialog must ask.
  scan(input: ScanInput): Promise<ScanResult>;
  terminate(): void;
}

// Omit<WorkerRequest, "id"> would collapse the union into its common fields.
type Unsent<T> = T extends unknown ? Omit<T, "id"> : never;

export function startExtractWorker(): Worker {
  return new Worker(new URL("./extract.worker.ts", import.meta.url), {
    type: "module",
  });
}

export function createExtractClient(
  worker: WorkerPort = startExtractWorker(),
): ExtractClient {
  let nextId = 0;
  const pending = new Map<number, (response: WorkerResponse) => void>();

  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const resolve = pending.get(event.data.id);
    pending.delete(event.data.id);
    resolve?.(event.data);
  });

  function request(message: Unsent<WorkerRequest>) {
    const id = nextId++;
    return new Promise<WorkerResponse>((resolve) => {
      pending.set(id, resolve);
      worker.postMessage({ ...message, id });
    });
  }

  return {
    ping: () => request({ type: "ping" }),
    async scan(input) {
      const response = await request({ type: "scan", input });
      if (response.type === "scanned") return response.scan;
      if (response.type === "error") {
        throw new WorkerError(response.code, response.message);
      }
      throw new WorkerError("unexpected", `Unexpected ${response.type}`);
    },
    terminate: () => worker.terminate(),
  };
}
