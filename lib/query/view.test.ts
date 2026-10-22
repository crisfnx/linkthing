import { describe, expect, test } from "vitest";
import { extractLinks } from "@/lib/extract/pipeline";
import type { Link } from "@/lib/extract/types";
import { describeUrl } from "@/lib/extract/url/describe";
import { RowsBuilder, textAt, type LibraryRows } from "@/lib/library/rows";
import { syntheticExport } from "@/tests/synthetic";
import { buildView, EMPTY_QUERY, searchRows, type Query } from "./view";

let next = 0;

function link(url: string, fields: Partial<Link> = {}): Link {
  next++;
  return {
    id: `l${next}`,
    sourceId: "chat",
    url,
    ...describeUrl(url),
    position: { line: next, column: 0, messageIndex: next },
    ...fields,
  };
}

function rowsOf(links: Link[], sourceIds = ["chat"]): LibraryRows {
  const builder = new RowsBuilder(sourceIds);
  links.forEach((l) => builder.add(l));
  return builder.finish();
}

const at = (y: number, m: number, d = 1) => new Date(y, m - 1, d).getTime();

// The URLs a view shows, in order.
function shown(
  rows: LibraryRows,
  query: Partial<Query>,
  expanded?: Set<number>,
) {
  const view = buildView(rows, { ...EMPTY_QUERY, ...query }, expanded);
  return Array.from(view.order, (row) => textAt(rows.urls, row));
}

describe("search", () => {
  const rows = rowsOf([
    link("https://example.com/custard-tarts", {
      context: "Tried these at the weekend",
      sender: "Ana",
      timestamp: 3,
    }),
    link("https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower", {
      nearby: "For the Lisbon trip",
      sender: "Ben",
      timestamp: 2,
    }),
    link("https://example.com/notes", { sender: "Priya", timestamp: 1 }),
  ]);

  test.each([
    ["custard", ["https://example.com/custard-tarts"]],
    ["CUSTARD Tarts", ["https://example.com/custard-tarts"]], // case, title words
    ["weekend", ["https://example.com/custard-tarts"]], // context
    ["lisbon", ["https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower"]], // nearby
    ["belem", ["https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower"]], // accents
    ["priya", ["https://example.com/notes"]], // sender
    ["example ana", ["https://example.com/custard-tarts"]], // every word
    ["example nowhere", []],
  ])("%j finds %j", (text, expected) => {
    expect(shown(rows, { text })).toEqual(expected);
  });

  test("no words: no search", () => {
    expect(searchRows(rows, "   ")).toBeNull();
  });

  test("a word can't match across two rows", () => {
    const two = rowsOf([
      link("https://example.com/ab", { sender: "xy", timestamp: 2 }),
      link("https://example.com/cd", { sender: "zw", timestamp: 1 }),
    ]);
    expect(shown(two, { text: "xy zw" })).toEqual([]);
    expect(shown(two, { text: "yhttps" })).toEqual([]);
  });

  // §11: "Searching x.com finds links grouped as twitter.com and twitter.com
  // finds x.com links; the same for youtu.be / youtube.com and every alias in
  // Appendix B."
  test.each([
    [
      "https://twitter.com/exampledev/status/1",
      ["x.com", "mobile.twitter.com", "fxtwitter.com", "vxtwitter.com"],
    ],
    ["https://x.com/exampledev/status/1", ["twitter.com"]],
    ["https://fxtwitter.com/exampledev/status/1", ["twitter.com", "x.com"]],
    [
      "https://www.youtube.com/watch?v=Ex4mpLeV1d0",
      ["youtu.be", "m.youtube.com", "music.youtube.com"],
    ],
    ["https://youtu.be/Ex4mpLeV1d0", ["youtube.com", "www.youtube.com"]],
    [
      "https://music.youtube.com/watch?v=Ex4mpLeSong1",
      ["youtu.be", "m.youtube.com"],
    ],
    [
      "https://www.reddit.com/r/cats/",
      ["redd.it", "old.reddit.com", "np.reddit.com", "v.redd.it", "i.redd.it"],
    ],
    ["https://redd.it/ex4mple", ["reddit.com", "old.reddit.com"]],
    ["https://www.facebook.com/somepage", ["fb.com", "m.facebook.com"]],
    ["https://fb.com/somepage", ["facebook.com"]],
    ["https://en.wikipedia.org/wiki/Lisbon", ["en.m.wikipedia.org"]],
    ["https://en.m.wikipedia.org/wiki/Lisbon", ["en.wikipedia.org"]],
  ])("%s is found under %j", (url, names) => {
    const rows = rowsOf([link(url), link("https://example.com/other")]);
    for (const name of names) {
      expect(shown(rows, { text: name }), name).toEqual([
        describeUrl(url).canonicalUrl,
      ]);
    }
  });
});

describe("filters and their counts", () => {
  const rows = rowsOf(
    [
      link("https://www.youtube.com/watch?v=a", {
        sender: "Ana",
        timestamp: at(2026, 3, 5),
      }),
      link("https://youtu.be/b", { sender: "Ben", timestamp: at(2026, 2, 5) }),
      link("https://x.com/exampledev/status/1", {
        sender: "Ana",
        timestamp: at(2025, 12, 5),
      }),
      link("https://example.com/page", { sourceId: "notes" }), // undated, no sender
    ],
    ["notes", "chat"],
  );

  test("with nothing chosen, every value and its count", () => {
    const { facets, matching } = buildView(rows, EMPTY_QUERY);
    expect(matching).toBe(4);
    expect(facets.sites.map((v) => [v.value, v.count])).toEqual([
      ["youtube.com", 2],
      ["example.com", 1],
      ["x.com", 1],
    ]);
    expect(facets.kinds.map((v) => [v.value, v.count])).toEqual([
      ["video", 2],
      ["social", 1],
      ["other", 1],
    ]);
    // Links without a sender or a date have a value of their own (§11).
    expect(facets.senders.map((v) => [v.value, v.count])).toEqual([
      ["Ana", 2],
      ["Ben", 1],
      ["", 1],
    ]);
    expect(facets.sources.map((v) => [v.value, v.count])).toEqual([
      ["notes", 1],
      ["chat", 3],
    ]);
    expect(
      facets.dates.map((y) => [y.value, y.count, y.months.map((m) => m.value)]),
    ).toEqual([
      ["2026", 2, ["2026-03", "2026-02"]],
      ["2025", 1, ["2025-12"]],
      ["", 1, []],
    ]);
  });

  test("a site narrows the list; its own counts still offer the others", () => {
    const view = buildView(rows, { ...EMPTY_QUERY, sites: ["youtube.com"] });
    expect(view.matching).toBe(2);
    expect(
      view.facets.sites.map((v) => [v.value, v.count, v.selected]),
    ).toEqual([
      ["youtube.com", 2, true],
      ["example.com", 1, false],
      ["x.com", 1, false],
    ]);
    // Other filters count within the chosen site.
    expect(view.facets.senders.map((v) => [v.value, v.count])).toEqual([
      ["Ana", 1],
      ["Ben", 1],
    ]);
  });

  test("any value within a filter, every filter across them", () => {
    expect(shown(rows, { senders: ["Ana", "Ben"] })).toHaveLength(3);
    expect(shown(rows, { senders: ["Ana"], kinds: ["video"] })).toEqual([
      "https://www.youtube.com/watch?v=a",
    ]);
  });

  test("dates by year, by month, or undated", () => {
    expect(shown(rows, { dates: ["2026"] })).toHaveLength(2);
    expect(shown(rows, { dates: ["2026-02"] })).toEqual(["https://youtu.be/b"]);
    expect(shown(rows, { dates: ["2025", ""] })).toEqual([
      "https://x.com/exampledev/status/1",
      "https://example.com/page",
    ]);
  });

  test("undated links are found by search and by every filter", () => {
    expect(shown(rows, { text: "example.com" })).toEqual([
      "https://example.com/page",
    ]);
    expect(
      shown(rows, {
        sites: ["example.com"],
        kinds: ["other"],
        senders: [""],
        sources: ["notes"],
        dates: [""],
      }),
    ).toEqual(["https://example.com/page"]);
  });

  test("a chosen value that no longer matches anything stays on offer", () => {
    const view = buildView(rows, {
      ...EMPTY_QUERY,
      text: "youtube",
      senders: ["Ana"],
      kinds: ["social"],
    });
    expect(view.matching).toBe(0);
    expect(view.facets.kinds.find((v) => v.value === "social")).toEqual({
      value: "social",
      count: 0,
      selected: true,
    });
  });
});

describe("sorting", () => {
  const rows = rowsOf(
    [
      link("https://b.example/one", {
        timestamp: at(2026, 1, 3),
        sourceId: "old",
      }),
      link("https://a.example/two", { timestamp: at(2026, 1, 2) }),
      link("https://b.example/three", { timestamp: at(2026, 1, 1) }),
      link("https://c.example/undated"),
    ],
    ["chat", "old"], // chat imported last
  );

  test.each([
    [
      "newest",
      [
        "b.example/one",
        "a.example/two",
        "b.example/three",
        "c.example/undated",
      ],
    ],
    [
      "oldest",
      [
        "b.example/three",
        "a.example/two",
        "b.example/one",
        "c.example/undated",
      ],
    ],
    [
      "site",
      [
        "a.example/two",
        "b.example/one",
        "b.example/three",
        "c.example/undated",
      ],
    ],
    [
      "frequent",
      [
        "b.example/one",
        "b.example/three",
        "a.example/two",
        "c.example/undated",
      ],
    ],
    [
      "imported",
      [
        "a.example/two",
        "b.example/three",
        "c.example/undated",
        "b.example/one",
      ],
    ],
  ] as const)("%s", (sort, expected) => {
    expect(shown(rows, { sort }).map((url) => url.slice(8))).toEqual(expected);
  });
});

describe("duplicates", () => {
  const rows = rowsOf([
    link("https://youtu.be/Ex4mpLeV1d0", { timestamp: 4 }),
    link("https://example.com/a", { timestamp: 3 }),
    link("https://www.youtube.com/watch?v=Ex4mpLeV1d0", { timestamp: 2 }),
    link("https://m.youtube.com/watch?v=Ex4mpLeV1d0&feature=shared", {
      timestamp: 1,
    }),
  ]);

  test("collapsed: one row per link, with how many times it was shared", () => {
    const view = buildView(rows, { ...EMPTY_QUERY, dedupe: true });
    expect(Array.from(view.order, (r) => textAt(rows.urls, r))).toEqual([
      "https://youtu.be/Ex4mpLeV1d0",
      "https://example.com/a",
    ]);
    expect(Array.from(view.copies!)).toEqual([3, 1]);
    expect([view.matching, view.unique]).toEqual([4, 2]);
  });

  test("expanded: every copy under the first, marked as a copy", () => {
    const key = rows.keys[0]!;
    const view = buildView(
      rows,
      { ...EMPTY_QUERY, dedupe: true },
      new Set([key]),
    );
    expect(Array.from(view.order, (r) => textAt(rows.urls, r))).toEqual([
      "https://youtu.be/Ex4mpLeV1d0",
      "https://www.youtube.com/watch?v=Ex4mpLeV1d0",
      "https://m.youtube.com/watch?v=Ex4mpLeV1d0",
      "https://example.com/a",
    ]);
    expect(Array.from(view.copies!)).toEqual([3, 0, 0, 1]);
  });

  test("counted among the matches: three copies, but only one matches", () => {
    const all = buildView(rows, {
      ...EMPTY_QUERY,
      dedupe: true,
      text: "ex4mplev1d0",
    });
    expect(Array.from(all.copies!)).toEqual([3]);
    // The URL as found, before its tracking parameter was cleaned off.
    const one = buildView(rows, {
      ...EMPTY_QUERY,
      dedupe: true,
      text: "feature=shared",
    });
    expect(Array.from(one.copies!)).toEqual([1]);
  });

  test("not collapsed, no copies to count", () => {
    expect(buildView(rows, EMPTY_QUERY).copies).toBeNull();
  });
});

test("a keystroke on 98 k links: search, filters, counts and order in well under 100 ms", () => {
  const { links } = extractLinks(
    syntheticExport(10_000_000),
    "big",
    "whatsapp",
  );
  const builder = new RowsBuilder(["big"]);
  links.forEach((l) => builder.add(l));
  const rows = builder.finish();
  buildView(rows, EMPTY_QUERY); // the per-load tables, once

  const times = ["c", "ca", "cac", "cach", "cachi", "cachin", "caching"].map(
    (text) => {
      const started = performance.now();
      buildView(rows, { ...EMPTY_QUERY, text, sort: "site", dedupe: true });
      return performance.now() - started;
    },
  );
  const worst = Math.max(...times);
  console.log(
    `view: ${rows.count} links, worst keystroke ${Math.round(worst)} ms`,
  );
  // CI machines are slower than the M-series laptop the budget is set for.
  expect(worst).toBeLessThan(process.env.CI ? 300 : 100);
}, 30_000);
