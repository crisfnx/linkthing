import type { LinkVaultDb } from "@/lib/db/schema";
import { InputError } from "@/lib/extract/input";
import { scanInput } from "@/lib/import/scan";
import type { WorkerRequest, WorkerResponse } from "./protocol";

export interface WorkerContext {
  db: LinkVaultDb;
}

// Kept apart from extract.worker.ts so it can be tested without a Worker.
export async function handleRequest(
  request: WorkerRequest,
  { db }: WorkerContext,
): Promise<WorkerResponse> {
  const { id } = request;
  try {
    switch (request.type) {
      case "ping":
        return { id, type: "pong" };
      case "scan": {
        const { result } = await scanInput(db, request.input);
        return { id, type: "scanned", scan: result };
      }
    }
  } catch (error) {
    const code = error instanceof InputError ? error.code : "unexpected";
    const message = error instanceof Error ? error.message : String(error);
    return { id, type: "error", code, message };
  }
}
