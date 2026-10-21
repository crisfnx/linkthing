import { handleRequest } from "./handle";
import type { WorkerRequest } from "./protocol";

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  self.postMessage(handleRequest(event.data));
};
