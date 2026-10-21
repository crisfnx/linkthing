import type { WorkerRequest, WorkerResponse } from "./protocol";

// Kept apart from extract.worker.ts so it can be tested without a Worker.
export function handleRequest(request: WorkerRequest): WorkerResponse {
  switch (request.type) {
    case "ping":
      return { id: request.id, type: "pong" };
  }
}
