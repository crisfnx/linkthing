import Dexie from "dexie";
import { zipSync } from "fflate";
import { afterEach, expect, test, vi } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { CANONICALIZER_VERSION } from "@/lib/extract/url/canonicalize";
import type { ImportProgress } from "@/lib/import/options";
import { BARE, textAt, type LibraryRows } from "@/lib/library/rows";
import { saveSettings } from "@/lib/settings";
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
// as with postMessage. Requests arrive as tasks, as in a real worker, so one
// sent from inside an import's progress callback doesn't run inside that
// import's Dexie transaction.
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
      setTimeout(() => void handle(message)),
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

test("load reads the library as rows", async () => {
  const client = createExtractClient(fakeWorker());
  await client.scan({ text: "https://example.com/a\nhttps://example.com/b" });
  await client.start();
  const rows = await client.load();
  expect(rows.count).toBe(2);
  expect(textAt(rows.urls, 0)).toBe("https://example.com/a");
});

// Cancel stops the running import. A load isn't one, so it mustn't become
// what a cancel stops.
test("a load while an import is saving leaves Cancel to the import", async () => {
  const client = createExtractClient(fakeWorker());
  await client.scan({ text: manyLinks(1200) });
  let loading: Promise<LibraryRows> | undefined;
  const importing = client.start({}, (p) => {
    if (p.done === 0) loading = client.load();
    if (p.done === 1000) client.cancel();
  });

  await expect(importing).rejects.toMatchObject({ code: "cancelled" });
  expect((await loading)?.count).toBe(0); // read after the rollback
});

test("delete removes a source and its links, and says how many", async () => {
  const db = freshDb();
  const client = createExtractClient(fakeWorker(db));
  await client.scan({ text: "https://example.com/a\nhttps://example.com/b" });
  const { sourceId } = await client.start();

  expect(await client.deleteSource(sourceId)).toEqual({ links: 2 });
  expect(await db.sources.count()).toBe(0);
  expect(await db.links.count()).toBe(0);
  await expect(client.deleteSource(sourceId)).rejects.toMatchObject({
    code: "unexpected",
  });
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

test("reextract reads a stored source again, with progress", async () => {
  const db = freshDb();
  const client = createExtractClient(fakeWorker(db));
  await client.scan({ text: "https://example.com/a\nhttps://example.com/b" });
  const { sourceId } = await client.start();
  const phases: string[] = [];

  const result = await client.reextract(sourceId, {}, (p) =>
    phases.push(p.phase),
  );
  expect(result).toMatchObject({ sourceId, how: "reextracted", newLinks: 2 });
  expect(phases).toEqual(
    expect.arrayContaining(["reading", "parsing", "extracting", "saving"]),
  );
  expect(await db.links.count()).toBe(2);
});

test("imports and re-extracts follow Settings → Find bare domains", async () => {
  const db = freshDb();
  const client = createExtractClient(fakeWorker(db));
  const text = "see example.com/page and https://example.org/a";
  const bareRows = async () => {
    const rows = await client.load();
    return Array.from(rows.flags).filter((flags) => flags & BARE).length;
  };

  await client.scan({ text });
  const { sourceId } = await client.start({});
  expect(await bareRows()).toBe(1);

  await saveSettings(db, { findBareDomains: false });
  const again = await client.reextract(sourceId, {});
  expect(again.stats.links).toBe(1);
  expect(await bareRows()).toBe(0);

  await client.scan({ text: `${text}\nmore` });
  await client.start({});
  expect(await bareRows()).toBe(0);
});

test("the first load brings stored keys up to the canonicalizer's version", async () => {
  const db = freshDb();
  const client = createExtractClient(fakeWorker(db));
  await client.scan({ text: "https://example.com/a?utm_source=x" });
  const { sourceId } = await client.start({});
  const stored = (await db.links.where("sourceId").equals(sourceId).first())!;
  // As an older canonicalizer would have left them.
  await db.links.update(stored.id, { urlKey: "old:a" });
  await db.annotations.put({
    urlKey: "old:a",
    url: stored.url,
    starred: 1,
    updatedAt: 1,
  });
  await db.settings.put({ key: "meta", canonicalizerVersion: 0 });

  // A new worker, as after an update: its first request re-keys.
  const fresh = createExtractClient(fakeWorker(db));
  const rows = await fresh.load();
  expect(textAt(rows.urlKeys, rows.keys[0]!)).toBe("https://example.com/a");
  expect(await db.annotations.get("https://example.com/a")).toMatchObject({
    starred: 1,
  });
  expect(await db.settings.get("meta")).toEqual({
    key: "meta",
    canonicalizerVersion: CANONICALIZER_VERSION,
  });
});
