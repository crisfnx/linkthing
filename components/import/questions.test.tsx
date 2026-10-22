// Each fixture shows exactly the dialog it should, or none at all (M2). The
// scan is the real one, run in-process over an in-memory database; start only
// records the answer, since the save has its own tests in lib/import.
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Dexie from "dexie";
import { afterEach, expect, test, vi } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { sha256 } from "@/lib/extract/keys";
import { extractLinks } from "@/lib/extract/pipeline";
import { scanInput, type ScanInput } from "@/lib/import/scan";
import type { ExtractClient } from "@/lib/workers/client";
import { Importer } from "./Importer";

// Under jsdom, import.meta.url isn't a file URL; Vitest runs from the root.
const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "tests/fixtures", name));

const opened: LinkVaultDb[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

function inProcessClient(db: LinkVaultDb) {
  return {
    ping: vi.fn(),
    cancel: vi.fn(),
    terminate: vi.fn(),
    load: vi.fn(),
    scan: async (input: ScanInput) => (await scanInput(db, input)).result,
    start: vi.fn<ExtractClient["start"]>(async () => ({
      sourceId: "new",
      name: "new",
      updated: false,
      newLinks: 1,
      stats: {
        messages: 1,
        links: 1,
        uniqueLinks: 1,
        domains: 1,
        skippedNonWeb: 0,
      },
    })),
  } satisfies ExtractClient;
}

// A chat already in the library, stored as the save pass stores one.
async function storeChat(db: LinkVaultDb, name: string, sourceName: string) {
  const text = fixture(name).toString();
  const id = crypto.randomUUID();
  const { links, stats } = extractLinks(text, id, "whatsapp");
  await db.sources.add({
    id,
    name: sourceName,
    kind: "whatsapp",
    adapterVersion: 1,
    importedAt: Date.now(),
    updatedAt: Date.now(),
    stats,
    options: { dateOrder: "DMY" },
  });
  await db.sourceParts.add({
    id: crypto.randomUUID(),
    sourceId: id,
    importedAt: Date.now(),
    byteSize: text.length,
    contentHash: await sha256(new TextEncoder().encode(text)),
    raw: new Uint8Array() as unknown as Blob, // never read by the scan
  });
  await db.links.bulkAdd(links);
  return id;
}

// What each question looks like in the dialog.
const QUESTIONS = {
  adapter: "Parts of this look like a chat export",
  "date-order": "How are dates written in this chat?",
  duplicate: "You imported this file on",
  update: "This looks like a newer export of",
};

function questionsShown(dialog: HTMLElement) {
  return Object.entries(QUESTIONS)
    .filter(([, text]) => dialog.textContent?.includes(text))
    .map(([question]) => question);
}

async function drop(name: string, stored?: string) {
  vi.stubGlobal("navigator", { language: "en-GB" });
  const db = createDb(`test-${crypto.randomUUID()}`);
  opened.push(db);
  const sourceId = stored ? await storeChat(db, stored, "Chat with Me") : "";
  const client = inProcessClient(db);
  render(<Importer connect={() => client} />);
  fireEvent.drop(screen.getByTestId("drop-zone"), {
    dataTransfer: {
      files: [new File([fixture(name)], name)],
      getData: () => "",
    },
  });
  return { client, sourceId };
}

test.each([
  "whatsapp-android-gb.txt",
  "whatsapp-android-us.txt",
  "whatsapp-group-gb.txt",
  "whatsapp-ios.txt",
  "whatsapp-ios.zip",
  "whatsapp-de.txt",
  "whatsapp-update-older.txt",
  "whatsapp-update-newer.txt",
  "plaintext.txt",
])("%s, into an empty library: no dialog", async (name) => {
  const { client } = await drop(name);
  await waitFor(() => expect(client.start).toHaveBeenCalledOnce());
  expect(client.start).toHaveBeenCalledWith({}, expect.any(Function));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test.each([
  ["whatsapp-ambiguous-dates.txt", undefined, ["date-order"]],
  ["whatsapp-unsure.txt", undefined, ["adapter"]],
  ["whatsapp-update-older.txt", "whatsapp-update-older.txt", ["duplicate"]],
  ["whatsapp-update-newer.txt", "whatsapp-update-older.txt", ["update"]],
])("%s (stored: %s) asks %j", async (name, stored, expected) => {
  const { client } = await drop(name, stored);
  const dialog = await screen.findByRole("dialog");
  expect(questionsShown(dialog)).toEqual(expected);
  expect(client.start).not.toHaveBeenCalled();
});

test("the answer goes to the save: an accepted update", async () => {
  const { client, sourceId } = await drop(
    "whatsapp-update-newer.txt",
    "whatsapp-update-older.txt",
  );
  await screen.findByRole("dialog");
  fireEvent.click(
    screen.getByRole("button", { name: "Add to “Chat with Me”" }),
  );
  await waitFor(() =>
    expect(client.start).toHaveBeenCalledWith(
      { updateOf: sourceId },
      expect.any(Function),
    ),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});
