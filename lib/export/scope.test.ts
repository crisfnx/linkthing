import { expect, test } from "vitest";
import type { Link } from "@/lib/extract/types";
import { describeUrl } from "@/lib/extract/url/describe";
import { RowsBuilder, textAt } from "@/lib/library/rows";
import {
  allRows,
  exportOrder,
  fileName,
  idsOf,
  selectedRows,
  urlsOf,
} from "./scope";

let next = 0;

function link(url: string, timestamp: number): Link {
  next++;
  return {
    id: `l${next}`,
    sourceId: "chat",
    url,
    ...describeUrl(url),
    timestamp,
    position: { line: next, column: 0, messageIndex: next },
  };
}

// The same video shared three ways, and a page once.
const builder = new RowsBuilder(["chat"]);
[
  link("https://youtu.be/Ex4mpLeV1d0", 4),
  link("https://example.com/a", 3),
  link("https://www.youtube.com/watch?v=Ex4mpLeV1d0", 2),
  link("https://m.youtube.com/watch?v=Ex4mpLeV1d0", 1),
].forEach((l) => builder.add(l));
const rows = builder.finish();

test("every time: the list as it is", () => {
  const { order, shared } = exportOrder(rows, allRows(rows), false);
  expect(urlsOf(rows, order)).toHaveLength(4);
  expect(shared).toBeNull();
});

test("each link once: its first row, with how often it was shared", () => {
  const { order, shared } = exportOrder(rows, allRows(rows), true);
  expect(urlsOf(rows, order)).toEqual([
    "https://youtu.be/Ex4mpLeV1d0",
    "https://example.com/a",
  ]);
  expect(Array.from(shared!)).toEqual([3, 1]);
  expect(idsOf(rows, order)).toEqual([
    textAt(rows.ids, 0),
    textAt(rows.ids, 1),
  ]);
});

test("a selection is of links: every copy of each, in library order", () => {
  const video = rows.keys[2]!; // selected from its second copy
  const picked = selectedRows(rows, new Set([video]));
  expect(Array.from(picked)).toEqual([0, 2, 3]);
  expect(Array.from(exportOrder(rows, picked, true).shared!)).toEqual([3]);
});

test("counts follow the list: a view with two copies shared twice", () => {
  const view = Uint32Array.from([2, 3]);
  expect(Array.from(exportOrder(rows, view, true).shared!)).toEqual([2]);
});

test("file names say what and when", () => {
  expect(fileName("view", "csv", new Date(2026, 9, 3))).toBe(
    "linkvault-view-2026-10-03.csv",
  );
});
