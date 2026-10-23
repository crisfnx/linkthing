import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import Dexie from "dexie";
import { afterEach, describe, expect, test } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { decompressText } from "@/lib/db/raw";
import { InputError } from "@/lib/extract/input";
import { CANONICALIZER_VERSION } from "@/lib/extract/url/canonicalize";
import type { Link } from "@/lib/extract/types";
import { describeUrl } from "@/lib/extract/url/describe";
import type { ImportProgress } from "@/lib/import/options";
import { saveImport } from "@/lib/import/save";
import { scanInput } from "@/lib/import/scan";
import { toggleStar } from "@/lib/library/details";
import { CURRENT_CANONICALIZER } from "@/lib/library/rekey";
import { deleteEverything } from "@/lib/library/sources";
import { readSettings, saveSettings } from "@/lib/settings";
import { backupFileName, looksLikeBackup } from "./format";
import { BackupError, restoreBackup } from "./restore";
import { writeBackup } from "./write";

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

const fixture = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url));

async function importFile(db: LinkVaultDb, name: string, updateOf?: string) {
  const scan = await scanInput(db, { file: new File([fixture(name)], name) });
  return saveImport(db, scan, updateOf ? { updateOf } : {});
}

// A chat updated once (two parts), plain text, a star and a setting.
async function library() {
  const db = freshDb();
  const chat = await importFile(db, "whatsapp-update-older.txt");
  await importFile(db, "whatsapp-update-newer.txt", chat.sourceId);
  await importFile(db, "plaintext.txt");
  const starred = (await db.links.toCollection().first())!;
  await toggleStar(db, starred);
  await saveSettings(db, { theme: "dark" });
  return db;
}

// Everything a restore should bring back, comparable as plain data.
async function contents(db: LinkVaultDb) {
  const byId = <T extends { id: string }>(rows: T[]) =>
    rows.sort((a, b) => a.id.localeCompare(b.id));
  const parts = await Promise.all(
    byId(await db.sourceParts.toArray()).map(async ({ raw, ...part }) => ({
      ...part,
      text: await decompressText(raw),
    })),
  );
  return {
    sources: byId(await db.sources.toArray()),
    parts,
    links: byId(await db.links.toArray()),
    annotations: await db.annotations.toArray(),
  };
}

const gzipLines = (lines: unknown[]) =>
  new Blob([gzipSync(lines.map((l) => JSON.stringify(l)).join("\n") + "\n")]);

async function linesOf(file: Blob): Promise<Record<string, unknown>[]> {
  const text = gunzipSync(Buffer.from(await file.arrayBuffer())).toString();
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

describe("a backup", () => {
  test("gzipped JSON Lines: a header, then one record a line", async () => {
    const db = await library();
    const { file, counts } = await writeBackup(db, { now: 7 });
    expect(file.type).toBe("application/gzip");
    expect(await looksLikeBackup(file)).toBe(true);
    const lines = await linesOf(file);
    expect(lines[0]).toEqual({
      linkvault: "backup",
      version: 1,
      exportedAt: 7,
      canonicalizerVersion: CANONICALIZER_VERSION,
      counts,
    });
    expect(lines[1]).toEqual({ settings: { theme: "dark" } });
    expect(counts).toEqual({
      sources: 2,
      parts: 3,
      links: await db.links.count(),
      annotations: 1,
    });
    // Parts carry their text, decoded; the file as a whole is compressed.
    const part = lines.find((l) => "part" in l)!.part as { text: string };
    expect(part.text).toContain("http");
    expect(backupFileName(new Date(2026, 9, 3))).toBe(
      "linkvault-backup-2026-10-03.jsonl.gz",
    );
  });
});

describe("restoring", () => {
  test("backup → delete everything → restore: the same library", async () => {
    const db = await library();
    const before = await contents(db);
    const { file } = await writeBackup(db);
    await deleteEverything(db);

    const progress: ImportProgress[] = [];
    const restored = await restoreBackup(db, file, {
      onProgress: (p) => progress.push(p),
    });
    expect(restored).toEqual({
      sources: 2,
      links: before.links.length,
      stars: 1,
      alreadyHere: 0,
    });
    expect(await contents(db)).toEqual(before);
    expect(progress.map((p) => p.phase)).toEqual(
      expect.arrayContaining(["reading", "parsing", "saving"]),
    );
  });

  test("twice changes nothing", async () => {
    const db = await library();
    const { file } = await writeBackup(db);
    const before = await contents(db);
    expect(await restoreBackup(db, file)).toEqual({
      sources: 0,
      links: 0,
      stars: 0,
      alreadyHere: 2,
    });
    expect(await contents(db)).toEqual(before);
  });

  test("a chat imported again since, under a new id, is already here", async () => {
    const db = freshDb();
    await importFile(db, "plaintext.txt");
    const { file } = await writeBackup(db);
    await deleteEverything(db);
    await importFile(db, "plaintext.txt"); // a new source, the same text
    const links = await db.links.count();
    expect(await restoreBackup(db, file)).toMatchObject({
      sources: 0,
      alreadyHere: 1,
    });
    expect(await db.links.count()).toBe(links);
  });

  test("stars merge: one starred in the backup, tagged here, keeps both", async () => {
    const db = await library();
    const { file } = await writeBackup(db);
    const [star] = await db.annotations.toArray();
    await db.annotations.put({
      urlKey: star!.urlKey,
      url: star!.url,
      tags: ["mine"],
      updatedAt: Date.now(),
    });
    expect((await restoreBackup(db, file)).stars).toBe(1);
    expect(await db.annotations.get(star!.urlKey)).toMatchObject({
      starred: 1,
      tags: ["mine"],
    });
  });

  test("settings come back to a browser that has none, never over chosen ones", async () => {
    const db = await library();
    const { file } = await writeBackup(db);

    const fresh = freshDb();
    await restoreBackup(fresh, file);
    expect((await readSettings(fresh)).theme).toBe("dark");

    await saveSettings(db, { theme: "light" });
    await restoreBackup(db, file);
    expect((await readSettings(db)).theme).toBe("light");
  });

  test("a link with every field set comes back with all of them", async () => {
    const url = "https://example.com/recipes/custard-tarts?utm_source=x";
    const full: Link = {
      id: "l1",
      sourceId: "s1",
      messageKey: "m1",
      url,
      ...describeUrl(url),
      title: "Custard tarts",
      folder: "Bookmarks bar › Recipes",
      context: "try these",
      nearby: "for Sunday",
      timestamp: 1_700_000_000_000,
      sender: "Ana",
      isBare: true,
      position: { line: 3, column: 4, messageIndex: 2 },
    };
    const db = freshDb();
    await db.sources.add({
      id: "s1",
      name: "Notes",
      kind: "plaintext",
      adapterVersion: 1,
      importedAt: 1,
      updatedAt: 2,
      stats: {
        messages: 1,
        links: 1,
        uniqueLinks: 1,
        domains: 1,
        skippedNonWeb: 0,
        earliest: 1,
        latest: 2,
      },
      options: { dateOrder: "MDY" },
    });
    await db.links.add(full);
    const fresh = freshDb();
    await restoreBackup(fresh, (await writeBackup(db)).file);
    expect(await fresh.links.get("l1")).toEqual(full);
    expect(await fresh.sources.get("s1")).toEqual(await db.sources.get("s1"));
  });

  test("plain JSON Lines, not gzipped, restore too", async () => {
    const db = await library();
    const { file } = await writeBackup(db);
    const plain = new Blob([gunzipSync(Buffer.from(await file.arrayBuffer()))]);
    const fresh = freshDb();
    expect((await restoreBackup(fresh, plain)).sources).toBe(2);
  });

  test("keys from another canonicalizer version are brought up to date", async () => {
    const url = "https://example.com/a?utm_source=x";
    const stale = {
      id: "l1",
      sourceId: "s1",
      url,
      ...describeUrl(url),
      urlKey: "old:a",
      position: { line: 1, column: 0, messageIndex: 0 },
    };
    const file = gzipLines([
      {
        linkvault: "backup",
        version: 1,
        exportedAt: 1,
        canonicalizerVersion: 0,
        counts: { sources: 1, parts: 0, links: 1, annotations: 1 },
      },
      {
        source: {
          id: "s1",
          name: "Notes",
          kind: "plaintext",
          adapterVersion: 1,
          importedAt: 1,
          updatedAt: 1,
          stats: {
            messages: 1,
            links: 1,
            uniqueLinks: 1,
            domains: 1,
            skippedNonWeb: 0,
          },
          options: {},
        },
      },
      { link: stale },
      { annotation: { urlKey: "old:a", url, starred: 1, updatedAt: 1 } },
    ]);
    const db = freshDb();
    await restoreBackup(db, file, { canonicalizer: CURRENT_CANONICALIZER });
    const key = describeUrl(url).urlKey;
    expect((await db.links.get("l1"))?.urlKey).toBe(key);
    expect(await db.annotations.get(key)).toMatchObject({ starred: 1 });
  });
});

describe("a file that can't be restored is refused, and nothing is written", () => {
  async function refused(file: Blob, message: string | RegExp) {
    const db = freshDb();
    await expect(restoreBackup(db, file)).rejects.toThrow(message);
    await expect(restoreBackup(db, file)).rejects.toBeInstanceOf(BackupError);
    expect(await db.sources.count()).toBe(0);
    expect(await db.links.count()).toBe(0);
  }

  test("not a backup at all", async () => {
    await refused(
      new Blob([fixture("plaintext.txt")]),
      "This isn't a LinkVault backup.",
    );
    await refused(new Blob([]), "This file is empty.");
  });

  test("from a newer LinkVault", async () => {
    await refused(
      gzipLines([
        {
          linkvault: "backup",
          version: 2,
          exportedAt: 1,
          canonicalizerVersion: 1,
          counts: { sources: 0, parts: 0, links: 0, annotations: 0 },
        },
      ]),
      "from a newer version of LinkVault",
    );
  });

  test("cut short, damaged, or edited into something else", async () => {
    const lines = await linesOf((await writeBackup(await library())).file);
    // The download stopped before the end.
    await refused(gzipLines(lines.slice(0, -3)), "The backup is incomplete");
    // A link edited into a kind LinkVault doesn't know.
    const at = lines.findIndex((l) => "link" in l);
    const edited = structuredClone(lines);
    (edited[at]!.link as { kind: string }).kind = "evil";
    await refused(
      gzipLines(edited),
      new RegExp(`^Line ${at + 1} isn't a record LinkVault can read`),
    );
    // A link whose source isn't in the file.
    const orphan = structuredClone(lines);
    (orphan[at]!.link as { sourceId: string }).sourceId = "nowhere";
    await refused(gzipLines(orphan), "some links belong to no source in it");
    // Bytes lost from the middle of the compressed file.
    const whole = new Uint8Array(await gzipLines(lines).arrayBuffer());
    const broken = new Blob([whole.slice(0, 40), whole.slice(200)]);
    await refused(broken, /damaged|isn't valid JSON|isn't a LinkVault backup/);
  });
});

describe("importing a backup by mistake", () => {
  test("is refused, dropped or pasted, rather than read as links", async () => {
    const db = await library();
    const { file } = await writeBackup(db);
    const dropped = new File([file], "linkvault-backup-2026-10-23.jsonl.gz");
    await expect(scanInput(db, { file: dropped })).rejects.toEqual(
      new InputError("is-backup"),
    );
    const text = gunzipSync(Buffer.from(await file.arrayBuffer())).toString();
    await expect(scanInput(db, { text })).rejects.toMatchObject({
      code: "is-backup",
    });
  });
});
