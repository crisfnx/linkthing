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
import { loadSample } from "@/lib/import/sample";
import type { Imported, ImportChoice } from "@/lib/import/save";
import type { ScanInput, ScanResult } from "@/lib/import/scan";
import { WorkerError, type ExtractClient } from "@/lib/workers/client";
import { use } from "react";
import { ImportFlowContext } from "./ImportFlow";
import { Importer } from "./Importer";

// Fetching the sample has its own test in lib/import; here it's a file.
vi.mock("@/lib/import/sample", () => ({ loadSample: vi.fn() }));

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
    how: "new",
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
    load: vi.fn(),
    deleteSource: vi.fn(),
    reextract: vi.fn<ExtractClient["reextract"]>(),
    exportLinks: vi.fn<ExtractClient["exportLinks"]>(),
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

  test("a large file gets a note that it will take a while", async () => {
    const client = fakeClient();
    client.start.mockImplementation(() => new Promise<Imported>(() => {}));
    renderImporter(client);
    const file = fileNamed("WhatsApp Chat with Me.txt");
    Object.defineProperty(file, "size", { value: 30_000_000 });
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file], getData: () => "" },
    });

    const progress = await screen.findByRole("region", {
      name: "Import progress",
    });
    expect(progress.textContent).toContain(
      "That's 30 MB, so importing it may take a few minutes.",
    );
  });

  test("a file over 100 MB is turned away, with what to do instead", async () => {
    const client = fakeClient();
    client.scan.mockRejectedValue(new WorkerError("too-large", "too-large"));
    renderImporter(client);
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: {
        files: [fileNamed("WhatsApp Chat - Me.zip")],
        getData: () => "",
      },
    });

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't import WhatsApp Chat - Me.zip: it's over 100 MB, more than LinkVault can take at once. If it's a chat exported with media, export it again without media.",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
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

describe("the sample data", () => {
  test("an empty library offers it, and it imports like a dropped export", async () => {
    const client = fakeClient();
    const sample = fileNamed("WhatsApp Chat with Sample chat.txt");
    vi.mocked(loadSample).mockResolvedValue(sample);
    render(<Importer connect={() => client} empty />);

    fireEvent.click(
      screen.getByRole("button", { name: "Try with sample data" }),
    );

    await screen.findByText("4,644 links found");
    expect(client.scan).toHaveBeenCalledWith(
      { file: sample },
      expect.any(Function),
    );
  });

  test("a library with sources doesn't offer it", () => {
    renderImporter(fakeClient());
    expect(
      screen.queryByRole("button", { name: "Try with sample data" }),
    ).toBeNull();
  });

  test("a sample that can't be loaded says so", async () => {
    vi.mocked(loadSample).mockRejectedValue(new Error("offline"));
    render(<Importer connect={() => fakeClient()} empty />);
    fireEvent.click(
      screen.getByRole("button", { name: "Try with sample data" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't load the sample data. Reload the page and try again.",
    );
  });

  test("when the button goes, focus goes to Choose files", () => {
    const connect = () => fakeClient();
    const { rerender } = render(<Importer connect={connect} empty />);
    screen.getByRole("button", { name: "Try with sample data" }).focus();

    rerender(<Importer connect={connect} empty={false} />);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Choose files" }),
    );
  });
});

describe("once the library has links", () => {
  const renderLibrary = (client: ExtractClient) =>
    render(<Importer connect={() => client} library />);

  test("the form sits behind Import; choosing files closes it and imports", async () => {
    const client = fakeClient();
    renderLibrary(client);
    expect(screen.queryByRole("button", { name: "Choose files" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const panel = screen.getByRole("dialog", { name: "Import links" });
    const file = fileNamed("me.txt");
    fireEvent.change(panel.querySelector("input[type=file]")!, {
      target: { files: [file] },
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("4,644 links found")).toBeTruthy();
    expect(client.scan).toHaveBeenCalledWith({ file }, expect.any(Function));
  });

  test("pasted text imports too; an empty paste leaves the form open", async () => {
    const client = fakeClient();
    renderLibrary(client);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const panel = screen.getByRole("dialog", { name: "Import links" });

    fireEvent.click(within(panel).getByRole("button", { name: "Import text" }));
    await act(async () => {});
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.change(within(panel).getByLabelText("Or paste text"), {
      target: { value: "https://example.com/a" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Import text" }));
    await screen.findByText("4,644 links found");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Close puts the form away without importing", () => {
    const client = fakeClient();
    renderLibrary(client);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(client.scan).not.toHaveBeenCalled();
  });

  test("what an import leaves above the list can be dismissed", async () => {
    renderLibrary(fakeClient());
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [fileNamed("me.txt")], getData: () => "" },
    });
    await screen.findByRole("region", { name: "Imported" });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("region", { name: "Imported" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  test("Import is off during an import, and focus comes back to it after", async () => {
    const client = fakeClient();
    let finish: (value: Imported) => void = () => {};
    client.start.mockImplementation(
      () => new Promise<Imported>((resolve) => (finish = resolve)),
    );
    renderLibrary(client);
    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [fileNamed("me.txt")], getData: () => "" },
    });
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    const importButton = screen.getByRole("button", { name: "Import" });
    expect(importButton.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(importButton);
    expect(screen.queryByRole("dialog")).toBeNull();

    cancel.focus();
    await act(async () => finish(imported()));
    expect(document.activeElement).toBe(importButton);
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
    renderImporter(fakeClient([imported({ how: "updated", newLinks: 12 })]));
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

// The worker belongs to the page (useExtractClient), which stops it.
test("the worker isn't asked for until something is imported", async () => {
  const client = fakeClient();
  const connect = vi.fn(() => client);
  const { unmount } = render(<Importer connect={connect} />);
  expect(connect).not.toHaveBeenCalled();

  fireEvent.drop(screen.getByTestId("drop-zone"), {
    dataTransfer: { files: [fileNamed("me.txt")], getData: () => "" },
  });
  await screen.findByText("4,644 links found");
  expect(connect).toHaveBeenCalled();
  unmount();
  expect(client.terminate).not.toHaveBeenCalled();
});

describe("re-extracting a source (§6.4)", () => {
  // What the Sources dialog does: ask the flow to read a source again.
  function Reextract() {
    const flow = use(ImportFlowContext);
    return (
      <button
        type="button"
        aria-disabled={flow?.busy}
        onClick={() =>
          flow?.reextract([{ id: "chat", name: "Me" }], { dateOrder: "MDY" })
        }
      >
        Read it again
      </button>
    );
  }

  test("runs as an import does: progress, then what came of it", async () => {
    const client = fakeClient();
    let finish: (value: Imported) => void = () => {};
    client.reextract.mockImplementation(async (_id, _choice, onProgress) => {
      onProgress?.({ phase: "parsing" });
      return new Promise<Imported>((resolve) => (finish = resolve));
    });
    render(
      <Importer connect={() => client} library>
        <Reextract />
      </Importer>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Read it again" }));

    const progress = await screen.findByRole("region", {
      name: "Import progress",
    });
    expect(within(progress).getByText("Re-extracting “Me”")).toBeTruthy();
    expect(client.reextract).toHaveBeenCalledWith(
      "chat",
      { dateOrder: "MDY" },
      expect.any(Function),
    );
    expect(
      screen
        .getByRole("button", { name: "Read it again" })
        .getAttribute("aria-disabled"),
    ).toBe("true");

    await act(async () =>
      finish(imported({ name: "Me", how: "reextracted", newLinks: 4644 })),
    );
    expect(screen.getByText("Read again: 4,644 links found")).toBeTruthy();
    expect(client.scan).not.toHaveBeenCalled();
  });

  test("several sources, one after another, as a Settings change needs", async () => {
    const client = fakeClient();
    const finishes: ((value: Imported) => void)[] = [];
    client.reextract.mockImplementation(
      () => new Promise<Imported>((resolve) => finishes.push(resolve)),
    );
    function ReadBoth() {
      const flow = use(ImportFlowContext);
      return (
        <button
          type="button"
          onClick={() =>
            flow?.reextract(
              [
                { id: "chat", name: "Me" },
                { id: "notes", name: "Notes" },
              ],
              {},
            )
          }
        >
          Read both again
        </button>
      );
    }
    render(
      <Importer connect={() => client} library>
        <ReadBoth />
      </Importer>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Read both again" }));
    expect(
      await screen.findByText("Re-extracting “Me” (1 more source after this)"),
    ).toBeTruthy();

    await act(async () =>
      finishes[0]!(imported({ name: "Me", how: "reextracted" })),
    );
    expect(await screen.findByText("Re-extracting “Notes”")).toBeTruthy();
    await act(async () =>
      finishes[1]!(imported({ name: "Notes", how: "reextracted" })),
    );
    expect(client.reextract.mock.calls.map(([id]) => id)).toEqual([
      "chat",
      "notes",
    ]);
    expect(screen.getAllByText(/^Read again:/)).toHaveLength(2);
  });

  test("a failure says the source was left as it was", async () => {
    const client = fakeClient();
    client.reextract.mockRejectedValue(new WorkerError("unexpected", "disk"));
    render(
      <Importer connect={() => client} library>
        <Reextract />
      </Importer>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Read it again" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Something went wrong re-extracting “Me”, and it was left as it was.",
    );
  });
});
