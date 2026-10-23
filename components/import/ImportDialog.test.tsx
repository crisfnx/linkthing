import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ScanResult } from "@/lib/import/scan";
import { ImportDialog } from "./ImportDialog";

const chat: ScanResult = {
  fileName: "WhatsApp Chat with Me.txt",
  encoding: "utf-8",
  byteSize: 100,
  contentHash: "hash",
  detection: {
    kind: "whatsapp",
    scores: [
      { kind: "whatsapp", score: 1 },
      { kind: "plaintext", score: 0.1 },
    ],
    needsConfirmation: false,
  },
  dateOrder: "DMY",
  dateOrderAmbiguous: false,
  questions: [],
};

const ambiguous: Partial<ScanResult> = {
  dateOrder: undefined,
  dateOrderAmbiguous: true,
  dateSample: {
    written: "11/06/2024",
    dayFirst: new Date(2024, 5, 11).getTime(),
    monthFirst: new Date(2024, 10, 6).getTime(),
  },
  questions: ["date-order"],
};

const update: Partial<ScanResult> = {
  updateCandidate: {
    sourceId: "chat-1",
    sourceName: "Chat with Me",
    newLinks: 12,
  },
  questions: ["update"],
};

const unsure: Partial<ScanResult> = {
  detection: {
    kind: "plaintext",
    scores: [
      { kind: "whatsapp", score: 0.3 },
      { kind: "plaintext", score: 0.1 },
    ],
    needsConfirmation: true,
  },
  questions: ["adapter"],
};

const longDay = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });

function ask(overrides: Partial<ScanResult>, language = "en-GB") {
  vi.stubGlobal("navigator", { language });
  const onDecide = vi.fn();
  render(<ImportDialog scan={{ ...chat, ...overrides }} onDecide={onDecide} />);
  const dialog = screen.getByRole("dialog", {
    name: "Before importing WhatsApp Chat with Me.txt",
  });
  return { onDecide, dialog: dialog as HTMLDialogElement };
}

const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const pick = (name: string) => fireEvent.click(screen.getByLabelText(name));
const checked = (name: string) =>
  (screen.getByLabelText(name) as HTMLInputElement).checked;
const legends = () =>
  screen.queryAllByRole("group").map((group) => group.firstChild?.textContent);

afterEach(() => {
  vi.unstubAllGlobals();
});

test("it opens as a modal dialog named after the file", () => {
  const { dialog } = ask(ambiguous);
  expect(dialog.open).toBe(true);
});

test("'Don't import' closes it and imports nothing", () => {
  const { dialog, onDecide } = ask(ambiguous);
  click("Don't import");
  expect(dialog.open).toBe(false);
  expect(onDecide).toHaveBeenCalledWith(null);
});

describe("a file imported before", () => {
  const duplicate: Partial<ScanResult> = {
    duplicateOf: {
      sourceId: "chat-1",
      sourceName: "Chat with Me",
      importedAt: new Date(2026, 7, 12).getTime(),
    },
    questions: ["duplicate"],
  };

  test("says when and as what, and imports again on request", () => {
    const { onDecide } = ask(duplicate);
    const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
    expect(
      screen.getByText(
        `You imported this file on ${day.format(new Date(2026, 7, 12))}, as “Chat with Me”. Import it again?`,
      ),
    ).toBeTruthy();
    expect(legends()).toEqual([]);
    click("Import again");
    expect(onDecide).toHaveBeenCalledWith({ kind: "whatsapp" });
  });
});

describe("a newer export of a stored chat", () => {
  test("adding it to the chat is the default", () => {
    const { onDecide } = ask(update);
    expect(
      checked("Add its new messages to “Chat with Me” (12 new links)"),
    ).toBe(true);
    click("Add to “Chat with Me”");
    expect(onDecide).toHaveBeenCalledWith({ updateOf: "chat-1" });
  });

  test("or it becomes a new source", () => {
    const { onDecide } = ask(update);
    pick("Import it as a new source");
    click("Import");
    expect(onDecide).toHaveBeenCalledWith({ kind: "whatsapp" });
  });

  test("the date question appears only for a new source", () => {
    const { onDecide } = ask({
      ...ambiguous,
      ...update,
      questions: ["date-order", "update"],
    });
    expect(legends()).toEqual([
      "This looks like a newer export of “Chat with Me”.",
    ]);

    pick("Import it as a new source");
    expect(legends()).toHaveLength(2);
    pick(`Month first: ${longDay.format(new Date(2024, 10, 6))}`);
    click("Import");
    expect(onDecide).toHaveBeenCalledWith({
      kind: "whatsapp",
      dateOrder: "MDY",
    });
  });
});

describe("dates that fit both orders", () => {
  test("show the last date read both ways", () => {
    ask(ambiguous);
    expect(legends()).toEqual([
      "How are dates written in this chat? Its last message is dated 11/06/2024.",
    ]);
    expect(
      screen.getByLabelText(
        `Day first: ${longDay.format(new Date(2024, 5, 11))}`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        `Month first: ${longDay.format(new Date(2024, 10, 6))}`,
      ),
    ).toBeTruthy();
  });

  test.each([
    ["en-GB", "DMY"],
    ["en-US", "MDY"],
  ])("start from the browser's language: %s → %s", (language, order) => {
    const { onDecide } = ask(ambiguous, language);
    click("Import");
    expect(onDecide).toHaveBeenCalledWith({
      kind: "whatsapp",
      dateOrder: order,
    });
  });

  test("Settings' default order wins over the language", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    const onDecide = vi.fn();
    render(
      <ImportDialog
        scan={{ ...chat, ...ambiguous }}
        defaultDateOrder="DMY"
        onDecide={onDecide}
      />,
    );
    click("Import");
    expect(onDecide).toHaveBeenCalledWith({
      kind: "whatsapp",
      dateOrder: "DMY",
    });
  });

  test("focus starts on the checked option, the one Enter would give", () => {
    ask(ambiguous, "en-US");
    const monthFirst = screen.getByLabelText(
      `Month first: ${longDay.format(new Date(2024, 10, 6))}`,
    );
    expect(document.activeElement).toBe(monthFirst);
  });

  test("and take the other order when chosen", () => {
    const { onDecide } = ask(ambiguous, "en-US");
    pick(`Day first: ${longDay.format(new Date(2024, 5, 11))}`);
    click("Import");
    expect(onDecide).toHaveBeenCalledWith({
      kind: "whatsapp",
      dateOrder: "DMY",
    });
  });
});

describe("a file detection isn't sure of", () => {
  test("offers the likely kind first, and plain text", () => {
    const { onDecide } = ask(unsure);
    expect(checked("As a WhatsApp chat, with dates and senders")).toBe(true);
    click("Import");
    expect(onDecide).toHaveBeenCalledWith({ kind: "whatsapp" });
  });

  test("read as plain text, it isn't asked about dates", () => {
    const { onDecide } = ask({
      ...unsure,
      ...ambiguous,
      questions: ["adapter", "date-order"],
    });
    expect(legends()).toHaveLength(2);
    pick("As plain text, line by line");
    expect(legends()).toEqual([
      "Parts of this look like a chat export. How should it be read?",
    ]);
    click("Import");
    expect(onDecide).toHaveBeenCalledWith({ kind: "plaintext" });
  });
});

describe("a file named as a source that isn't a chat (§6.1)", () => {
  const notes: Partial<ScanResult> = {
    fileName: "notes.txt",
    detection: {
      kind: "plaintext",
      scores: [{ kind: "plaintext", score: 0.1 }],
      needsConfirmation: false,
    },
    dateOrder: undefined,
    replaceCandidate: { sourceId: "notes-1", sourceName: "My notes" },
    questions: ["replace"],
  };

  function askNotes() {
    vi.stubGlobal("navigator", { language: "en-GB" });
    const onDecide = vi.fn();
    render(<ImportDialog scan={{ ...chat, ...notes }} onDecide={onDecide} />);
    screen.getByRole("dialog", { name: "Before importing notes.txt" });
    return onDecide;
  }

  test("offers Replace, chosen to start with", () => {
    const onDecide = askNotes();
    expect(legends()).toEqual(["You already have a source called “My notes”."]);
    expect(checked("Replace it with this file (stars stay)")).toBe(true);
    click("Replace “My notes”");
    expect(onDecide).toHaveBeenCalledWith({
      kind: "plaintext",
      replaceOf: "notes-1",
    });
  });

  test("or as a new source beside it", () => {
    const onDecide = askNotes();
    pick("Import it as a new source");
    click("Import");
    expect(onDecide).toHaveBeenCalledWith({ kind: "plaintext" });
  });
});
