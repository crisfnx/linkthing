import { expect, test } from "vitest";
import { createExtractClient, type WorkerPort } from "./client";
import { handleRequest } from "./handle";
import type { WorkerRequest } from "./protocol";

// Stands in for the real worker: answers asynchronously, like postMessage does.
function fakeWorker(): WorkerPort {
  const target = new EventTarget();
  return {
    postMessage(message: WorkerRequest) {
      setTimeout(() => {
        const event = new MessageEvent("message", {
          data: handleRequest(message),
        });
        target.dispatchEvent(event);
      });
    },
    addEventListener: target.addEventListener.bind(target),
    terminate() {},
  } as WorkerPort;
}

test("ping gets a pong", async () => {
  const client = createExtractClient(fakeWorker());
  expect(await client.ping()).toEqual({ id: 0, type: "pong" });
});

test("concurrent requests each get their own reply", async () => {
  const client = createExtractClient(fakeWorker());
  const replies = await Promise.all([client.ping(), client.ping()]);
  expect(replies.map((reply) => reply.id)).toEqual([0, 1]);
});
