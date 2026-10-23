import { describe, expect, test } from "vitest";
import { onlyTextDiffers, queryFromSearch, searchFromQuery } from "./url";
import { EMPTY_QUERY, type Query } from "./view";

const query = (fields: Partial<Query>): Query => ({
  ...EMPTY_QUERY,
  ...fields,
});

describe("the view as a query string", () => {
  test("an unfiltered library is just the page", () => {
    expect(searchFromQuery(EMPTY_QUERY)).toBe("");
    expect(queryFromSearch("")).toEqual(EMPTY_QUERY);
  });

  test("everything, and back again", () => {
    const full = query({
      text: "lisbon trams",
      sites: ["wikipedia.org", "theguardian.com"],
      kinds: ["video", "social"],
      senders: ["Ana", ""],
      sources: ["58031e6c-15fd-4e24-b134-f142a9382296"],
      dates: ["2026", "2025-12", ""],
      starred: true,
      sort: "oldest",
      dedupe: true,
    });
    const search = searchFromQuery(full);
    expect(search).toBe(
      "q=lisbon+trams&site=wikipedia.org&site=theguardian.com&kind=video&kind=social" +
        "&sender=Ana&sender=&source=58031e6c-15fd-4e24-b134-f142a9382296" +
        "&date=2026&date=2025-12&date=&starred=1&sort=oldest&dedupe=1",
    );
    expect(queryFromSearch(`?${search}`)).toEqual(full);
  });

  test("names with & = # + and spaces survive", () => {
    const odd = query({ text: "a&b=c #d +e", senders: ["Ana & Ben"] });
    expect(queryFromSearch(searchFromQuery(odd))).toEqual(odd);
  });

  test("unknown kinds and sorts are dropped, repeated kinds kept once", () => {
    expect(
      queryFromSearch(
        "?kind=video&kind=<script>&kind=video&sort=evil&dedupe=yes",
      ),
    ).toEqual(query({ kinds: ["video"] }));
  });
});

test("duplicates follow the default unless the address says otherwise", () => {
  const collapsing = query({ dedupe: true }); // Settings: collapse by default
  expect(queryFromSearch("", collapsing).dedupe).toBe(true);
  expect(queryFromSearch("?dedupe=0", collapsing).dedupe).toBe(false);
  expect(queryFromSearch("?dedupe=1").dedupe).toBe(true);
  expect(searchFromQuery(collapsing, collapsing)).toBe("");
  expect(searchFromQuery(query({}), collapsing)).toBe("dedupe=0");
});

test("an address naming twitter.com finds X's links, now shown as x.com", () => {
  expect(queryFromSearch("?site=twitter.com&site=x.com").sites).toEqual([
    "x.com",
  ]);
});

test("typing changes only the text; anything else is a new history entry", () => {
  const before = query({ text: "lis", sites: ["wikipedia.org"] });
  expect(onlyTextDiffers(before, { ...before, text: "lisbon" })).toBe(true);
  expect(onlyTextDiffers(before, { ...before, sort: "oldest" })).toBe(false);
  expect(onlyTextDiffers(before, { ...before, sites: [] })).toBe(false);
});
