import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ImportProgress } from "@/lib/import/options";
import type { Imported, ImportChoice } from "@/lib/import/save";
import type { ScanInput, ScanResult } from "@/lib/import/scan";
import { WorkerError, type ExtractClient } from "@/lib/workers/client";
import { Importer } from "./Importer";

const at = (y: number, mo: number, d: number) =>
  new Date(y, mo - 1, d).getTime();

const scanned: ScanResult = {
  encoding: "utf-8",
  byteSize: 100,
  contentHash: "hash",
  detection: { kind: "whatsapp", scores: [], needsConfirmation: false },
  dateOrder: "DMY",
  dateOrderAmbiguous: false,
  questions: [],
};

function imported(overrides: Partial<Imported> = {}): Imported {
  return {
    sourceId: crypto.randomUUID(),
    name: "Chat with Me",
    updated: false,
    newLinks: 4644,
    stats: {
      messages: 5210,
      links: 4644,
      uniqueLinks: 4102,
      domains: 312,
      skippedNonWeb: 3,
      earliest: at(2022, 7, 5),
      latest: at(2026, 10, 21),
    },
    ...overrides,
  };
}

// A worker client whose scan and start report a phase each and resolve with
// what the test sets up.
function fakeClient(results: Imported[] = [imported()]) {
  const queue = [...results];
  const client = {
    ping: vi.fn(),
    scan: vi.fn(
      async (_input: ScanInput, onProgress?: (p: ImportProgress) => void) => {
        onProgress?.({ phase: "scanning" });
        return scanned;
      },
    ),
    start: vi.fn(
      async (
        _choice?: ImportChoice,
        onProgress?: (p: ImportProgress) => void,
      ) => {
        onProgress?.({ phase: "saving", done: 0, total: 1 });
        const next = queue.shift();
        if (!next) throw new Error("no result queued");
        return next;
      },
    ),
    cancel: vi.fn(),
    terminate: vi.fn(),
  } satisfies ExtractClient;
  return client;
}

function renderImporter(client: ExtractClient) {
  return render(<Importer connect={() => client} />);
}

const fileNamed = (name: string) =>
  new File(["25/05/2023, 19:48 - Cris: hi"], name);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ways in", () => {
  test("dropping a file anywhere on the page imports it", async () => {
    const client = fakeClient();
    renderImporter(client);
    const file = fileNamed("WhatsApp Chat with Me.txt");

    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file], getData: () => "" },
    });

    expect(await screen.findByText("4,644 links found")).toBeTruthy();
    expect(client.scan).toHaveBeenCalledWith({ file }, expect.any(Function));
    expect(client.start).toHaveBeenCalledWith({}, expect.any(Function));
  });

  test("several files are imported one after another", async () => {
    const client = fakeClient([
      imported({ name: "Chat with Me" }),
      imported({ name: "Weekend Crew" }),
    ]);
    renderImporter(client);
    const files = [fileNamed("a.txt"), fileNamed("b.zip")];

    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files, getData: () => "" },
    });

    expect(await screen.findByText("Weekend Crew")).toBeTruthy();
    expect(screen.getByText("Chat with Me")).toBeTruthy();
    expect(client.scan.mock.calls.map(([input]) => input)).toEqual(
      files.map((file) => ({ file })),
    );
  });

  test("text pasted into the box is imported", async () => {
    const client = fakeClient();
    renderImporter(client);

    fireEvent.change(screen.getByLabelText("Or paste text"), {
      target: { value: "https://example.com/a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import text" }));

    await screen.findByText("4,644 links found");
    expect(client.scan).toHaveBeenCalledWith(
      { text: "https://example.com/a" },
      expect.any(Function),
    );
  });

  test("an empty paste does nothing", async () => {
    const client = fakeClient();
    renderImporter(client);
    fireEvent.click(screen.getByRole("button", { name: "Import text" }));
    await act(async () => {});
    expect(client.scan).not.toHaveBeenCalled();
  });

  test("'Paste from clipboard' imports the clipboard's text", async () => {
    const client = fakeClient();
    vi.stubGlobal("navigator", {
      clipboard: { readText: async () => "https://example.com/b" },
    });
    renderImporter(client);

    fireEvent.click(
      screen.getByRole("button", { name: "Paste from clipboard" }),
    );

    await screen.findByText("4,644 links found");
    expect(client.scan).toHaveBeenCalledWith(
      { text: "https://example.com/b" },
      expect.any(Function),
    );
  });

  test("a clipboard the page may not read says so", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { readText: () => Promise.reject(new Error("denied")) },
    });
    renderImporter(fakeClient());
    fireEvent.click(
      screen.getByRole("button", { name: "Paste from clipboard" }),
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Couldn't read the clipboard/,
    );
  });
});

describe("while importing", () => {
  test("phases are shown, announced, and the inputs are off", async () => {
    const client = fakeClient();
    let finish: (value: Imported) => void = () => {};
    client.start.mockImplementation(async (_choice, onProgress) => {
      onProgress?.({ phase: "saving", done: 1000, total: 4644 });
      return new Promise<Imported>((resolve) => (finish = resolve));
    });
    renderImporter(client);
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [fileNamed("me.txt")], getData: () => "" },
    });

    const progress = await screen.findByRole("region", {
      name: "Import progress",
    });
    expect(within(progress).getByText("Importing me.txt")).toBeTruthy();
    const step = within(progress).getByText("Saving");
    expect(step.getAttribute("aria-current")).toBe("step");
    const bar = within(progress).getByRole("progressbar");
    expect([bar.getAttribute("value"), bar.getAttribute("max")]).toEqual([
      "1000",
      "4644",
    ]);
    expect(screen.getByRole("status").textContent).toBe("Saving…");
    // Marked, not disabled, so whatever has focus keeps it.
    expect(
      screen
        .getByRole("button", { name: "Import text" })
        .getAttribute("aria-disabled"),
    ).toBe("true");

    await act(async () => finish(imported()));
    expect(screen.getByRole("status").textContent).toBe("Import finished.");
    expect(
      screen.queryByRole("region", { name: "Import progress" }),
    ).toBeNull();
  });

  test("cancel stops the import and says nothing was saved", async () => {
    const client = fakeClient();
    let fail: (error: Error) => void = () => {};
    client.start.mockImplementation(
      () => new Promise<Imported>((_, reject) => (fail = reject)),
    );
    client.cancel.mockImplementation(() =>
      fail(new WorkerError("cancelled", "The operation was aborted.")),
    );
    renderImporter(client);
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: {
        files: [fileNamed("a.txt"), fileNamed("b.txt")],
        getData: () => "",
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Import cancelled. Nothing from it was saved.",
      ),
    );
    expect(client.cancel).toHaveBeenCalledOnce();
    expect(client.scan).toHaveBeenCalledOnce(); // b.txt never started
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  test("a cancel the scan missed still stops the import before it saves", async () => {
    const client = fakeClient();
    let finishScan: (scan: ScanResult) => void = () => {};
    client.scan.mockImplementation(async (_input, onProgress) => {
      onProgress?.({ phase: "scanning" });
      return new Promise<ScanResult>((resolve) => (finishScan = resolve));
    });
    renderImporter(client);
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [fileNamed("me.txt")], getData: () => "" },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await act(async () => finishScan(scanned)); // finished after all

    expect(screen.getByRole("status").textContent).toBe(
      "Import cancelled. Nothing from it was saved.",
    );
    expect(client.start).not.toHaveBeenCalled();
  });

  test("a failure says what happened and stops the queue", async () => {
    const client = fakeClient();
    client.scan.mockRejectedValue(
      new WorkerError("zip-without-chat", "zip-without-chat"),
    );
    renderImporter(client);
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: {
        files: [fileNamed("WhatsApp Chat - Me.zip"), fileNamed("b.txt")],
        getData: () => "",
      },
    });

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't find a chat in WhatsApp Chat - Me.zip: there's no .txt inside. Export the chat again and drop the new file.",
    );
    expect(client.scan).toHaveBeenCalledOnce();
    // The same zip would fail the same way, so there's no Try again.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("Try again picks up at the file that failed, keeping earlier results", async () => {
    const client = fakeClient([
      imported({ name: "First" }),
      imported({ name: "Second" }),
      imported({ name: "Third" }),
    ]);
    const start = client.start.getMockImplementation();
    client.start.mockImplementationOnce(start!).mockImplementationOnce(() => {
      throw new WorkerError("unexpected", "Transaction aborted");
    });
    renderImporter(client);
    const files = [fileNamed("a.txt"), fileNamed("b.txt"), fileNamed("c.txt")];
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files, getData: () => "" },
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Something went wrong importing b.txt, and nothing was saved.",
    );
    expect(alert.textContent).toContain("Transaction aborted");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Third")).toBeTruthy();
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
    expect(client.scan.mock.calls.map(([input]) => input)).toEqual(
      [files[0], files[1], files[1], files[2]].map((file) => ({ file })),
    );
  });

  test("a scan with questions waits for the dialog; skipping imports nothing", async () => {
    const client = fakeClient();
    client.scan.mockResolvedValue({
      ...scanned,
      fileName: "me.txt",
      duplicateOf: {
        sourceId: "s",
        sourceName: "Me",
        importedAt: at(2026, 8, 12),
      },
      questions: ["duplicate"],
    });
    renderImporter(client);
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [fileNamed("me.txt")], getData: () => "" },
    });

    await screen.findByRole("dialog", { name: "Before importing me.txt" });
    fireEvent.click(screen.getByRole("button", { name: "Don't import" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Nothing was imported.",
      ),
    );
    expect(client.start).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the summary", () => {
  test("links, unique links, sites, date range and skipped links", async () => {
    renderImporter(fakeClient());
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [fileNamed("me.txt")], getData: () => "" },
    });

    const summary = await screen.findByRole("region", { name: "Imported" });
    const rows = Array.from(summary.querySelectorAll("dt"), (dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]);
    expect(rows).toEqual([
      ["Links", "4,644"],
      ["Unique links", "4,102"],
      ["Sites", "312"],
      [
        "Dates",
        new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).formatRange(
          at(2022, 7, 5),
          at(2026, 10, 21),
        ),
      ],
      ["Skipped (email, phone and app links)", "3"],
    ]);
  });

  test("an update leads with the links it added", async () => {
    renderImporter(fakeClient([imported({ updated: true, newLinks: 12 })]));
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [fileNamed("newer.txt")], getData: () => "" },
    });
    expect(
      await screen.findByText("12 new links added to this chat"),
    ).toBeTruthy();
  });

  test("no links: the messages that were read, and nothing else", async () => {
    const empty = imported({ newLinks: 0 });
    empty.stats = {
      messages: 37,
      links: 0,
      uniqueLinks: 0,
      domains: 0,
      skippedNonWeb: 0,
    };
    renderImporter(fakeClient([empty]));
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [fileNamed("notes.txt")], getData: () => "" },
    });
    expect(
      await screen.findByText("No links found in 37 messages."),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Imported" }).querySelector("dl"),
    ).toBeNull();
  });
});

test("the worker is started on the first import and stopped with the page", async () => {
  const client = fakeClient();
  const connect = vi.fn(() => client);
  const { unmount } = render(<Importer connect={connect} />);
  expect(connect).not.toHaveBeenCalled();

  fireEvent.drop(screen.getByTestId("drop-zone"), {
    dataTransfer: { files: [fileNamed("me.txt")], getData: () => "" },
  });
  await screen.findByText("4,644 links found");
  unmount();
  expect(connect).toHaveBeenCalledOnce();
  expect(client.terminate).toHaveBeenCalledOnce();
});
