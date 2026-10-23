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
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ImportFlowContext,
  type ImportFlow,
} from "@/components/import/ImportFlow";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import type { Source } from "@/lib/db/types";
import type { Link } from "@/lib/extract/types";
import { describeUrl } from "@/lib/extract/url/describe";
import { toggleStar } from "@/lib/library/details";
import { RowsBuilder } from "@/lib/library/rows";
import { readSettings, saveSettings } from "@/lib/settings";
import type { ExtractClient } from "@/lib/workers/client";
import { SettingsDialog } from "./SettingsDialog";

const opened: LinkVaultDb[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

function source(id: string, name: string, links: number): Source {
  return {
    id,
    name,
    kind: "plaintext",
    adapterVersion: 1,
    importedAt: 1,
    updatedAt: 1,
    stats: {
      messages: links,
      links,
      uniqueLinks: links,
      domains: 1,
      skippedNonWeb: 0,
    },
    options: {},
  };
}

let next = 0;

function link(sourceId: string, url: string, isBare = false): Link {
  next++;
  return {
    id: `l${next}`,
    sourceId,
    url,
    ...describeUrl(url),
    ...(isBare ? { isBare } : {}),
    position: { line: next, column: 0, messageIndex: next },
  };
}

// "Me" has a link found without https://, "Notes" has none.
async function library({ bare = true } = {}) {
  const db = createDb(`test-${crypto.randomUUID()}`);
  opened.push(db);
  const sources = [source("me", "Me", 2), source("notes", "Notes", 1)];
  const links = [
    link("me", "https://example.com/page", bare),
    link("me", "https://example.org/a"),
    link("notes", "https://example.net/b"),
  ];
  await db.sources.bulkAdd(sources);
  await db.links.bulkAdd(links);
  const builder = new RowsBuilder(sources.map((s) => s.id));
  links.forEach((l) => builder.add(l));
  return { db, sources, links, rows: builder.finish() };
}

async function open(
  { db, sources, rows }: Awaited<ReturnType<typeof library>>,
  flow: ImportFlow | null = { busy: false, reextract: vi.fn() },
) {
  const onClose = vi.fn();
  render(
    <ImportFlowContext value={flow}>
      <SettingsDialog
        db={db}
        settings={await readSettings(db, "en-GB")}
        sources={sources}
        rows={rows}
        connect={() => ({}) as ExtractClient}
        onClose={onClose}
      />
    </ImportFlowContext>,
  );
  await act(async () => {}); // the storage estimate and the star count
  return { dialog: screen.getByRole("dialog", { name: "Settings" }), onClose };
}

test("each choice is saved as it's made", async () => {
  const lib = await library();
  await open(lib);
  fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
  fireEvent.click(
    screen.getByRole("radio", { name: "Month first (12/31/2026)" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Collapse duplicates when the library opens",
    }),
  );
  expect(
    (screen.getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked,
  ).toBe(true);
  await waitFor(async () =>
    expect(await readSettings(lib.db, "en-GB")).toEqual({
      theme: "dark",
      defaultDateOrder: "MDY",
      findBareDomains: true,
      dedupeByDefault: true,
    }),
  );
});

describe("find bare domains", () => {
  test("says how many links were found that way", async () => {
    await open(await library());
    const checkbox = screen.getByRole("checkbox", {
      name: "Find bare domains",
    });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect(checkbox.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      document.getElementById(checkbox.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toContain("1 link in your library was found this way.");
  });

  test("off: asks first, then reads again only the sources with such links", async () => {
    const lib = await library();
    const flow = { busy: false, reextract: vi.fn() };
    const { dialog, onClose } = await open(lib, flow);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Find bare domains" }),
    );
    const question = screen.getByRole("group", { name: "Find bare domains" });
    expect(question.textContent).toContain(
      "Turn it off? This removes the 1 link found without https:// and reads 1 source again. Stars stay.",
    );
    expect(document.activeElement?.textContent).toBe("Turn off");

    await act(async () =>
      fireEvent.click(
        within(question).getByRole("button", { name: "Turn off" }),
      ),
    );
    expect((await readSettings(lib.db)).findBareDomains).toBe(false);
    expect(flow.reextract).toHaveBeenCalledWith([lib.sources[0]], {});
    // Closed, so the progress shows.
    expect((dialog as HTMLDialogElement).open).toBe(false);
    expect(onClose).toHaveBeenCalled();
  });

  test("on: every source is read again", async () => {
    const lib = await library();
    await saveSettings(lib.db, { findBareDomains: false });
    const flow = { busy: false, reextract: vi.fn() };
    await open(lib, flow);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Find bare domains" }),
    );
    const question = screen.getByRole("group", { name: "Find bare domains" });
    expect(question.textContent).toContain(
      "Turn it on? This reads all 2 sources again to find them.",
    );
    await act(async () =>
      fireEvent.click(
        within(question).getByRole("button", { name: "Turn on" }),
      ),
    );
    expect((await readSettings(lib.db)).findBareDomains).toBe(true);
    expect(flow.reextract).toHaveBeenCalledWith(lib.sources, {});
  });

  test("Cancel or Esc backs out to the checkbox, and nothing changes", async () => {
    const lib = await library();
    const flow = { busy: false, reextract: vi.fn() };
    const { dialog } = await open(lib, flow);
    const checkbox = screen.getByRole("checkbox", {
      name: "Find bare domains",
    });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("group", { name: "Find bare domains" }),
    ).toBeNull();
    expect(document.activeElement).toBe(checkbox);

    fireEvent.click(checkbox);
    const esc = new Event("cancel", { cancelable: true });
    fireEvent(dialog, esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(
      screen.queryByRole("group", { name: "Find bare domains" }),
    ).toBeNull();
    expect(document.activeElement).toBe(checkbox);
    expect((await readSettings(lib.db)).findBareDomains).toBe(true);
    expect(flow.reextract).not.toHaveBeenCalled();
  });

  test("off with no links found that way: no question, nothing read again", async () => {
    const lib = await library({ bare: false });
    const flow = { busy: false, reextract: vi.fn() };
    await open(lib, flow);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Find bare domains" }),
    );
    expect(
      screen.queryByRole("group", { name: "Find bare domains" }),
    ).toBeNull();
    await waitFor(async () =>
      expect((await readSettings(lib.db)).findBareDomains).toBe(false),
    );
    expect(flow.reextract).not.toHaveBeenCalled();
  });
});

test("while an import runs, the choices that read or delete wait", async () => {
  const lib = await library();
  await open(lib, { busy: true, reextract: vi.fn() });
  const checkbox = screen.getByRole("checkbox", { name: "Find bare domains" });
  expect(checkbox.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(checkbox);
  expect(screen.queryByRole("group", { name: "Find bare domains" })).toBeNull();
  const remove = screen.getByRole("button", { name: "Delete everything" });
  expect(remove.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(remove);
  expect(screen.queryByRole("group", { name: "Delete everything" })).toBeNull();
  expect(
    screen.getAllByText("Wait for the import to finish first."),
  ).toHaveLength(2);
});

describe("delete everything", () => {
  test("asks with the counts, then empties the library; settings stay", async () => {
    const lib = await library();
    await toggleStar(lib.db, lib.links[1]!);
    await saveSettings(lib.db, { theme: "dark" });
    await open(lib);
    fireEvent.click(screen.getByRole("button", { name: "Delete everything" }));
    const question = screen.getByRole("group", { name: "Delete everything" });
    await waitFor(() =>
      expect(question.textContent).toContain(
        "Delete 2 sources, 3 links and 1 star? This can't be undone.",
      ),
    );
    expect(document.activeElement?.textContent).toBe("Delete everything");

    await act(async () =>
      fireEvent.click(
        within(question).getByRole("button", { name: "Delete everything" }),
      ),
    );
    await waitFor(async () => expect(await lib.db.sources.count()).toBe(0));
    expect(await lib.db.links.count()).toBe(0);
    expect(await lib.db.annotations.count()).toBe(0);
    expect((await readSettings(lib.db)).theme).toBe("dark");
  });

  test("Keep it backs out to the button", async () => {
    const lib = await library();
    await open(lib);
    fireEvent.click(screen.getByRole("button", { name: "Delete everything" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Delete everything" }),
    );
    expect(await lib.db.sources.count()).toBe(2);
  });
});

describe("storage", () => {
  const storage = (persisted: boolean, persist = vi.fn(async () => false)) =>
    vi.stubGlobal("navigator", {
      language: "en-GB",
      storage: {
        estimate: async () => ({ usage: 8_200_000, quota: 299_600_000_000 }),
        persisted: async () => persisted,
        persist,
      },
    });

  test("what's used, and whether the browser keeps it", async () => {
    storage(true);
    await open(await library());
    expect(
      screen.getByText(
        "Your library stays on this device: it's kept in this browser and never uploaded anywhere.",
      ),
    ).toBeTruthy();
    // What the library takes now, and the browser's ceiling, rounded.
    expect(
      screen.getByText(/LinkVault is using 8 MB so far\./).textContent,
    ).toBe(
      "LinkVault is using 8 MB so far. That grows with each import, and this browser lets it use up to about 300 GB. Your browser has agreed to keep your library until you delete it.",
    );
    expect(
      screen.queryByRole("button", { name: "Ask the browser to keep it" }),
    ).toBeNull();
  });

  test("not kept: ask, and say so when the browser refuses", async () => {
    const persist = vi.fn(async () => false);
    storage(false, persist);
    await open(await library());
    expect(
      screen.getByText(/Safari after 7 days without a visit/),
    ).toBeTruthy();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Ask the browser to keep it" }),
      ),
    );
    expect(persist).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain(
      "The browser said no.",
    );
  });

  test("a browser that doesn't say", async () => {
    vi.stubGlobal("navigator", { language: "en-GB" });
    await open(await library());
    expect(
      screen.getByText(
        "This browser doesn't say how much storage LinkVault uses.",
      ),
    ).toBeTruthy();
  });
});

test("Storage offers a backup and a restore", async () => {
  await open(await library());
  expect(
    screen.getByRole("button", { name: "Download a backup" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Restore from a backup…" }),
  ).toBeTruthy();
});
