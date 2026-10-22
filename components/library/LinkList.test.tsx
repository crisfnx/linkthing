import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Link } from "@/lib/extract/types";
import { describeUrl } from "@/lib/extract/url/describe";
import { RowsBuilder, type LibraryRows } from "@/lib/library/rows";
import { LinkList } from "./LinkList";

// jsdom lays nothing out: give the list's container a screenful (10 rows),
// and a scroll height that is the list's own, as a browser would.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      const list = this.firstElementChild as HTMLElement | null;
      return parseFloat(list?.style.height ?? "") || 0;
    },
  );
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

function rowsOf(links: Link[], sourceIds = ["chat"]): LibraryRows {
  const builder = new RowsBuilder(sourceIds);
  links.forEach((l) => builder.add(l));
  return builder.finish();
}

// Numbered pages, newest first: page 0 is the newest.
const pages = (count: number) =>
  rowsOf(
    Array.from({ length: count }, (_, i) =>
      link(`https://example.com/page-${i}-notes`, { timestamp: count - i }),
    ),
  );

const names = new Map([
  ["chat", "Chat with Me"],
  ["notes", "Notes"],
]);

const items = () => screen.getAllByRole("listitem");

test("a row: its title links to the page, then the URL, kind and date", () => {
  const at = new Date(2026, 2, 14, 21, 3).getTime();
  render(
    <LinkList
      rows={rowsOf([
        link("https://x.com/exampledev/status/1900000000000000001?s=20", {
          timestamp: at,
        }),
      ])}
      sourceNames={names}
    />,
  );
  const row = items()[0]!;
  const anchor = within(row).getByRole("link");
  expect(anchor.textContent).toBe("Post by @exampledev, opens in a new tab");
  expect(anchor.getAttribute("href")).toBe(
    "https://x.com/exampledev/status/1900000000000000001",
  );
  expect(anchor.getAttribute("target")).toBe("_blank");
  expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
  expect(row.textContent).toContain(
    "Social post: x.com/exampledev/status/1900000000000000001",
  );
  const time = row.querySelector("time")!;
  expect(time.textContent).toBe(
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(at),
  );
  expect(time.getAttribute("dateTime")).toBe(new Date(at).toISOString());
});

test("with no readable title, the URL is the title and the site follows", () => {
  render(
    <LinkList
      rows={rowsOf([link("https://bit.ly/ex4mpleCP")])}
      sourceNames={names}
    />,
  );
  const row = items()[0]!;
  expect(within(row).getByRole("link").textContent).toBe(
    "bit.ly/ex4mpleCP, opens in a new tab",
  );
  expect(row.textContent).toContain("Web page: bit.ly");
  expect(row.querySelector("time")).toBeNull(); // undated
});

test("senders and sources show only when there's more than one", () => {
  const single = rowsOf([
    link("https://example.com/a-page", { sender: "Cris", timestamp: 2 }),
    link("https://example.com/b-page", { sender: "Cris", timestamp: 1 }),
  ]);
  const { unmount } = render(<LinkList rows={single} sourceNames={names} />);
  expect(items()[0]!.textContent).not.toContain("Cris");
  expect(items()[0]!.textContent).not.toContain("Chat with Me");
  unmount();

  const mixed = rowsOf(
    [
      link("https://example.com/a-page", { sender: "Ana", timestamp: 2 }),
      link("https://example.com/b-page", {
        sender: "Ben",
        sourceId: "notes",
        timestamp: 1,
      }),
    ],
    ["chat", "notes"],
  );
  render(<LinkList rows={mixed} sourceNames={names} />);
  expect(items()[0]!.textContent).toContain(
    "example.com/a-page · Ana · Chat with Me",
  );
  expect(items()[1]!.textContent).toContain("example.com/b-page · Ben · Notes");
});

test("only the rows on screen are drawn, and the list says how many in all", () => {
  render(<LinkList rows={pages(10_000)} sourceNames={names} />);
  const drawn = items();
  expect(drawn.length).toBeGreaterThan(9);
  expect(drawn.length).toBeLessThan(30);
  expect(drawn[0]!.getAttribute("aria-setsize")).toBe("10000");
  expect(drawn[0]!.getAttribute("aria-posinset")).toBe("1");
});

test("one row is in the tab order; j and k move between rows", () => {
  render(<LinkList rows={pages(50)} sourceNames={names} />);
  const links = screen.getAllByRole("link");
  expect(links.filter((a) => a.tabIndex === 0)).toEqual([links[0]]);

  links[0]!.focus();
  fireEvent.keyDown(links[0]!, { key: "j" });
  expect(document.activeElement?.textContent).toMatch(/^Page 1 notes/);
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toMatch(/^Page 2 notes/);
  fireEvent.keyDown(document.activeElement!, { key: "k" });
  expect(document.activeElement?.textContent).toMatch(/^Page 1 notes/);
  expect(
    screen.getAllByRole("link").filter((a) => a.tabIndex === 0),
  ).toHaveLength(1);
});

test("End jumps to the last row, drawing it, and Home back to the first", () => {
  render(<LinkList rows={pages(5_000)} sourceNames={names} />);
  screen.getAllByRole("link")[0]!.focus();

  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(document.activeElement?.textContent).toMatch(/^Page 4999 notes/);
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement?.textContent).toMatch(/^Page 0 notes/);
});

test("keys with a modifier are left to the browser", () => {
  render(<LinkList rows={pages(20)} sourceNames={names} />);
  const first = screen.getAllByRole("link")[0]!;
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown", metaKey: true });
  expect(document.activeElement).toBe(first);
});
