import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import Dexie from "dexie";
import { afterEach, expect, test, vi } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { describeUrl } from "@/lib/extract/url/describe";
import { RowsBuilder, type LibraryRows } from "@/lib/library/rows";
import type { ExtractClient } from "@/lib/workers/client";
import { useExtractClient } from "./useExtractClient";
import { useLibrary } from "./useLibrary";

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

function rowsOf(...urls: string[]): LibraryRows {
  const builder = new RowsBuilder(["s"]);
  urls.forEach((url, i) =>
    builder.add({
      id: `l${i}`,
      sourceId: "s",
      url,
      ...describeUrl(url),
      position: { line: i, column: 0, messageIndex: i },
    }),
  );
  return builder.finish();
}

function fakeClient(load: ExtractClient["load"]) {
  return {
    ping: vi.fn(),
    scan: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    terminate: vi.fn(),
    load: vi.fn(load),
  } satisfies ExtractClient;
}

// As an import leaves it: a source, with updatedAt marking the change.
async function addSource(db: LinkVaultDb, id: string, at = Date.now()) {
  await db.sources.put({
    id,
    name: id,
    kind: "plaintext",
    adapterVersion: 1,
    importedAt: at,
    updatedAt: at,
    stats: {
      messages: 1,
      links: 1,
      uniqueLinks: 1,
      domains: 1,
      skippedNonWeb: 0,
    },
    options: {},
  });
}

test("an empty library is ready at once, without starting the worker", async () => {
  const connect = vi.fn(() => fakeClient(async () => rowsOf()));
  const { result } = renderHook(() => useLibrary(freshDb(), connect));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.status === "ready" && result.current.rows.count).toBe(
    0,
  );
  expect(connect).not.toHaveBeenCalled();
});

test("with sources, the worker reads the rows", async () => {
  const db = freshDb();
  await addSource(db, "chat");
  const client = fakeClient(async () => rowsOf("https://example.com/a"));
  const { result } = renderHook(() => useLibrary(db, () => client));

  expect(result.current.status).toBe("loading");
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.status === "ready" && result.current.rows.count).toBe(
    1,
  );
  expect(client.load).toHaveBeenCalledOnce();
});

test("an import changes the sources, and the rows are read again", async () => {
  const db = freshDb();
  await addSource(db, "chat", 1);
  let next = rowsOf("https://example.com/a");
  const client = fakeClient(async () => next);
  const { result } = renderHook(() => useLibrary(db, () => client));
  await waitFor(() => expect(result.current.status).toBe("ready"));

  next = rowsOf("https://example.com/a", "https://example.com/b");
  await act(() => addSource(db, "chat", 2)); // an update: same id, new time
  await waitFor(() =>
    expect(result.current.status === "ready" && result.current.rows.count).toBe(
      2,
    ),
  );
  expect(client.load).toHaveBeenCalledTimes(2);
});

test("an answer overtaken by a newer read is dropped", async () => {
  const db = freshDb();
  await addSource(db, "chat", 1);
  const answers: Array<(rows: LibraryRows) => void> = [];
  const client = fakeClient(
    () => new Promise((resolve) => answers.push(resolve)),
  );
  const { result } = renderHook(() => useLibrary(db, () => client));
  await waitFor(() => expect(answers).toHaveLength(1));
  await act(() => addSource(db, "chat", 2));
  await waitFor(() => expect(answers).toHaveLength(2));

  await act(async () => answers[1]!(rowsOf("https://example.com/new")));
  await act(async () =>
    answers[0]!(rowsOf("https://example.com/old", "https://example.com/x")),
  );
  expect(result.current.status === "ready" && result.current.rows.count).toBe(
    1,
  );
});

test("a failed read says so", async () => {
  const db = freshDb();
  await addSource(db, "chat");
  const client = fakeClient(() => Promise.reject(new Error("disk on fire")));
  const { result } = renderHook(() => useLibrary(db, () => client));
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current).toEqual({
    status: "failed",
    message: "disk on fire",
  });
});

test("the page's worker starts when first asked for, once, and stops with the page", () => {
  const client = fakeClient(async () => rowsOf());
  const create = vi.fn(() => client);
  const { result, unmount } = renderHook(() => useExtractClient(create));
  expect(create).not.toHaveBeenCalled();

  expect(result.current()).toBe(client);
  expect(result.current()).toBe(client);
  expect(create).toHaveBeenCalledOnce();
  unmount();
  expect(client.terminate).toHaveBeenCalledOnce();
});
