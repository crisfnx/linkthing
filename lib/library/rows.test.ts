import { readFileSync } from "node:fs";
import Dexie from "dexie";
import { afterEach, describe, expect, test } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { extractLinks } from "@/lib/extract/pipeline";
import type { Link } from "@/lib/extract/types";
import { describeUrl } from "@/lib/extract/url/describe";
import { saveImport } from "@/lib/import/save";
import { scanInput } from "@/lib/import/scan";
import { syntheticExport } from "@/tests/synthetic";
import {
  BARE,
  foldForSearch,
  kindAt,
  loadRows,
  RowsBuilder,
  SHORTENED,
  textAt,
  transferablesOf,
  type LibraryRows,
} from "./rows";

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

let nextId = 0;

// A stored link, described as the import describes it.
function link(url: string, fields: Partial<Link> = {}): Link {
  nextId++;
  return {
    id: `link-${nextId}`,
    sourceId: "chat",
    url,
    ...describeUrl(url),
    position: { line: nextId, column: 0, messageIndex: nextId },
    ...fields,
  };
}

const at = (y: number, mo: number, d: number) => Date.UTC(y, mo - 1, d);

function build(links: Link[], sourceIds?: string[]): LibraryRows {
  const builder = new RowsBuilder(sourceIds);
  links.forEach((l) => builder.add(l));
  return builder.finish();
}

const column = (rows: LibraryRows, name: "ids" | "titles" | "urls") =>
  Array.from({ length: rows.count }, (_, i) => textAt(rows[name], i));

describe("order", () => {
  test("newest first; undated last, latest import first, then in file order", () => {
    const rows = build(
      [
        link("https://example.com/older", {
          id: "older",
          timestamp: at(2024, 1, 1),
        }),
        link("https://example.com/b", {
          id: "notes-b",
          sourceId: "notes",
          position: { line: 9, column: 0, messageIndex: 1 },
        }),
        link("https://example.com/newer", {
          id: "newer",
          timestamp: at(2025, 1, 1),
        }),
        link("https://example.com/a", {
          id: "notes-a",
          sourceId: "notes",
          position: { line: 2, column: 0, messageIndex: 0 },
        }),
        link("https://example.com/old-paste", {
          id: "old-paste",
          sourceId: "old",
        }),
      ],
      ["notes", "chat", "old"], // newest import first
    );
    expect(column(rows, "ids")).toEqual([
      "newer",
      "older",
      "notes-a",
      "notes-b",
      "old-paste",
    ]);
  });

  test("an undated link reads as NaN, a dated one as its time", () => {
    const rows = build([
      link("https://example.com/a", { timestamp: at(2025, 1, 1) }),
      link("https://example.com/b"),
    ]);
    expect(Array.from(rows.timestamps)).toEqual([at(2025, 1, 1), NaN]);
  });
});

describe("what each row carries", () => {
  test("a readable title and URL, or no title when the URL says nothing", () => {
    const rows = build([
      link(
        "https://www.theguardian.com/travel/2026/mar/10/lisbon-beyond-the-trams?utm_source=whatsapp",
        { timestamp: 3 },
      ),
      link("https://x.com/exampledev/status/1900000000000000001?s=20", {
        timestamp: 2,
      }),
      link("https://bit.ly/ex4mpleCP", { timestamp: 1 }),
    ]);
    expect(column(rows, "titles")).toEqual([
      "Lisbon beyond the trams",
      "Post by @exampledev",
      "",
    ]);
    expect(column(rows, "urls")).toEqual([
      "theguardian.com/travel/2026/mar/10/lisbon-beyond-the-trams",
      "x.com/exampledev/status/1900000000000000001",
      "bit.ly/ex4mpleCP",
    ]);
  });

  test("kinds, flags, and sites, senders and sources by number", () => {
    const rows = build(
      [
        link("https://youtu.be/Ex4mpLeV1d0", { sender: "Ana", timestamp: 4 }),
        link("https://bit.ly/ex4mpleCP", { sender: "Ben", timestamp: 3 }),
        link("https://codesandbox.io/s/x", { isBare: true, timestamp: 2 }),
        link("https://www.youtube.com/watch?v=Ex4mpLeV1d0", {
          sender: "Ana",
          sourceId: "other",
          timestamp: 1,
        }),
      ],
      ["chat", "other"],
    );
    expect(Array.from({ length: 4 }, (_, i) => kindAt(rows, i))).toEqual([
      "video",
      "other",
      "code",
      "video",
    ]);
    expect(Array.from(rows.flags)).toEqual([0, SHORTENED, BARE, 0]);
    expect(Array.from(rows.domains, (d) => rows.domainNames[d])).toEqual([
      "youtube.com",
      "bit.ly",
      "codesandbox.io",
      "youtube.com",
    ]);
    expect(Array.from(rows.senders, (s) => rows.senderNames[s])).toEqual([
      "Ana",
      "Ben",
      "", // no sender
      "Ana",
    ]);
    expect(Array.from(rows.sources, (s) => rows.sourceIds[s])).toEqual([
      "chat",
      "chat",
      "chat",
      "other",
    ]);
  });

  test("duplicates share a key: the same video shared two ways", () => {
    const rows = build([
      link("https://youtu.be/Ex4mpLeV1d0?si=Zx9", { timestamp: 3 }),
      link("https://example.com/a", { timestamp: 2 }),
      link("https://www.youtube.com/watch?v=Ex4mpLeV1d0", { timestamp: 1 }),
    ]);
    expect(rows.keys[0]).toBe(rows.keys[2]);
    expect(rows.keys[1]).not.toBe(rows.keys[0]);
    expect(rows.keyCount).toBe(2);
  });
});

describe("search text", () => {
  test("URL, title, context, nearby, sender and every name of the site", () => {
    const rows = build([
      link("https://twitter.com/exampledev/status/1?s=20", {
        context: "Ha!\nThe best one",
        nearby: "Saved for the Belém trip",
        sender: "Ana",
      }),
    ]);
    const text = textAt(rows.search, 0);
    for (const part of [
      "twitter.com/exampledev/status/1",
      "post by @exampledev",
      "ha! the best one", // newlines folded
      "saved for the belem trip", // accents off
      "ana",
      "x.com", // the alias, though the link says twitter.com
    ]) {
      expect(text).toContain(part);
    }
  });

  test("the URL as found too, when cleaning changed it", () => {
    const rows = build([link("https://youtu.be/Ex4mpLeV1d0?si=Zx9")]);
    expect(textAt(rows.search, 0)).toContain("youtu.be/ex4mplev1d0");
  });

  test("rows are kept apart, so a search can't match across two", () => {
    const rows = build([
      link("https://example.com/ab", { timestamp: 2 }),
      link("https://example.com/cd", { timestamp: 1 }),
    ]);
    expect(rows.search.text).toContain("\0");
    expect(rows.search.text.split("\0")).toHaveLength(2);
  });

  test.each([
    ["Belém Tower", "belem tower"],
    ["  Two\n\tlines  ", "two lines"],
    ["ÉCLAIR", "eclair"],
    ["plain ascii", "plain ascii"],
  ])("foldForSearch(%j) → %j", (input, expected) => {
    expect(foldForSearch(input)).toBe(expected);
  });
});

test("the number columns go to the page by transfer, not copy", () => {
  const rows = build([link("https://example.com/a")]);
  const transfer = transferablesOf(rows);
  expect(new Set(transfer).size).toBe(11);

  const received = structuredClone(rows, { transfer });
  expect(rows.timestamps.length).toBe(0); // moved: detached here
  expect(received.count).toBe(1);
  expect(textAt(received.urls, 0)).toBe("example.com/a");
});

describe("loading from the database", () => {
  async function importSample(db: LinkVaultDb) {
    const bytes = readFileSync(
      new URL("../../public/sample-chat.txt", import.meta.url),
    );
    const scan = await scanInput(db, {
      file: new File([bytes], "WhatsApp Chat with Sample chat.txt"),
    });
    return saveImport(db, scan, {});
  }

  test("the sample: every link, its distinct links and sites, newest first", async () => {
    const db = freshDb();
    const { sourceId } = await importSample(db);
    const rows = await loadRows(db);

    expect(rows.count).toBe(56);
    expect(rows.keyCount).toBe(51);
    expect(rows.domainNames).toHaveLength(33);
    expect(rows.sourceIds).toEqual([sourceId]);
    // 09/09/2026, 08:55 - Ana: Look what's back https://m.youtube.com/…
    expect(textAt(rows.titles, 0)).toBe("YouTube video");
    expect(rows.senderNames[rows.senders[0]!]).toBe("Ana");
    const times = Array.from(rows.timestamps);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  test("read a page at a time, the rows are the same", async () => {
    const db = freshDb();
    await importSample(db);
    expect(await loadRows(db, 7)).toEqual(await loadRows(db));
  });

  test("an empty library has no rows", async () => {
    const rows = await loadRows(freshDb());
    expect(rows.count).toBe(0);
    expect(rows.search.text).toBe("");
  });
});

test("rows for a 10 MB export (98 k links) build in well under a second", () => {
  const { links } = extractLinks(
    syntheticExport(10_000_000),
    "big",
    "whatsapp",
  );
  const started = performance.now();
  const builder = new RowsBuilder(["big"]);
  for (const l of links) builder.add(l);
  const rows = builder.finish();
  const elapsed = performance.now() - started;
  console.log(
    `rows: ${rows.count} links in ${Math.round(elapsed)} ms; search text ${Math.round(rows.search.text.length / 1e6)} M chars`,
  );
  expect(rows.count).toBeGreaterThan(90_000);
  // CI machines are slower than the M-series laptop the budget is set for.
  expect(elapsed).toBeLessThan(process.env.CI ? 3000 : 1000);
}, 30_000);
