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
import { afterEach, expect, test, vi } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { extractLinks } from "@/lib/extract/pipeline";
import { deleteSource } from "@/lib/library/sources";
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

// The sources live, as the workspace reads them.
function Harness(props: {
  db: LinkVaultDb;
  connect: () => ExtractClient;
  onDeleted?: (id: string) => void;
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
    />
  );
}

async function setup(fail = false) {
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
  render(<Harness db={db} connect={connect} onDeleted={onDeleted} />);
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
