import Dexie from "dexie";
import { afterEach, expect, test } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import type { Meta } from "@/lib/db/types";
import { defaultSettings, readSettings, saveSettings } from "./settings";

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

test("nothing stored: the defaults, the day/month order from the language", async () => {
  const db = freshDb();
  expect(await readSettings(db, "en-GB")).toEqual({
    theme: "system",
    defaultDateOrder: "DMY",
    findBareDomains: true,
    dedupeByDefault: false,
  });
  expect((await readSettings(db, "en-US")).defaultDateOrder).toBe("MDY");
  expect(defaultSettings("de-DE").defaultDateOrder).toBe("DMY");
});

test("a change is stored alone; the rest stay defaults", async () => {
  const db = freshDb();
  await saveSettings(db, { dedupeByDefault: true });
  await saveSettings(db, { theme: "dark" });
  expect(await db.settings.get("settings")).toEqual({
    key: "settings",
    dedupeByDefault: true,
    theme: "dark",
  });
  // Not stored, so it still follows the language.
  expect((await readSettings(db, "en-US")).defaultDateOrder).toBe("MDY");
  expect(await readSettings(db, "en-GB")).toEqual({
    theme: "dark",
    defaultDateOrder: "DMY",
    findBareDomains: true,
    dedupeByDefault: true,
  });
});

test("a chosen day/month order holds whatever the language", async () => {
  const db = freshDb();
  await saveSettings(db, { defaultDateOrder: "MDY" });
  expect((await readSettings(db, "en-GB")).defaultDateOrder).toBe("MDY");
});

test("the meta row is left alone", async () => {
  const db = freshDb();
  const meta: Meta = { key: "meta", canonicalizerVersion: 1 };
  await db.settings.put(meta);
  await saveSettings(db, { findBareDomains: false });
  expect(await db.settings.get("meta")).toEqual({
    key: "meta",
    canonicalizerVersion: 1,
  });
  expect((await readSettings(db)).findBareDomains).toBe(false);
});
