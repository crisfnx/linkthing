import { createDb } from "@/lib/db/schema";
import { createHandler } from "./handle";
import type { WorkerRequest } from "./protocol";

// The worker writes to IndexedDB itself, so large results never cross the
// thread boundary (§8.2). When another tab upgrades the schema, the page's own
// connection asks for the reload; this one just closes.
const handle = createHandler({
  db: createDb(),
  post: (response) => self.postMessage(response),
});

// Not awaited: a cancel has to get through while an import is running.
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data);
};
