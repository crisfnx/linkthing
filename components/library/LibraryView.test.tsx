import "fake-indexeddb/auto";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import type { Source } from "@/lib/db/types";
import type { Link } from "@/lib/extract/types";
import { describeUrl } from "@/lib/extract/url/describe";
import { RowsBuilder, type LibraryRows } from "@/lib/library/rows";
import type { ExtractClient } from "@/lib/workers/client";
import { LibraryView } from "./LibraryView";

// jsdom lays nothing out: a screenful for the list (see LinkList.test.tsx).
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
});

const opened: LinkVaultDb[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

function freshDb(): LinkVaultDb {
  const db = createDb(`test-${crypto.randomUUID()}`);
  opened.push(db);
  return db;
}

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

function links(): Link[] {
  return [
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
  ];
}

function rowsOf(all: Link[]): LibraryRows {
  const builder = new RowsBuilder(["notes", "chat"]);
  all.forEach((l) => builder.add(l));
  return builder.finish();
}

const library = () => rowsOf(links());

const sourceNames = new Map([
  ["chat", "Chat with Me"],
  ["notes", "Notes"],
]);

const titles = () =>
  screen
    .getAllByRole("listitem")
    .map((li) => within(li).getByRole("link").textContent?.split(",")[0]);

// A worker stand-in: only the Sources dialog's delete reaches it here.
const noWorker = (): ExtractClient =>
  ({
    deleteSource: vi.fn(async () => ({ links: 0 })),
  }) as unknown as ExtractClient;

// The list needs only the rows; the details drawer reads the stored link.
function renderView(
  db = freshDb(),
  rows = library(),
  { sources = [] as Source[], connect = noWorker } = {},
) {
  render(
    <LibraryView
      db={db}
      rows={rows}
      sourceNames={sourceNames}
      sources={sources}
      connect={connect}
    />,
  );
  return {
    search: screen.getByRole("searchbox", { name: "Search links" }),
    count: () =>
      screen
        .getAllByRole("status")
        .map((s) => s.textContent)
        .find((t) => / links?, /.test(t ?? "")),
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
  ).toEqual(["youtube.com2", "example.com1", "x.com1"]);

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
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /^x\.com/ }));
  expect(titles()).toEqual(["Post by @exampledev"]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Filters (1)" })).toBeTruthy();
});

describe("details", () => {
  // A chat message around the link, and the note sent just after it.
  const post = () =>
    link("https://x.com/exampledev/status/42?s=20&t=AbCd", {
      sender: "Ana",
      timestamp: at(2026, 3, 14),
      context:
        "Best thing all week https://x.com/exampledev/status/42?s=20&t=AbCd",
      nearby: "Saving this for the trip",
      position: { line: 128, column: 20, messageIndex: 64 },
    });

  async function stored(...all: Link[]) {
    const db = freshDb();
    await db.links.bulkAdd(all);
    renderView(db, rowsOf(all));
    return db;
  }

  test("a click opens them: the cleaned URL, what was taken out, the message", async () => {
    await stored(post());
    fireEvent.click(screen.getByRole("link", { name: "Post by @exampledev" }));
    const drawer = screen.getByRole("dialog", { name: "Post by @exampledev" });

    expect(drawer.textContent).toContain("https://x.com/exampledev/status/42");
    expect(
      await within(drawer).findByText("Tracking taken out: s, t"),
    ).toBeTruthy();
    expect(drawer.textContent).toContain(
      "As found: https://x.com/exampledev/status/42?s=20&t=AbCd",
    );
    expect(drawer.querySelector("mark")?.textContent).toBe(
      "https://x.com/exampledev/status/42?s=20&t=AbCd",
    );
    expect(drawer.textContent).toContain("Saving this for the trip");
    expect(drawer.textContent).toContain("Sent byAna");
    expect(drawer.textContent).toContain("SourceChat with Me, line 128");
    expect(drawer.textContent).toContain("Social post on x.com");

    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Open link opens the cleaned URL in a new tab, never with an opener", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await stored(post());
    fireEvent.click(screen.getByRole("link", { name: "Post by @exampledev" }));
    fireEvent.click(screen.getByRole("button", { name: "Open link" }));
    expect(open).toHaveBeenCalledWith(
      "https://x.com/exampledev/status/42",
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("c copies the cleaned URL and says so", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await stored(post());
    const row = screen.getByRole("link", { name: "Post by @exampledev" });
    row.focus();
    fireEvent.keyDown(row, { key: "c" });
    expect(writeText).toHaveBeenCalledWith(
      "https://x.com/exampledev/status/42",
    );
    expect(await screen.findByText("Link copied.")).toBeTruthy();
  });

  test("a copy the browser refuses says so too", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: () => Promise.reject(new Error("denied")) },
    });
    await stored(post());
    const row = screen.getByRole("link", { name: "Post by @exampledev" });
    row.focus();
    fireEvent.keyDown(row, { key: "c" });
    expect(
      await screen.findByText(
        "Couldn't copy the link: the browser didn't allow it.",
      ),
    ).toBeTruthy();
  });

  test("the star, from the drawer and from the list, kept by urlKey", async () => {
    const shared = post();
    const db = await stored(shared);
    fireEvent.click(screen.getByRole("link", { name: "Post by @exampledev" }));
    const star = await screen.findByRole("button", { name: /Star/ });
    await waitFor(() => expect(star.hasAttribute("disabled")).toBe(false));
    expect(star.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(star);
    await waitFor(() => expect(star.getAttribute("aria-pressed")).toBe("true"));
    expect(await db.annotations.get(shared.urlKey)).toMatchObject({
      starred: true,
    });
    // Inside the dialog: outside a modal dialog it would be inert, unheard.
    expect(
      within(screen.getByRole("dialog")).getByRole("status").textContent,
    ).toBe("Starred.");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const row = screen.getByRole("link", { name: "Post by @exampledev" });
    row.focus();
    await act(async () => {
      fireEvent.keyDown(row, { key: "s" });
    });
    await waitFor(async () =>
      expect(await db.annotations.get(shared.urlKey)).toBeUndefined(),
    );
    expect(await screen.findByText("Star removed.")).toBeTruthy();
  });

  test("a bare domain says it was found without https://", async () => {
    await stored(
      link("https://bbcgoodfood.com/recipes/custard-tarts", {
        isBare: true,
        context: "try bbcgoodfood.com/recipes/custard-tarts",
      }),
    );
    fireEvent.click(screen.getByRole("link", { name: "Custard tarts" }));
    const drawer = screen.getByRole("dialog");
    expect(
      await within(drawer).findByText(
        "Found without https://, which was added.",
      ),
    ).toBeTruthy();
    expect(drawer.querySelector("mark")?.textContent).toBe(
      "bbcgoodfood.com/recipes/custard-tarts",
    );
  });
});

describe("the address", () => {
  test("a bookmarked view opens as it was", () => {
    window.history.replaceState(null, "", "/?q=youtube&sort=oldest&dedupe=1");
    const { search } = renderView();
    expect((search as HTMLInputElement).value).toBe("youtube");
    expect(
      (screen.getByRole("combobox", { name: "Sort" }) as HTMLSelectElement)
        .value,
    ).toBe("oldest");
    expect(titles()).toEqual(["YouTube video"]); // two copies, collapsed
  });

  test("typing replaces the entry; a filter adds one", () => {
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const { search, sidebar } = renderView();

    fireEvent.change(search, { target: { value: "you" } });
    fireEvent.change(search, { target: { value: "youtube" } });
    expect(replace).toHaveBeenLastCalledWith(null, "", "/?q=youtube");
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(
      within(sidebar).getByRole("checkbox", { name: /youtube\.com/ }),
    );
    expect(push).toHaveBeenCalledOnce();
    expect(window.location.search).toBe("?q=youtube&site=youtube.com");
  });

  test("Back puts the view the address holds", () => {
    const { sidebar } = renderView();
    fireEvent.click(within(sidebar).getByRole("checkbox", { name: /^x\.com/ }));
    expect(titles()).toEqual(["Post by @exampledev"]);

    // What the browser does on Back: the earlier address, then popstate.
    act(() => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(titles()).toHaveLength(4);
    expect(
      within(sidebar)
        .getByRole("checkbox", { name: /^x\.com/ })
        .matches(":checked"),
    ).toBe(false);
  });

  test("an unfiltered view is just the page", () => {
    window.history.replaceState(null, "", "/?sort=oldest");
    renderView();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), {
      target: { value: "newest" },
    });
    expect(window.location.href).toBe("http://localhost:3000/");
  });
});

test("Sources opens the dialog; deleting a source drops a filter on it", async () => {
  window.history.replaceState(null, "", "/?source=notes");
  const deleteSource = vi.fn(async () => ({ links: 1 }));
  const connect = () => ({ deleteSource }) as unknown as ExtractClient;
  const notes: Source = {
    id: "notes",
    name: "Notes",
    kind: "plaintext",
    adapterVersion: 1,
    importedAt: at(2026, 1, 1),
    updatedAt: at(2026, 1, 1),
    stats: {
      messages: 1,
      links: 1,
      uniqueLinks: 1,
      domains: 1,
      skippedNonWeb: 0,
    },
    options: {},
  };
  renderView(freshDb(), library(), { sources: [notes], connect });
  expect(titles()).toEqual(["Getting started"]);

  fireEvent.click(screen.getByRole("button", { name: "Sources" }));
  const dialog = screen.getByRole("dialog", { name: "Sources (1)" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await act(async () => {
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "Delete" }).at(-1)!,
    );
  });

  expect(deleteSource).toHaveBeenCalledWith("notes");
  expect(window.location.search).toBe("");
  expect(within(dialog).getByRole("status").textContent).toBe(
    "Deleted “Notes” and 1 link.",
  );
});
