import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import Dexie from "dexie";
import { afterEach, expect, test } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import type { Source } from "@/lib/db/types";
import { SourceList } from "./SourceList";

const opened: LinkVaultDb[] = [];

function freshDb(): LinkVaultDb {
  const db = createDb(`test-${crypto.randomUUID()}`);
  opened.push(db);
  return db;
}

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

function source(name: string, importedAt: number, links: number): Source {
  return {
    id: crypto.randomUUID(),
    name,
    kind: "whatsapp",
    adapterVersion: 1,
    importedAt,
    updatedAt: importedAt,
    stats: {
      messages: 1,
      links,
      uniqueLinks: links,
      domains: 1,
      skippedNonWeb: 0,
    },
    options: { dateOrder: "DMY" },
  };
}

const names = () =>
  screen.getAllByRole("listitem").map((item) => item.firstChild?.textContent);

test("lists sources newest first, and picks up new ones by itself", async () => {
  const db = freshDb();
  await db.sources.add(source("Chat with Me", Date.UTC(2026, 7, 12), 4644));
  render(<SourceList db={db} />);

  const item = await screen.findByRole("listitem");
  expect(item.textContent).toMatch(
    /^Chat with Me · WhatsApp chat · 4,644 links · imported /,
  );

  await db.sources.add(source("Weekend Crew", Date.UTC(2026, 8, 1), 102));
  await waitFor(() =>
    expect(names()).toEqual(["Weekend Crew", "Chat with Me"]),
  );
});

test("an empty library shows no list", async () => {
  const db = freshDb();
  const { container } = render(<SourceList db={db} />);
  await db.sources.count(); // let the live query settle
  expect(container.textContent).toBe("");
});
