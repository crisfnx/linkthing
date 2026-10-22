import { createDb } from "@/lib/db/schema";
import { handleRequest } from "./handle";
import type { WorkerRequest } from "./protocol";

// The worker writes to IndexedDB itself, so large results never cross the
// thread boundary (§8.2). When another tab upgrades the schema, the page's own
// connection asks for the reload; this one just closes.
const db = createDb();

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  self.postMessage(await handleRequest(event.data, { db }));
};
