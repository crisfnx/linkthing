import Dexie from "dexie";
import { afterEach, describe, expect, test } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { describeUrl } from "@/lib/extract/url/describe";
import { markLink, removedByCleaning, toggleStar } from "./details";

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

const cleaned = (url: string) =>
  removedByCleaning(url, describeUrl(url).canonicalUrl);

describe("what cleaning removed", () => {
  test.each([
    ["https://x.com/exampledev/status/1?s=20&t=AbCd", ["s", "t"]],
    [
      "https://www.theguardian.com/travel/x?utm_source=whatsapp&utm_medium=social&page=2",
      ["utm_source", "utm_medium"],
    ],
    ["https://youtu.be/Ex4mpLeV1d0?si=Zx9&t=95", ["si"]], // t is a timestamp here
    ["https://example.com/page", []],
    ["https://user:secret@example.com/page", ["user:password@"]],
  ])("%s → %j", (url, expected) => {
    expect(cleaned(url)).toEqual(expected);
  });
});

describe("the link in its message", () => {
  const link = {
    url: "https://x.com/exampledev/status/1?s=20",
    canonicalUrl: "https://x.com/exampledev/status/1",
  };

  test("marked where it appears", () => {
    expect(
      markLink(
        "Best thing all week https://x.com/exampledev/status/1?s=20 😂",
        link,
      ),
    ).toEqual([
      { text: "Best thing all week ", link: false },
      { text: "https://x.com/exampledev/status/1?s=20", link: true },
      { text: " 😂", link: false },
    ]);
  });

  test("written without https:// (a bare domain)", () => {
    const bare = {
      url: "https://bbcgoodfood.com/recipes/custard-tarts",
      canonicalUrl: "https://bbcgoodfood.com/recipes/custard-tarts",
    };
    expect(markLink("try bbcgoodfood.com/recipes/custard-tarts", bare)).toEqual(
      [
        { text: "try ", link: false },
        { text: "bbcgoodfood.com/recipes/custard-tarts", link: true },
      ],
    );
  });

  test("cut off by the 200-character context: just the text", () => {
    expect(markLink("…the start of a long message", link)).toEqual([
      { text: "…the start of a long message", link: false },
    ]);
  });
});

describe("the star", () => {
  const link = {
    urlKey: "https://twitter.com/i/status/1",
    url: "https://x.com/a/status/1",
  };

  test("toggles, and goes away entirely when nothing else is on the link", async () => {
    const db = freshDb();
    expect(await toggleStar(db, link)).toBe(true);
    expect(await db.annotations.get(link.urlKey)).toMatchObject({
      url: link.url,
      starred: true,
    });
    expect(await toggleStar(db, link)).toBe(false);
    expect(await db.annotations.count()).toBe(0);
  });

  test("unstarring keeps the rest of the annotation", async () => {
    const db = freshDb();
    await db.annotations.put({
      urlKey: link.urlKey,
      url: "https://twitter.com/a/status/1",
      tags: ["recipes"],
      starred: true,
      updatedAt: 1,
    });
    expect(await toggleStar(db, link)).toBe(false);
    expect(await db.annotations.get(link.urlKey)).toMatchObject({
      url: "https://twitter.com/a/status/1", // the first as-found URL stays
      tags: ["recipes"],
      starred: false,
    });
  });
});
