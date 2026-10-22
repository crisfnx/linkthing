import Dexie from "dexie";
import { zipSync } from "fflate";
import { afterEach, expect, test } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { createExtractClient, WorkerError, type WorkerPort } from "./client";
import { handleRequest } from "./handle";
import type { WorkerRequest } from "./protocol";

const opened: LinkVaultDb[] = [];

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

// Stands in for the real worker: answers asynchronously, like postMessage does.
function fakeWorker(): WorkerPort {
  const db = createDb(`test-${crypto.randomUUID()}`);
  opened.push(db);
  const target = new EventTarget();
  return {
    postMessage(message: WorkerRequest) {
      void handleRequest(message, { db }).then((data) => {
        target.dispatchEvent(new MessageEvent("message", { data }));
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

test("scan resolves with what the scan found", async () => {
  const client = createExtractClient(fakeWorker());
  const scan = await client.scan({ text: "https://example.com/a" });
  expect(scan.detection.kind).toBe("plaintext");
  expect(scan.questions).toEqual([]);
});

test("a failed scan rejects with the worker's error code", async () => {
  const client = createExtractClient(fakeWorker());
  const zip = zipSync({ "IMG-20230525-WA0001.jpg": new Uint8Array([0xff]) });
  const failure = client.scan({ file: new File([zip], "WhatsApp Chat.zip") });
  await expect(failure).rejects.toBeInstanceOf(WorkerError);
  await expect(failure).rejects.toMatchObject({ code: "zip-without-chat" });
});
