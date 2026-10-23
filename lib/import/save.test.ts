import { readFileSync } from "node:fs";
import Dexie from "dexie";
import { afterEach, describe, expect, test } from "vitest";
import { decompressText } from "@/lib/db/raw";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { whatsapp } from "@/lib/extract/adapters/whatsapp";
import { extractLinks } from "@/lib/extract/pipeline";
import { toggleStar } from "@/lib/library/details";
import type { Link } from "@/lib/extract/types";
import type { ImportProgress } from "./options";
import { saveImport, type ImportChoice } from "./save";
import { scanInput, type ScanInput } from "./scan";

const fixtureBytes = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url));
const dropped = (name: string, as = name) => ({
  file: new File([fixtureBytes(name)], as),
});

const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).getTime();

const opened: Dexie[] = [];

function freshDb(): LinkVaultDb {
  const db = createDb(`test-${crypto.randomUUID()}`);
  opened.push(db);
  return db;
}

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

async function importInput(
  db: LinkVaultDb,
  input: ScanInput,
  choice: ImportChoice = {},
) {
  const scan = await scanInput(db, input);
  return { scan, imported: await saveImport(db, scan, choice) };
}

const rowCounts = (db: LinkVaultDb) =>
  Promise.all([db.sources.count(), db.sourceParts.count(), db.links.count()]);

const linksOf = (db: LinkVaultDb, sourceId: string) =>
  db.links.where("sourceId").equals(sourceId).toArray();

const byId = (a: Link, b: Link) => a.id.localeCompare(b.id);

// One link per line, as plain text.
const manyLinks = (count: number) =>
  Array.from({ length: count }, (_, i) => `https://example.com/${i}`).join(
    "\n",
  );

describe("a new source", () => {
  test("a chat: the source, its gzipped text and its links", async () => {
    const db = freshDb();
    const progress: ImportProgress[] = [];
    const scan = await scanInput(
      db,
      dropped("whatsapp-update-older.txt", "WhatsApp Chat with Me.txt"),
    );
    const imported = await saveImport(
      db,
      scan,
      {},
      { onProgress: (p) => progress.push(p) },
    );
    const { sourceId } = imported;
    const expected = extractLinks(scan.text, sourceId, "whatsapp");

    expect(imported).toEqual({
      sourceId,
      name: "Me",
      how: "new",
      stats: expected.stats,
      newLinks: 17,
    });
    const source = await db.sources.get(sourceId);
    expect(source).toEqual({
      id: sourceId,
      name: "Me",
      kind: "whatsapp",
      adapterVersion: 1,
      importedAt: expect.any(Number),
      updatedAt: source?.importedAt,
      stats: expected.stats,
      options: { dateOrder: "DMY" },
    });

    const parts = await db.sourceParts.toArray();
    expect(parts).toEqual([
      {
        id: expect.any(String),
        sourceId,
        fileName: "WhatsApp Chat with Me.txt",
        importedAt: source?.importedAt,
        byteSize: scan.result.byteSize,
        contentHash: scan.result.contentHash,
        raw: expect.any(Blob),
      },
    ]);
    const raw = parts[0]?.raw ?? new Blob();
    expect(await decompressText(raw)).toBe(scan.text);
    expect(raw.size).toBeLessThan(scan.result.byteSize);

    expect((await linksOf(db, sourceId)).sort(byId)).toEqual(
      expected.links.sort(byId),
    );
    expect(progress).toEqual([
      { phase: "parsing" },
      { phase: "extracting" },
      { phase: "saving", done: 0, total: 17 },
      { phase: "saving", done: 17, total: 17 },
    ]);
  });

  test("pasted text is named by when it was pasted", async () => {
    const db = freshDb();
    const { imported } = await importInput(db, {
      text: "Read later: https://example.com/a",
    });
    const source = await db.sources.get(imported.sourceId);
    expect(source).toMatchObject({ kind: "plaintext", options: {} });
    expect(source?.name).toMatch(/^Pasted text, /);
    const [part] = await db.sourceParts.toArray();
    expect(part?.fileName).toBeUndefined();
  });

  test("the day/month order chosen in the dialog is used and kept", async () => {
    const db = freshDb();
    const { imported } = await importInput(
      db,
      dropped("whatsapp-ambiguous-dates.txt"),
      { dateOrder: "MDY" },
    );
    const source = await db.sources.get(imported.sourceId);
    expect(source?.options).toEqual({ dateOrder: "MDY" });
    const links = await linksOf(db, imported.sourceId);
    const first = links.find((l) => l.url.includes("spring-reading-list"));
    expect(first?.timestamp).toBe(at(2024, 3, 4, 9, 15)); // 03/04 read month first
  });

  test("the adapter chosen in the dialog is used", async () => {
    const db = freshDb();
    const unsure = dropped("whatsapp-unsure.txt");
    const asText = await importInput(db, unsure);
    const asChat = await importInput(db, unsure, { kind: "whatsapp" });

    const sources = [asText, asChat].map((i) =>
      db.sources.get(i.imported.sourceId),
    );
    expect((await Promise.all(sources)).map((s) => s?.kind)).toEqual([
      "plaintext",
      "whatsapp",
    ]);
    const chatLinks = await linksOf(db, asChat.imported.sourceId);
    expect(chatLinks.every((l) => l.sender === "Cris")).toBe(true);
  });

  test("links are written 1,000 at a time, with progress after each", async () => {
    const db = freshDb();
    const progress: ImportProgress[] = [];
    const scan = await scanInput(db, { text: manyLinks(2500) });
    await saveImport(db, scan, {}, { onProgress: (p) => progress.push(p) });
    expect(progress.filter((p) => p.phase === "saving")).toEqual(
      [0, 1000, 2000, 2500].map((done) => ({
        phase: "saving",
        done,
        total: 2500,
      })),
    );
    expect(await db.links.count()).toBe(2500);
  });
});

describe("cancelling", () => {
  // Just over one chunk: fake-indexeddb undoes an aborted write by scanning
  // each index once per row, so rolling back n links takes time in n².
  test.each([
    ["while extracting", (p: ImportProgress) => p.phase === "extracting"],
    ["before the first chunk", (p: ImportProgress) => p.done === 0],
    ["after the first chunk", (p: ImportProgress) => p.done === 1000],
    ["with the last chunk", (p: ImportProgress) => p.done === 1200],
  ])("%s leaves no rows at all", async (_, when) => {
    const db = freshDb();
    const scan = await scanInput(db, { text: manyLinks(1200) });
    const controller = new AbortController();
    const saving = saveImport(
      db,
      scan,
      {},
      {
        signal: controller.signal,
        onProgress: (p) => {
          if (when(p)) controller.abort();
        },
      },
    );
    await expect(saving).rejects.toMatchObject({ name: "AbortError" });
    expect(await rowCounts(db)).toEqual([0, 0, 0]);
  });

  test("an update leaves the source as it was", async () => {
    const db = freshDb();
    const { imported } = await importInput(
      db,
      dropped("whatsapp-update-older.txt"),
    );
    const before = await db.sources.get(imported.sourceId);

    const scan = await scanInput(db, dropped("whatsapp-update-newer.txt"));
    const controller = new AbortController();
    const saving = saveImport(
      db,
      scan,
      { updateOf: imported.sourceId },
      {
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === "saving") controller.abort();
        },
      },
    );
    await expect(saving).rejects.toMatchObject({ name: "AbortError" });
    expect(await rowCounts(db)).toEqual([1, 1, 17]);
    expect(await db.sources.get(imported.sourceId)).toEqual(before);
  });
});

describe("an update from a newer export", () => {
  const olderText = fixtureBytes("whatsapp-update-older.txt").toString();
  const newerText = fixtureBytes("whatsapp-update-newer.txt").toString();

  async function updated() {
    const db = freshDb();
    const first = await importInput(db, dropped("whatsapp-update-older.txt"));
    const { sourceId } = first.imported;
    const olderLinks = await linksOf(db, sourceId);

    const scan = await scanInput(db, dropped("whatsapp-update-newer.txt"));
    expect(scan.result.updateCandidate?.sourceId).toBe(sourceId);
    const update = await saveImport(db, scan, { updateOf: sourceId });
    return { db, first, sourceId, olderLinks, update };
  }

  test("adds the file as a new part and only the links that are new", async () => {
    const { db, sourceId, update } = await updated();
    expect(update).toMatchObject({
      name: "whatsapp-update-older.txt", // the source keeps its name
      how: "updated",
      newLinks: 12, // 26 in the newer export, 14 stored
    });
    expect(await rowCounts(db)).toEqual([1, 2, 29]);
    const parts = await db.sourceParts.where("sourceId").equals(sourceId);
    expect(await parts.count()).toBe(2);
  });

  test("keeps the links the newer export lacks, untouched", async () => {
    const { db, sourceId, olderLinks } = await updated();
    const newerIds = new Set(
      extractLinks(newerText, sourceId, "whatsapp").links.map((l) => l.id),
    );
    const lacking = olderLinks.filter((l) => !newerIds.has(l.id));
    expect(lacking).toHaveLength(3);

    const stored = await linksOf(db, sourceId);
    expect(stored).toEqual(expect.arrayContaining(olderLinks));
  });

  test("refreshes the stats to cover both exports", async () => {
    const { db, first, sourceId, update } = await updated();
    const older = extractLinks(olderText, sourceId, "whatsapp").links;
    const newer = extractLinks(newerText, sourceId, "whatsapp").links;
    const both = [...older, ...newer];
    const messages = [olderText, newerText].flatMap((text) =>
      whatsapp.parse({ text }),
    );

    expect(update.stats).toEqual({
      messages: new Set(messages.map((m) => m.key)).size,
      links: 29,
      uniqueLinks: new Set(both.map((l) => l.urlKey)).size,
      domains: new Set(both.map((l) => l.domain)).size,
      skippedNonWeb: 1, // the mailto:, in the newer export only
      earliest: first.imported.stats.earliest, // from the older export
      latest: at(2026, 10, 22, 9, 5), // from the newer one
    });
    const source = await db.sources.get(sourceId);
    expect(source?.stats).toEqual(update.stats);
    expect(source?.importedAt).toBeLessThanOrEqual(source?.updatedAt ?? 0);
    expect(source?.name).toBe(
      (await db.sources.get(first.imported.sourceId))?.name,
    );
  });

  test("keeps the source's day/month order, whatever the choice says", async () => {
    const db = freshDb();
    const older = fixtureBytes("whatsapp-ambiguous-dates.txt").toString();
    const { imported } = await importInput(
      db,
      { text: older },
      { dateOrder: "MDY" },
    );
    const newer = `${older}12/06/2024, 08:00 - Cris: https://example.com/summer-list\n`;
    const scan = await scanInput(db, { text: newer });
    const update = await saveImport(db, scan, {
      updateOf: imported.sourceId,
      dateOrder: "DMY",
    });

    expect(update.newLinks).toBe(1); // read day first, all 7 would be new
    const source = await db.sources.get(imported.sourceId);
    expect(source?.options).toEqual({ dateOrder: "MDY" });
  });

  test("of a source that is gone fails and writes nothing", async () => {
    const db = freshDb();
    const scan = await scanInput(db, dropped("whatsapp-update-newer.txt"));
    await expect(
      saveImport(db, scan, { updateOf: "deleted-source" }),
    ).rejects.toThrow("deleted-source");
    expect(await rowCounts(db)).toEqual([0, 0, 0]);
  });

  test("of plain text is refused: its messages have no keys", async () => {
    const db = freshDb();
    const notes = { text: "https://example.com/a" };
    const { imported } = await importInput(db, notes);
    const scan = await scanInput(db, { text: `${notes.text}\nmore` });
    await expect(
      saveImport(db, scan, { updateOf: imported.sourceId }),
    ).rejects.toThrow("plaintext");
    expect(await rowCounts(db)).toEqual([1, 1, 1]);
  });
});

describe("a replace, for a file that isn't a chat (§6.1)", () => {
  const notes = (text: string, name = "notes.txt") => ({
    file: new File([text], name),
  });

  async function replaced() {
    const db = freshDb();
    const first = await importInput(
      db,
      notes("https://example.com/a\nhttps://example.com/b"),
    );
    const { sourceId } = first.imported;
    await db.sources.update(sourceId, { name: "My notes" }); // renamed since
    const importedAt = (await db.sources.get(sourceId))!.importedAt;
    const kept = (await linksOf(db, sourceId)).find((l) =>
      l.url.endsWith("/a"),
    )!;
    await toggleStar(db, kept);

    const scan = await scanInput(
      db,
      notes(
        "https://example.com/a\nhttps://example.com/c\nhttps://example.com/d",
      ),
    );
    expect(scan.result.replaceCandidate).toEqual({
      sourceId,
      sourceName: "My notes",
    });
    const replace = await saveImport(db, scan, { replaceOf: sourceId });
    return { db, sourceId, first, kept, replace, importedAt };
  }

  test("the source keeps its id, name and first import; its links are the new file's", async () => {
    const { db, sourceId, first, replace, importedAt } = await replaced();
    expect(replace).toMatchObject({
      sourceId,
      name: "My notes",
      how: "replaced",
      newLinks: 3,
    });
    const source = (await db.sources.get(sourceId))!;
    expect(source.importedAt).toBe(importedAt);
    expect(source.updatedAt).toBeGreaterThanOrEqual(importedAt);
    expect(source.stats.links).toBe(3);
    expect(first.imported.stats.links).toBe(2);
    expect((await linksOf(db, sourceId)).map((l) => l.url).sort()).toEqual([
      "https://example.com/a",
      "https://example.com/c",
      "https://example.com/d",
    ]);
  });

  test("a shorter file leaves none of the old file's links behind", async () => {
    const { db, sourceId } = await replaced();
    const scan = await scanInput(db, notes("https://example.com/e"));
    await saveImport(db, scan, { replaceOf: sourceId });
    expect((await linksOf(db, sourceId)).map((l) => l.url)).toEqual([
      "https://example.com/e",
    ]);
    expect(await db.links.count()).toBe(1);
  });

  test("the old file's part is gone: one part, the new text", async () => {
    const { db, sourceId } = await replaced();
    const parts = await db.sourceParts
      .where("sourceId")
      .equals(sourceId)
      .toArray();
    expect(parts).toHaveLength(1);
    expect(await decompressText(parts[0]!.raw)).toContain("example.com/d");
  });

  test("stars stay, by the link's address", async () => {
    const { db, kept } = await replaced();
    expect(await db.annotations.get(kept.urlKey)).toMatchObject({
      starred: 1,
    });
  });

  test("a chat is never replaced: it takes updates", async () => {
    const db = freshDb();
    const { imported } = await importInput(
      db,
      dropped("whatsapp-update-older.txt"),
    );
    const scan = await scanInput(db, notes("https://example.com/a"));
    await expect(
      saveImport(db, scan, { replaceOf: imported.sourceId }),
    ).rejects.toThrow("takes updates");
  });
});
