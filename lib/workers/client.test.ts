import Dexie from "dexie";
import { zipSync } from "fflate";
import { afterEach, expect, test, vi } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import type { ImportProgress } from "@/lib/import/options";
import { createExtractClient, WorkerError, type WorkerPort } from "./client";
import { createHandler } from "./handle";
import type { WorkerRequest } from "./protocol";

const opened: LinkVaultDb[] = [];

function freshDb(): LinkVaultDb {
  const db = createDb(`test-${crypto.randomUUID()}`);
  opened.push(db);
  return db;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

// Stands in for the real worker: messages arrive asynchronously both ways,
// as with postMessage.
function fakeWorker(db = freshDb()): WorkerPort {
  const target = new EventTarget();
  const handle = createHandler({
    db,
    post: (data) =>
      queueMicrotask(() =>
        target.dispatchEvent(new MessageEvent("message", { data })),
      ),
  });
  return {
    postMessage: (message: WorkerRequest) =>
      queueMicrotask(() => void handle(message)),
    addEventListener: target.addEventListener.bind(target),
    terminate() {},
  } as WorkerPort;
}

const manyLinks = (count: number) =>
  Array.from({ length: count }, (_, i) => `https://example.com/${i}`).join(
    "\n",
  );

test("ping gets a pong", async () => {
  const client = createExtractClient(fakeWorker());
  expect(await client.ping()).toEqual({ id: 0, type: "pong" });
});

test("concurrent requests each get their own reply", async () => {
  const client = createExtractClient(fakeWorker());
  const replies = await Promise.all([client.ping(), client.ping()]);
  expect(replies.map((reply) => reply.id)).toEqual([0, 1]);
});

test("scan reports its phases and resolves with what it found", async () => {
  const client = createExtractClient(fakeWorker());
  const progress: ImportProgress[] = [];
  const scan = await client.scan({ text: "https://example.com/a" }, (p) =>
    progress.push(p),
  );
  expect(scan.detection.kind).toBe("plaintext");
  expect(scan.questions).toEqual([]);
  expect(progress.map((p) => p.phase)).toEqual(["reading", "scanning"]);
});

test("a failed scan rejects with the worker's error code", async () => {
  const client = createExtractClient(fakeWorker());
  const zip = zipSync({ "IMG-20230525-WA0001.jpg": new Uint8Array([0xff]) });
  const failure = client.scan({ file: new File([zip], "WhatsApp Chat.zip") });
  await expect(failure).rejects.toBeInstanceOf(WorkerError);
  await expect(failure).rejects.toMatchObject({ code: "zip-without-chat" });
});

test("start imports the last scan, with progress through every phase", async () => {
  const db = freshDb();
  const client = createExtractClient(fakeWorker(db));
  const progress: ImportProgress[] = [];
  await client.scan({ text: manyLinks(1500) });
  const imported = await client.start({}, (p) => progress.push(p));

  expect(imported.newLinks).toBe(1500);
  expect(await db.sources.get(imported.sourceId)).toBeDefined();
  expect(progress.map((p) => [p.phase, p.done])).toEqual([
    ["parsing", undefined],
    ["extracting", undefined],
    ["saving", 0],
    ["saving", 1000],
    ["saving", 1500],
  ]);
});

test("a scan is imported once; starting again needs a new scan", async () => {
  const client = createExtractClient(fakeWorker());
  await client.scan({ text: "https://example.com/a" });
  await client.start();
  await expect(client.start()).rejects.toMatchObject({ code: "unexpected" });
});

test("cancel while saving rejects with 'cancelled' and leaves no rows", async () => {
  const db = freshDb();
  const client = createExtractClient(fakeWorker(db));
  // Just over one chunk, since rolling back is slow in fake-indexeddb.
  await client.scan({ text: manyLinks(1200) });
  const importing = client.start({}, (p) => {
    if (p.done === 1000) client.cancel();
  });

  await expect(importing).rejects.toMatchObject({ code: "cancelled" });
  expect(await db.sources.count()).toBe(0);
  expect(await db.sourceParts.count()).toBe(0);
  expect(await db.links.count()).toBe(0);
});

test("a full disk is reported as such", async () => {
  const db = freshDb();
  const full = new DOMException("Quota exceeded", "QuotaExceededError");
  vi.spyOn(db.sourceParts, "add").mockRejectedValue(full);
  const client = createExtractClient(fakeWorker(db));
  await client.scan({ text: "https://example.com/a" });

  await expect(client.start()).rejects.toMatchObject({
    code: "quota-exceeded",
  });
  expect(await db.sources.count()).toBe(0);
});
