import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { extractLinks } from "@/lib/extract/pipeline";
import { deleteSource } from "@/lib/library/sources";
import type { Source } from "@/lib/db/types";
import type { ReextractChoice } from "@/lib/import/reextract";
import type { ExtractClient } from "@/lib/workers/client";
import { SourcesDialog } from "./SourcesDialog";

const opened: LinkVaultDb[] = [];

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

// Stored as the save pass stores a source; jsdom can't gzip (no
// Blob.stream), and the dialog never reads the raw text. Under jsdom,
// import.meta.url isn't a file URL; Vitest runs from the root.
let imported = 0;

async function importFixture(
  db: LinkVaultDb,
  name: string,
  sourceName: string,
  kind: "whatsapp" | "plaintext",
) {
  const text = readFileSync(
    join(process.cwd(), "tests/fixtures", name),
    "utf8",
  );
  const sourceId = crypto.randomUUID();
  const { links, stats } = extractLinks(text, sourceId, kind, {
    dateOrder: "DMY",
  });
  const at = Date.UTC(2026, 9, 20 + imported++);
  await db.sources.add({
    id: sourceId,
    name: sourceName,
    kind,
    adapterVersion: 1,
    importedAt: at,
    updatedAt: at,
    stats,
    options: {},
  });
  await db.sourceParts.add({
    id: crypto.randomUUID(),
    sourceId,
    importedAt: at,
    byteSize: text.length,
    contentHash: sourceId,
    raw: new Uint8Array() as unknown as Blob,
  });
  await db.links.bulkAdd(links);
  return { sourceId, stats };
}

// The worker's delete, run in-process on the same database.
function worker(db: LinkVaultDb, fail = false) {
  const remove = vi.fn(async (sourceId: string) => {
    if (fail) throw new Error("disk");
    return deleteSource(db, sourceId);
  });
  return {
    connect: () => ({ deleteSource: remove }) as unknown as ExtractClient,
    remove,
  };
}

type Harness = {
  onReextract?: (source: Source, choice: ReextractChoice) => void;
};

// The sources live, as the workspace reads them.
function Harness(props: {
  db: LinkVaultDb;
  connect: () => ExtractClient;
  onDeleted?: (id: string) => void;
  onReextract?: (source: Source, choice: ReextractChoice) => void;
  jobRunning?: boolean;
}) {
  const sources = useLiveQuery(
    () => props.db.sources.orderBy("importedAt").reverse().toArray(),
    [props.db],
  );
  const [said, setSaid] = useState("");
  if (!sources) return null;
  return (
    <SourcesDialog
      db={props.db}
      connect={props.connect}
      sources={sources}
      onDeleted={props.onDeleted ?? (() => {})}
      onClose={() => {}}
      say={setSaid}
      notice={said && <p role="status">{said}</p>}
      onReextract={props.onReextract}
      jobRunning={props.jobRunning}
    />
  );
}

async function setup(
  fail = false,
  extra: { onReextract?: Harness["onReextract"]; jobRunning?: boolean } = {},
) {
  const db = createDb(`test-${crypto.randomUUID()}`);
  opened.push(db);
  const chat = await importFixture(
    db,
    "whatsapp-update-older.txt",
    "Me",
    "whatsapp",
  );
  const notes = await importFixture(
    db,
    "plaintext.txt",
    "plaintext.txt",
    "plaintext",
  );
  const { connect, remove } = worker(db, fail);
  const onDeleted = vi.fn();
  render(
    <Harness db={db} connect={connect} onDeleted={onDeleted} {...extra} />,
  );
  const dialog = await screen.findByRole("dialog", { name: "Sources (2)" });
  return { db, chat, notes, dialog, remove, onDeleted };
}

const entry = (dialog: HTMLElement, name: string) =>
  within(dialog)
    .getAllByRole("listitem")
    .find((li) => li.textContent?.startsWith(name))!;

test("every source, latest import first, with what it holds", async () => {
  const { dialog, chat } = await setup();
  const items = within(dialog).getAllByRole("listitem");
  expect(items.map((li) => li.querySelector("span")?.textContent)).toEqual([
    "plaintext.txt",
    "Me",
  ]);
  expect(entry(dialog, "Me").textContent).toContain(
    `WhatsApp chat · ${chat.stats.links} links · `,
  );
});

test("rename: Enter saves, and focus goes back to Rename", async () => {
  const { db, dialog, chat } = await setup();
  fireEvent.click(
    within(entry(dialog, "Me")).getByRole("button", { name: "Rename" }),
  );
  const input = within(dialog).getByRole("textbox", {
    name: "New name for “Me”",
  });
  expect(document.activeElement).toBe(input);

  fireEvent.change(input, { target: { value: "  Chat with   myself " } });
  await act(async () => {
    fireEvent.submit(input.closest("form")!);
  });
  await waitFor(async () =>
    expect((await db.sources.get(chat.sourceId))?.name).toBe(
      "Chat with myself",
    ),
  );
  // The list follows the live sources table, a moment after the write.
  const rename = await waitFor(() =>
    within(entry(dialog, "Chat with myself")).getByRole("button", {
      name: "Rename",
    }),
  );
  await waitFor(() => expect(document.activeElement).toBe(rename));
});

test("an empty name is refused, with why", async () => {
  const { dialog } = await setup();
  fireEvent.click(
    within(entry(dialog, "Me")).getByRole("button", { name: "Rename" }),
  );
  const input = within(dialog).getByRole("textbox");
  fireEvent.change(input, { target: { value: "   " } });
  await act(async () => {
    fireEvent.submit(input.closest("form")!);
  });
  expect(within(dialog).getByRole("alert").textContent).toBe(
    "A name can't be empty.",
  );
  expect(input.getAttribute("aria-invalid")).toBe("true");
});

test("Esc while renaming puts the name back and keeps the dialog", async () => {
  const { dialog } = await setup();
  fireEvent.click(
    within(entry(dialog, "Me")).getByRole("button", { name: "Rename" }),
  );
  const cancel = new Event("cancel", { cancelable: true });
  act(() => {
    dialog.dispatchEvent(cancel);
  });
  expect(cancel.defaultPrevented).toBe(true);
  expect(within(dialog).queryByRole("textbox")).toBeNull();
  expect(dialog.hasAttribute("open")).toBe(true);
});

test("delete asks first; Keep it backs out", async () => {
  const { dialog, chat, remove } = await setup();
  const del = within(entry(dialog, "Me")).getByRole("button", {
    name: "Delete",
  });
  fireEvent.click(del);
  expect(entry(dialog, "Me").textContent).toContain(
    `Delete “Me” and its ${chat.stats.links} links? Stars stay`,
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
  expect(remove).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(document.activeElement?.textContent).toBe("Delete"),
  );
});

test("delete goes through the worker, says so, and leaves the list", async () => {
  const { db, dialog, chat, remove, onDeleted } = await setup();
  fireEvent.click(
    within(entry(dialog, "Me")).getByRole("button", { name: "Delete" }),
  );
  const confirm = within(entry(dialog, "Me"))
    .getAllByRole("button", { name: "Delete" })
    .at(-1)!;
  await act(async () => {
    fireEvent.click(confirm);
  });

  expect(remove).toHaveBeenCalledWith(chat.sourceId);
  // The worker's transaction finishes a moment after the click.
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(chat.sourceId));
  await screen.findByRole("dialog", { name: "Sources (1)" });
  expect(await db.links.where("sourceId").equals(chat.sourceId).count()).toBe(
    0,
  );
  expect(within(dialog).getByRole("status").textContent).toBe(
    `Deleted “Me” and ${chat.stats.links} links.`,
  );
  expect(document.activeElement?.textContent).toBe("Sources (1)");
});

test("a delete that fails says nothing was removed, and can be tried again", async () => {
  const { db, dialog, remove } = await setup(true);
  fireEvent.click(
    within(entry(dialog, "Me")).getByRole("button", { name: "Delete" }),
  );
  await act(async () => {
    fireEvent.click(
      within(entry(dialog, "Me"))
        .getAllByRole("button", { name: "Delete" })
        .at(-1)!,
    );
  });
  expect(remove).toHaveBeenCalledOnce();
  expect(within(dialog).getByRole("status").textContent).toBe(
    "Couldn't delete “Me”, so nothing was removed. Try again.",
  );
  expect(await db.sources.count()).toBe(2);
  expect(entry(dialog, "Me").textContent).toContain("Delete “Me” and its");
});

describe("re-extract (§6.4)", () => {
  async function opened(extra: { jobRunning?: boolean } = {}) {
    const onReextract = vi.fn();
    const ctx = await setup(false, { onReextract, ...extra });
    return { ...ctx, onReextract };
  }

  const reextractOf = (dialog: HTMLElement, name: string) =>
    within(entry(dialog, name)).getByRole("button", { name: "Re-extract" });

  test("asks how to read it, preset to how it's read now, then hands over and closes", async () => {
    const { dialog, chat, onReextract } = await opened();
    fireEvent.click(reextractOf(dialog, "Me"));
    const form = within(dialog).getByRole("form", { name: "Re-extract" });
    expect(
      (within(form).getByLabelText(/As a WhatsApp chat/) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (
        within(form).getByLabelText(
          "Day first (31/12/2026)",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);

    fireEvent.click(within(form).getByLabelText("Month first (12/31/2026)"));
    fireEvent.submit(form);
    expect(onReextract).toHaveBeenCalledWith(
      expect.objectContaining({ id: chat.sourceId }),
      { kind: "whatsapp", dateOrder: "MDY" },
    );
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  test("as plain text, which has no dates to ask about", async () => {
    const { dialog, onReextract } = await opened();
    fireEvent.click(reextractOf(dialog, "Me"));
    const form = within(dialog).getByRole("form", { name: "Re-extract" });
    fireEvent.click(within(form).getByLabelText(/As plain text/));
    expect(within(form).queryByText("Dates are written")).toBeNull();
    fireEvent.submit(form);
    expect(onReextract).toHaveBeenCalledWith(expect.anything(), {
      kind: "plaintext",
    });
  });

  test("a chat of several exports can only be read as a chat", async () => {
    const { db, dialog, chat } = await opened();
    await act(async () => {
      await db.sourceParts.add({
        id: crypto.randomUUID(),
        sourceId: chat.sourceId,
        importedAt: Date.now(),
        byteSize: 1,
        contentHash: "newer",
        raw: new Uint8Array() as unknown as Blob,
      });
    });
    fireEvent.click(reextractOf(dialog, "Me"));
    const plain = (await within(dialog).findByLabelText(
      /As plain text/,
    )) as HTMLInputElement;
    await waitFor(() => expect(plain.disabled).toBe(true));
    expect(entry(dialog, "Me").textContent).toContain(
      "Updated from several exports, so it can only be read as a chat.",
    );
  });

  test("a source read by an older version says re-extract would update it", async () => {
    const { db, dialog, notes } = await opened();
    await act(async () => {
      await db.sources.update(notes.sourceId, { adapterVersion: 0 });
    });
    await waitFor(() =>
      expect(entry(dialog, "plaintext.txt").textContent).toContain(
        "read by an older version: re-extract to use the current one",
      ),
    );
  });

  test("Esc backs out of the form, not the dialog", async () => {
    const { dialog } = await opened();
    const button = reextractOf(dialog, "Me");
    fireEvent.click(button);
    act(() => {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(within(dialog).queryByRole("form")).toBeNull();
    expect(dialog.hasAttribute("open")).toBe(true);
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Re-extract"),
    );
  });

  test("while an import runs, it waits", async () => {
    const { dialog } = await opened({ jobRunning: true });
    const button = reextractOf(dialog, "Me");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(within(dialog).queryByRole("form")).toBeNull();
  });

  test("without the import flow, there's no Re-extract", async () => {
    const { dialog } = await setup();
    expect(
      within(dialog).queryByRole("button", { name: "Re-extract" }),
    ).toBeNull();
  });
});
