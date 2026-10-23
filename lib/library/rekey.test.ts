import Dexie from "dexie";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import type { Annotation, Source } from "@/lib/db/types";
import type { Link } from "@/lib/extract/types";
import { CANONICALIZER_VERSION } from "@/lib/extract/url/canonicalize";
import { describeUrl } from "@/lib/extract/url/describe";
import { CURRENT_CANONICALIZER, rekeyIfNeeded } from "./rekey";

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

// The canonicalizer after a bump: the same rules, a new version. Links are
// stored with stale keys, as the old version would have left them.
const NEXT = { ...CURRENT_CANONICALIZER, version: CANONICALIZER_VERSION + 1 };
const keyOf = (url: string) => describeUrl(url).urlKey;

let next = 0;

function link(url: string, staleKey: string, sourceId = "notes"): Link {
  next++;
  return {
    id: `l${next}`,
    sourceId,
    url,
    ...describeUrl(url),
    urlKey: staleKey,
    position: { line: next, column: 0, messageIndex: next },
  };
}

function source(id: string, links: Link[]): Source {
  return {
    id,
    name: id,
    kind: "plaintext",
    adapterVersion: 1,
    importedAt: 1,
    updatedAt: 1,
    stats: {
      messages: links.length,
      links: links.length,
      uniqueLinks: new Set(links.map((l) => l.urlKey)).size,
      domains: 1,
      skippedNonWeb: 0,
    },
    options: {},
  };
}

function star(urlKey: string, url: string, fields: Partial<Annotation> = {}) {
  return { urlKey, url, starred: 1 as const, updatedAt: 1, ...fields };
}

async function stored(links: Link[], annotations: Annotation[] = []) {
  const db = freshDb();
  await db.sources.add(source("notes", links));
  await db.links.bulkAdd(links);
  await db.annotations.bulkAdd(annotations);
  return db;
}

const keys = async (db: LinkVaultDb) =>
  (await db.annotations.toArray()).map((a) => a.urlKey).sort();

describe("the version", () => {
  test("a new library records it, and there's nothing else to do", async () => {
    const db = freshDb();
    expect(await rekeyIfNeeded(db)).toBeNull();
    expect(await db.settings.get("meta")).toEqual({
      key: "meta",
      canonicalizerVersion: CANONICALIZER_VERSION,
    });
  });

  test("up to date: nothing is touched", async () => {
    const stale = link("https://example.com/a", "old:a");
    const db = await stored([stale]);
    await db.settings.put({
      key: "meta",
      canonicalizerVersion: NEXT.version,
    });
    expect(await rekeyIfNeeded(db, NEXT)).toBeNull();
    expect((await db.links.get(stale.id))?.urlKey).toBe("old:a");
  });

  test("a library from before the meta row was keyed by version 1", async () => {
    const stale = link("https://example.com/a", "old:a");
    const db = await stored([stale]);
    expect(await rekeyIfNeeded(db, { ...NEXT, version: 1 })).toBeNull();
    expect((await db.links.get(stale.id))?.urlKey).toBe("old:a");

    expect(await rekeyIfNeeded(db, { ...NEXT, version: 2 })).toMatchObject({
      from: 1,
      to: 2,
      links: 1,
    });
    expect((await db.links.get(stale.id))?.urlKey).toBe(
      keyOf("https://example.com/a"),
    );
    expect(await db.settings.get("meta")).toEqual({
      key: "meta",
      canonicalizerVersion: 2,
    });
  });
});

describe("following the links", () => {
  test("merge: two keys become one; stars and tags join, the source counts one link", async () => {
    const tracked = "https://example.com/a?utm_source=chat";
    const clean = "https://example.com/a";
    const db = await stored(
      [link(tracked, "old:a1"), link(clean, "old:a2")],
      [
        star("old:a1", tracked, { tags: ["t1"], updatedAt: 1 }),
        // Newer, unstarred: the star still survives the merge.
        { urlKey: "old:a2", url: clean, tags: ["t2"], updatedAt: 2 },
      ],
    );

    expect(await rekeyIfNeeded(db, NEXT, 1)).toEqual({
      from: CANONICALIZER_VERSION,
      to: NEXT.version,
      links: 2,
      moved: 1,
    });
    const key = keyOf(clean);
    expect(new Set((await db.links.toArray()).map((l) => l.urlKey))).toEqual(
      new Set([key]),
    );
    expect(await keys(db)).toEqual([key]);
    const merged = (await db.annotations.get(key))!;
    expect(merged).toMatchObject({ starred: 1, updatedAt: 2 });
    expect(merged.tags?.sort()).toEqual(["t1", "t2"]);
    expect(keyOf(merged.url)).toBe(key); // re-keyable later from its url
    expect((await db.sources.get("notes"))?.stats.uniqueLinks).toBe(1);
  });

  test("split: one key becomes two, and the star goes to both", async () => {
    const db = await stored(
      [
        link("https://example.com/a", "old:ab"),
        link("https://example.com/b", "old:ab"),
      ],
      [star("old:ab", "https://example.com/a")],
    );
    await rekeyIfNeeded(db, NEXT);
    const a = keyOf("https://example.com/a");
    const b = keyOf("https://example.com/b");
    expect(await keys(db)).toEqual([a, b].sort());
    expect((await db.annotations.get(b))?.url).toBe("https://example.com/b");
    expect((await db.sources.get("notes"))?.stats.uniqueLinks).toBe(2);
  });

  test("keys that trade places: each row follows its own links", async () => {
    const k = keyOf("https://example.com/k");
    const n = keyOf("https://example.com/n");
    // The link stored under k now has n's key, and the one under old:j k's.
    const db = await stored(
      [
        link("https://example.com/n", k),
        link("https://example.com/k", "old:j"),
      ],
      [
        star(k, "https://example.com/n", { note: "was k" }),
        star("old:j", "https://example.com/k", { note: "was j" }),
      ],
    );
    await rekeyIfNeeded(db, NEXT);
    expect(await keys(db)).toEqual([k, n].sort());
    expect((await db.annotations.get(n))?.note).toBe("was k");
    expect((await db.annotations.get(k))?.note).toBe("was j");
  });

  test("a star on a link whose source was deleted moves by its own url", async () => {
    const url = "https://www.example.com/c/?utm_source=x";
    const db = await stored([], [star("old:gone", url)]);
    await rekeyIfNeeded(db, NEXT);
    expect(await keys(db)).toEqual([keyOf(url)]);
    expect(keyOf(url)).toBe("https://example.com/c");
  });

  test("rows that stay put aren't written again", async () => {
    const url = "https://example.com/a";
    const db = await stored(
      [link(url, keyOf(url))],
      [star(keyOf(url), url, { updatedAt: 7 })],
    );
    const put = vi.spyOn(db.annotations, "bulkPut");
    expect(await rekeyIfNeeded(db, NEXT)).toMatchObject({
      links: 0,
      moved: 0,
    });
    expect(put).toHaveBeenCalledWith([]);
    expect(await db.annotations.get(keyOf(url))).toMatchObject({
      updatedAt: 7,
    });
  });

  test("previews and classifications keep the newest row on a merge", async () => {
    const tracked = "https://example.com/a?utm_source=chat";
    const clean = "https://example.com/a";
    const db = await stored([link(tracked, "old:a1"), link(clean, "old:a2")]);
    await db.enrichments.bulkAdd([
      {
        urlKey: "old:a1",
        url: tracked,
        fetchedAt: 5,
        status: "ok",
        title: "Newer",
        provider: "og",
      },
      {
        urlKey: "old:a2",
        url: clean,
        fetchedAt: 1,
        status: "ok",
        title: "Older",
        provider: "og",
      },
    ]);
    await db.classifications.bulkAdd([
      {
        urlKey: "old:a1",
        url: tracked,
        tags: [],
        tagIds: ["t1"],
        inputHash: "h1",
        model: "m",
        promptVersion: 1,
        classifiedAt: 1,
      },
      {
        urlKey: "old:a2",
        url: clean,
        tags: [],
        tagIds: ["t2"],
        inputHash: "h2",
        model: "m",
        promptVersion: 1,
        classifiedAt: 9,
      },
    ]);
    await rekeyIfNeeded(db, NEXT);
    const key = keyOf(clean);
    expect(await db.enrichments.toArray()).toEqual([
      expect.objectContaining({ urlKey: key, title: "Newer" }),
    ]);
    expect(await db.classifications.toArray()).toEqual([
      expect.objectContaining({ urlKey: key, tagIds: ["t2"] }),
    ]);
  });
});

test("a URL the canonicalizer can't read keeps its key; the rest move on", async () => {
  const broken = link("https://example.com/x", "old:x");
  const fine = link("https://example.com/y", "old:y");
  const db = await stored([broken, fine], [star("old:x", broken.url)]);
  await rekeyIfNeeded(db, {
    version: NEXT.version,
    describe: (url) => {
      if (url === broken.url) throw new TypeError("Invalid URL");
      return describeUrl(url);
    },
  });
  expect((await db.links.get(broken.id))?.urlKey).toBe("old:x");
  expect((await db.links.get(fine.id))?.urlKey).toBe(keyOf(fine.url));
  expect(await keys(db)).toEqual(["old:x"]);
});

test("all or nothing: a failure part-way leaves the library as it was", async () => {
  const stale = link("https://example.com/a?utm_source=x", "old:a");
  const db = await stored([stale], [star("old:a", stale.url)]);
  vi.spyOn(db.annotations, "bulkPut").mockRejectedValue(new Error("disk"));
  await expect(rekeyIfNeeded(db, NEXT)).rejects.toThrow("disk");
  vi.restoreAllMocks();
  expect((await db.links.get(stale.id))?.urlKey).toBe("old:a");
  expect(await keys(db)).toEqual(["old:a"]);
  expect(await db.settings.get("meta")).toBeUndefined();
});
