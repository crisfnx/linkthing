import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Link } from "@/lib/extract/types";
import { describeUrl } from "@/lib/extract/url/describe";
import { allRows, type ExportScope } from "@/lib/export/scope";
import { RowsBuilder, textAt } from "@/lib/library/rows";
import type { ExtractClient } from "@/lib/workers/client";
import { ExportDialog } from "./ExportDialog";

let next = 0;

function link(url: string, timestamp: number): Link {
  next++;
  return {
    id: `l${next}`,
    sourceId: "chat",
    url,
    ...describeUrl(url),
    timestamp,
    position: { line: next, column: 0, messageIndex: next },
  };
}

// A video shared twice and a page; the view shows the page alone.
const builder = new RowsBuilder(["chat"]);
[
  link("https://youtu.be/Ex4mpLeV1d0", 3),
  link("https://example.com/a", 2),
  link("https://www.youtube.com/watch?v=Ex4mpLeV1d0", 1),
].forEach((l) => builder.add(l));
const rows = builder.finish();

const saved: { name: string; url: string }[] = [];

beforeEach(() => {
  saved.length = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:export",
    revokeObjectURL: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, url: this.getAttribute("href")! });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function open({
  selection = null as Uint32Array | null,
  scope = "view" as ExportScope,
  once = false,
  exportLinks = vi.fn<ExtractClient["exportLinks"]>(async (ids) => ({
    file: new Blob(["file"]),
    links: ids.length,
  })),
} = {}) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <ExportDialog
      rows={rows}
      lists={{ view: Uint32Array.from([1]), selection, library: allRows(rows) }}
      scope={scope}
      once={once}
      connect={() => ({ exportLinks }) as unknown as ExtractClient}
      onDone={onDone}
      onClose={onClose}
    />,
  );
  return { exportLinks, onDone, onClose };
}

const radio = (name: string | RegExp) => screen.getByRole("radio", { name });

test("asks which links, duplicates and format; counts follow the choice", () => {
  open();
  expect(radio("This view (1 link)")).toBeTruthy();
  expect(radio("Whole library (3 links)")).toBeTruthy();
  // No selection, no option for it.
  expect(screen.queryByRole("radio", { name: /^Selected/ })).toBeNull();
  // Focus on the chosen scope, so Enter downloads.
  expect(document.activeElement).toBe(radio("This view (1 link)"));
  fireEvent.click(radio("Once each"));
  expect(radio("Whole library (2 links)")).toBeTruthy();
});

test("Download writes the file in the worker, saves it, and closes", async () => {
  const { exportLinks, onDone } = open({ once: true });
  fireEvent.click(radio("Whole library (2 links)"));
  fireEvent.click(radio(/^Markdown/));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Download" })),
  );
  expect(exportLinks).toHaveBeenCalledWith(
    [textAt(rows.ids, 0), textAt(rows.ids, 1)],
    "markdown",
    [2, 1],
  );
  expect(saved).toHaveLength(1);
  expect(saved[0]!.name).toMatch(/^linkvault-library-\d{4}-\d\d-\d\d\.md$/);
  expect(onDone).toHaveBeenCalledWith("Exported 2 links.");
  expect(
    (screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement).open,
  ).toBe(false);
});

test("a selection opens on itself", () => {
  open({ selection: Uint32Array.from([0, 2]), scope: "selection" });
  expect((radio("Selected (2 links)") as HTMLInputElement).checked).toBe(true);
});

test("Copy URLs copies the chosen links' URLs, at once", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const { onDone, exportLinks } = open();
  fireEvent.click(radio("Whole library (3 links)"));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Copy URLs" })),
  );
  expect(writeText).toHaveBeenCalledWith(
    [0, 1, 2].map((r) => textAt(rows.urls, r)).join("\n"),
  );
  expect(onDone).toHaveBeenCalledWith("Copied 3 URLs.");
  expect(exportLinks).not.toHaveBeenCalled();
});

test("a failure says so and leaves the dialog open to try again", async () => {
  const exportLinks = vi.fn<ExtractClient["exportLinks"]>(async () => {
    throw new Error("disk");
  });
  open({ exportLinks });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Download" })),
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "Couldn't export the links. Try again.",
  );
  expect(saved).toHaveLength(0);
  expect(
    screen
      .getByRole("button", { name: "Download" })
      .getAttribute("aria-disabled"),
  ).toBe("false");
});
