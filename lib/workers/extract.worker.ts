import { createDb } from "@/lib/db/schema";
import { createHandler } from "./handle";
import type { WorkerRequest } from "./protocol";

// The worker writes imports to IndexedDB itself, so a large input never
// crosses back to the page (§8.2); the library goes to the page as rows whose
// columns are transferred, not copied (§5). When another tab upgrades the
// schema, the page's own connection asks for the reload; this one just closes.
const handle = createHandler({
  db: createDb(),
  post: (response, transfer = []) => self.postMessage(response, { transfer }),
});

// Not awaited: a cancel has to get through while an import is running.
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data);
};
