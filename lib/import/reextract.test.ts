import { readFileSync } from "node:fs";
import Dexie from "dexie";
import { afterEach, describe, expect, test } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import type { Link } from "@/lib/extract/types";
import { toggleStar } from "@/lib/library/details";
import type { ImportProgress } from "./options";
import { reextractSource } from "./reextract";
import { saveImport, type ImportChoice } from "./save";
import { scanInput, type ScanInput } from "./scan";

const fixtureBytes = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url));
const dropped = (name: string) => ({
  file: new File([fixtureBytes(name)], name),
});

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

async function imported(
  db: LinkVaultDb,
  input: ScanInput,
  choice: ImportChoice = {},
) {
  return saveImport(db, await scanInput(db, input), choice);
}

const linksOf = async (db: LinkVaultDb, sourceId: string) =>
  (await db.links.where("sourceId").equals(sourceId).toArray()).sort(
    (a: Link, b: Link) => a.id.localeCompare(b.id),
  );

describe("read again as it was", () => {
  test("the same links, the same ids, stars kept; updatedAt moves", async () => {
    const db = freshDb();
    const { sourceId } = await imported(db, dropped("whatsapp-group-gb.txt"));
    const before = await linksOf(db, sourceId);
    const source = (await db.sources.get(sourceId))!;
    await toggleStar(db, before[0]!);

    const progress: ImportProgress[] = [];
    const result = await reextractSource(
      db,
      sourceId,
      {},
      {
        onProgress: (p) => progress.push(p),
      },
    );

    expect(result).toMatchObject({
      sourceId,
      name: source.name,
      how: "reextracted",
      newLinks: before.length,
    });
    expect(await linksOf(db, sourceId)).toEqual(before);
    expect(await db.annotations.get(before[0]!.urlKey)).toMatchObject({
      starred: true,
    });
    const after = (await db.sources.get(sourceId))!;
    expect(after.updatedAt).toBeGreaterThanOrEqual(source.updatedAt);
    expect(after.importedAt).toBe(source.importedAt);
    expect(progress.map((p) => p.phase)).toEqual(
      expect.arrayContaining(["reading", "parsing", "extracting", "saving"]),
    );
  });
});

describe("read another way", () => {
  test("the other day/month order: other dates, and the source keeps it", async () => {
    const db = freshDb();
    const { sourceId } = await imported(
      db,
      dropped("whatsapp-ambiguous-dates.txt"),
      { dateOrder: "DMY" },
    );
    const dmy = await linksOf(db, sourceId);

    await reextractSource(db, sourceId, { dateOrder: "MDY" });
    const mdy = await linksOf(db, sourceId);
    expect(mdy).toHaveLength(dmy.length);
    expect(mdy.map((l) => l.timestamp)).not.toEqual(
      dmy.map((l) => l.timestamp),
    );
    expect((await db.sources.get(sourceId))?.options).toEqual({
      dateOrder: "MDY",
    });
  });

  test("a chat read as plain text: the same URLs, no senders, plain text from now on", async () => {
    const db = freshDb();
    const { sourceId } = await imported(db, dropped("whatsapp-group-gb.txt"));
    const asChat = await linksOf(db, sourceId);

    const result = await reextractSource(db, sourceId, { kind: "plaintext" });
    const asText = await linksOf(db, sourceId);
    expect(new Set(asText.map((l) => l.url))).toEqual(
      new Set(asChat.map((l) => l.url)),
    );
    expect(asText.every((l) => l.sender === undefined)).toBe(true);
    expect(result.stats.links).toBe(asText.length);
    expect(await db.sources.get(sourceId)).toMatchObject({
      kind: "plaintext",
      options: {},
    });
  });

  test("an updated chat is read from all its exports, merged", async () => {
    const db = freshDb();
    const first = await imported(db, dropped("whatsapp-update-older.txt"));
    const update = await imported(db, dropped("whatsapp-update-newer.txt"), {
      updateOf: first.sourceId,
    });
    const before = await linksOf(db, first.sourceId);

    const again = await reextractSource(db, first.sourceId);
    expect(again.stats).toEqual(update.stats);
    expect(await linksOf(db, first.sourceId)).toEqual(before);
  });

  test("several exports can't be read as plain text: their messages merge by key", async () => {
    const db = freshDb();
    const first = await imported(db, dropped("whatsapp-update-older.txt"));
    await imported(db, dropped("whatsapp-update-newer.txt"), {
      updateOf: first.sourceId,
    });
    await expect(
      reextractSource(db, first.sourceId, { kind: "plaintext" }),
    ).rejects.toThrow("read as a chat");
  });

  test("a source read by an older adapter gets the current version", async () => {
    const db = freshDb();
    const { sourceId } = await imported(db, dropped("plaintext.txt"));
    await db.sources.update(sourceId, { adapterVersion: 0 });
    await reextractSource(db, sourceId);
    expect((await db.sources.get(sourceId))?.adapterVersion).toBe(1);
  });
});

test("cancelled while saving, the source stays as it was", async () => {
  const db = freshDb();
  const text = Array.from(
    { length: 1200 },
    (_, i) => `https://example.com/${i}`,
  ).join("\n");
  const { sourceId } = await imported(db, { text });
  const source = await db.sources.get(sourceId);
  const before = await linksOf(db, sourceId);

  const controller = new AbortController();
  await expect(
    reextractSource(
      db,
      sourceId,
      { kind: "plaintext" },
      {
        signal: controller.signal,
        onProgress: (p) => {
          if (p.done === 1000) controller.abort();
        },
      },
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(await db.sources.get(sourceId)).toEqual(source);
  expect(await linksOf(db, sourceId)).toEqual(before);
});

test("a source that's gone is an error", async () => {
  await expect(reextractSource(freshDb(), "nope")).rejects.toThrow(
    "No source nope",
  );
});
