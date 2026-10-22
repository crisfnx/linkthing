import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Link } from "@/lib/extract/types";
import { describeUrl } from "@/lib/extract/url/describe";
import { RowsBuilder, type LibraryRows } from "@/lib/library/rows";
import { LibraryView } from "./LibraryView";

// jsdom lays nothing out: a screenful for the list (see LinkList.test.tsx).
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

function library(): LibraryRows {
  const builder = new RowsBuilder(["notes", "chat"]);
  [
    link("https://www.youtube.com/watch?v=Ex4mpLeV1d0", {
      sender: "Ana",
      timestamp: at(2026, 3, 9),
    }),
    link("https://x.com/exampledev/status/1900000000000000001", {
      sender: "Ben",
      timestamp: at(2026, 2, 1),
    }),
    link("https://youtu.be/Ex4mpLeV1d0", {
      sender: "Ben",
      timestamp: at(2025, 12, 24),
    }),
    link("https://example.com/guide/getting-started", { sourceId: "notes" }),
  ].forEach((l) => builder.add(l));
  return builder.finish();
}

const sourceNames = new Map([
  ["chat", "Chat with Me"],
  ["notes", "Notes"],
]);

const titles = () =>
  screen
    .getAllByRole("listitem")
    .map((li) => within(li).getByRole("link").textContent?.split(",")[0]);

function renderView() {
  render(<LibraryView rows={library()} sourceNames={sourceNames} />);
  return {
    search: screen.getByRole("searchbox", { name: "Search links" }),
    count: () => screen.getByRole("status").textContent,
    sidebar: screen.getByRole("complementary", { name: "Filters" }),
  };
}

test("everything, newest first, with the count", () => {
  const { count } = renderView();
  expect(titles()).toEqual([
    "YouTube video",
    "Post by @exampledev",
    "YouTube video",
    "Getting started", // undated, last
  ]);
  expect(count()).toBe("4 links, 3 unique");
});

test("typing searches; the count says how many of all", () => {
  const { search, count } = renderView();
  fireEvent.change(search, { target: { value: "x.com" } });
  expect(titles()).toEqual(["Post by @exampledev"]);
  expect(count()).toBe("1 of 4 links, 1 unique");
});

test("Esc empties the search", () => {
  const { search } = renderView();
  fireEvent.change(search, { target: { value: "guide" } });
  fireEvent.keyDown(search, { key: "Escape" });
  expect((search as HTMLInputElement).value).toBe("");
  expect(titles()).toHaveLength(4);
});

test("a filter narrows the list, shows its counts, and clears", () => {
  const { sidebar, count } = renderView();
  const sites = within(sidebar).getByRole("group", { name: "Sites" });
  expect(
    within(sites)
      .getAllByRole("checkbox")
      .map((box) => box.closest("label")?.textContent),
  ).toEqual(["youtube.com2", "example.com1", "twitter.com1"]);

  fireEvent.click(
    within(sites).getByRole("checkbox", { name: /youtube\.com/ }),
  );
  expect(titles()).toEqual(["YouTube video", "YouTube video"]);
  expect(count()).toBe("2 of 4 links, 1 unique");

  fireEvent.click(within(sites).getByRole("button", { name: "Clear" }));
  expect(titles()).toHaveLength(4);
});

test("senders and sources, and a year's months", () => {
  const { sidebar } = renderView();
  fireEvent.click(
    within(within(sidebar).getByRole("group", { name: "Senders" })).getByRole(
      "checkbox",
      { name: /No sender/ },
    ),
  );
  expect(titles()).toEqual(["Getting started"]);
  fireEvent.click(within(sidebar).getByRole("checkbox", { name: /No sender/ }));

  const dates = within(sidebar).getByRole("group", { name: "Dates" });
  fireEvent.click(
    within(dates).getByRole("button", { name: "Months of 2026" }),
  );
  fireEvent.click(within(dates).getByRole("checkbox", { name: /February/ }));
  expect(titles()).toEqual(["Post by @exampledev"]);
});

test("sorting", () => {
  renderView();
  fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
    target: { value: "oldest" },
  });
  expect(titles()).toEqual([
    "YouTube video",
    "Post by @exampledev",
    "YouTube video",
    "Getting started", // undated stays last
  ]);
  expect(screen.getAllByRole("listitem")[0]!.textContent).toContain("youtu.be");
});

test("collapsed duplicates show how often, and open to the copies", () => {
  renderView();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Collapse duplicates" }),
  );
  expect(titles()).toHaveLength(3);
  fireEvent.click(
    screen.getByRole("button", { name: "Shared 2 times: show all" }),
  );
  expect(titles()).toHaveLength(4);
});

test("nothing matches: say so, and offer to clear", () => {
  const { search } = renderView();
  fireEvent.change(search, { target: { value: "nowhere-at-all" } });
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.getByText("No links match.")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Clear search and filters" }),
  );
  expect(titles()).toHaveLength(4);
});

test("/ goes to the search box, except while typing elsewhere", () => {
  const { search } = renderView();
  const firstLink = screen.getAllByRole("link")[0]!;
  firstLink.focus();
  fireEvent.keyDown(firstLink, { key: "/" });
  expect(document.activeElement).toBe(search);

  const sort = screen.getByRole("combobox", { name: "Sort" });
  sort.focus();
  fireEvent.keyDown(sort, { key: "/" });
  expect(document.activeElement).toBe(sort);
});

test("on narrow screens the filters open in a dialog", () => {
  renderView();
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  const dialog = screen.getByRole("dialog", { name: "Filters" });
  fireEvent.click(
    within(dialog).getByRole("checkbox", { name: /twitter\.com/ }),
  );
  expect(titles()).toEqual(["Post by @exampledev"]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Filters (1)" })).toBeTruthy();
});
