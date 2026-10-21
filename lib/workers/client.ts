import type { WorkerRequest, WorkerResponse } from "./protocol";

// The subset of Worker the client uses, so tests can pass a fake.
export type WorkerPort = Pick<
  Worker,
  "postMessage" | "addEventListener" | "terminate"
>;

export interface ExtractClient {
  ping(): Promise<WorkerResponse>;
  terminate(): void;
}

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

  function request(message: Omit<WorkerRequest, "id">) {
    const id = nextId++;
    return new Promise<WorkerResponse>((resolve) => {
      pending.set(id, resolve);
      worker.postMessage({ ...message, id });
    });
  }

  return {
    ping: () => request({ type: "ping" }),
    terminate: () => worker.terminate(),
  };
}
