import { readFileSync } from "node:fs";
import Dexie from "dexie";
import { afterEach, expect, test, vi } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { loadSample, SAMPLE_FILE_NAME, SAMPLE_URL } from "./sample";
import { saveImport } from "./save";
import { scanInput } from "./scan";

const sampleBytes = () =>
  readFileSync(new URL("../../public/sample-chat.txt", import.meta.url));

const opened: Dexie[] = [];

function freshDb(): LinkVaultDb {
  const db = createDb(`test-${crypto.randomUUID()}`);
  opened.push(db);
  return db;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

async function importSample(db: LinkVaultDb) {
  const file = new File([sampleBytes()], SAMPLE_FILE_NAME);
  const scan = await scanInput(db, { file });
  return { scan: scan.result, imported: await saveImport(db, scan, {}) };
}

test("the sample is a WhatsApp chat that imports without a question", async () => {
  const { scan, imported } = await importSample(freshDb());

  expect(scan.questions).toEqual([]);
  expect(scan.detection).toMatchObject({
    kind: "whatsapp",
    needsConfirmation: false,
  });
  expect(scan.dateOrder).toBe("DMY");
  expect(imported.name).toBe("Sample chat");
  expect(imported.stats).toMatchObject({
    messages: 95,
    links: 56,
    uniqueLinks: 51,
    domains: 33,
  });
});

// What it is there to show: links shared more than once, under other hosts
// or with tracking parameters, count once.
test("its repeated links share one key each", async () => {
  const db = freshDb();
  await importSample(db);
  const links = await db.links.toArray();
  links.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const shared = (urlKey: string) =>
    links.filter((link) => link.urlKey === urlKey).map((link) => link.url);

  expect(shared("https://youtube.com/watch?v=Ex4mpLeV1d0")).toHaveLength(3);
  expect(shared("https://twitter.com/i/status/1900000000000000001")).toEqual([
    "https://x.com/exampledev/status/1900000000000000001",
    "https://twitter.com/exampledev/status/1900000000000000001?s=20",
  ]);
  expect(
    shared(
      "https://theguardian.com/travel/2026/mar/10/lisbon-beyond-the-trams",
    ),
  ).toHaveLength(2);
  expect(shared("https://en.wikipedia.org/wiki/Alfama")).toHaveLength(2);
});

test("loadSample fetches it and names it like an export", async () => {
  const fetch = vi.fn(async () => new Response(sampleBytes()));
  vi.stubGlobal("fetch", fetch);

  const file = await loadSample();

  expect(fetch).toHaveBeenCalledWith(SAMPLE_URL);
  expect(file.name).toBe("WhatsApp Chat with Sample chat.txt");
  expect(await file.text()).toBe(sampleBytes().toString("utf8"));
});

test("a sample that can't be fetched rejects", async () => {
  vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
  await expect(loadSample()).rejects.toThrow("404");
});
