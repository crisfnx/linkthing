import { readFileSync } from "node:fs";
import Dexie from "dexie";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { saveImport } from "@/lib/import/save";
import { scanInput } from "@/lib/import/scan";
import { toggleStar } from "./details";
import { readSettings, saveSettings } from "@/lib/settings";
import {
  cleanSourceName,
  deleteEverything,
  deleteSource,
  renameSource,
  SourceNameError,
} from "./sources";

const opened: Dexie[] = [];

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

async function importFixture(db: LinkVaultDb, name: string, as = name) {
  const bytes = readFileSync(
    new URL(`../../tests/fixtures/${name}`, import.meta.url),
  );
  const scan = await scanInput(db, { file: new File([bytes], as) });
  return saveImport(db, scan, {});
}

const counts = async (db: LinkVaultDb) => ({
  sources: await db.sources.count(),
  parts: await db.sourceParts.count(),
  links: await db.links.count(),
});

describe("names", () => {
  test.each([
    ["  Chat  with   Me ", "Chat with Me"],
    ["Notes", "Notes"],
  ])("%j is kept as %j", (name, expected) => {
    expect(cleanSourceName(name)).toBe(expected);
  });

  test.each([
    ["   ", "empty"],
    ["x".repeat(201), "too-long"],
  ])("%j is refused (%s)", (name, reason) => {
    expect(() => cleanSourceName(name)).toThrow(
      expect.objectContaining({ reason }),
    );
  });

  test("a rename changes the name alone", async () => {
    const db = freshDb();
    const { sourceId } = await importFixture(db, "whatsapp-group-gb.txt");
    const before = (await db.sources.get(sourceId))!;
    await renameSource(db, sourceId, "  Weekend   crew ");
    expect(await db.sources.get(sourceId)).toEqual({
      ...before,
      name: "Weekend crew",
    });
  });

  test("an empty name is refused and nothing changes", async () => {
    const db = freshDb();
    const { sourceId, name } = await importFixture(db, "plaintext.txt");
    await expect(renameSource(db, sourceId, " ")).rejects.toThrow(
      SourceNameError,
    );
    expect((await db.sources.get(sourceId))?.name).toBe(name);
  });
});

describe("deleting", () => {
  test("the source, its parts and its links go; other sources stay", async () => {
    const db = freshDb();
    const chat = await importFixture(db, "whatsapp-update-older.txt");
    const notes = await importFixture(db, "plaintext.txt");
    const before = await counts(db);

    expect(await deleteSource(db, chat.sourceId)).toEqual({
      links: chat.stats.links,
    });
    expect(await counts(db)).toEqual({
      sources: before.sources - 1,
      parts: before.parts - 1,
      links: before.links - chat.stats.links,
    });
    expect(
      await db.links.where("sourceId").equals(notes.sourceId).count(),
    ).toBe(notes.stats.links);
  });

  test("a chat updated twice loses every part", async () => {
    const db = freshDb();
    const older = await importFixture(db, "whatsapp-update-older.txt");
    const scan = await scanInput(db, {
      file: new File(
        [
          readFileSync(
            new URL(
              "../../tests/fixtures/whatsapp-update-newer.txt",
              import.meta.url,
            ),
          ),
        ],
        "whatsapp-update-newer.txt",
      ),
    });
    await saveImport(db, scan, { updateOf: older.sourceId });
    expect(await db.sourceParts.count()).toBe(2);

    await deleteSource(db, older.sourceId);
    expect(await counts(db)).toEqual({ sources: 0, parts: 0, links: 0 });
  });

  test("stars stay with the link's address, for when it comes back", async () => {
    const db = freshDb();
    const { sourceId } = await importFixture(db, "whatsapp-update-older.txt");
    const link = (await db.links.where("sourceId").equals(sourceId).first())!;
    await toggleStar(db, link);

    await deleteSource(db, sourceId);
    expect(await db.annotations.get(link.urlKey)).toMatchObject({
      starred: 1,
    });
  });

  test("all or nothing: a failure part-way leaves everything", async () => {
    const db = freshDb();
    const { sourceId } = await importFixture(db, "whatsapp-update-older.txt");
    const before = await counts(db);
    vi.spyOn(db.sources, "delete").mockRejectedValue(new Error("disk"));

    await expect(deleteSource(db, sourceId)).rejects.toThrow("disk");
    expect(await counts(db)).toEqual(before);
  });

  test("a source that's gone already is an error", async () => {
    await expect(deleteSource(freshDb(), "nope")).rejects.toThrow(
      "No source nope",
    );
  });
});

test("delete everything: sources, parts, links and stars go; settings stay", async () => {
  const db = freshDb();
  await importFixture(db, "whatsapp-update-older.txt");
  const { sourceId } = await importFixture(db, "plaintext.txt");
  const link = (await db.links.where("sourceId").equals(sourceId).first())!;
  await toggleStar(db, link);
  await saveSettings(db, { theme: "dark" });

  await deleteEverything(db);
  expect(await counts(db)).toEqual({ sources: 0, parts: 0, links: 0 });
  expect(await db.annotations.count()).toBe(0);
  expect((await readSettings(db)).theme).toBe("dark");
});
