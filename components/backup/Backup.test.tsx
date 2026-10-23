import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Restored } from "@/lib/backup/restore";
import type { ImportProgress } from "@/lib/import/options";
import { WorkerError, type ExtractClient } from "@/lib/workers/client";
import { DownloadBackup, RestoreBackup } from "./Backup";

const saved: string[] = [];

beforeEach(() => {
  saved.length = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:backup",
    revokeObjectURL: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const client = (fields: Partial<ExtractClient>) =>
  (() => fields) as unknown as () => ExtractClient;

const choose = (file: File) =>
  fireEvent.change(document.querySelector("input[type=file]")!, {
    target: { files: [file] },
  });

test("Download a backup saves the file and says what's in it", async () => {
  const backup = vi.fn(async () => ({
    file: new Blob(["x"]),
    counts: { sources: 3, parts: 4, links: 97_956, annotations: 12 },
  }));
  render(<DownloadBackup connect={client({ backup })} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Download a backup" })),
  );
  expect(saved).toEqual([
    expect.stringMatching(/^linkvault-backup-.*\.jsonl\.gz$/),
  ]);
  expect(screen.getByRole("status").textContent).toBe(
    `Saved ${saved[0]}: 3 sources and 97,956 links.`,
  );
});

test("Restore shows its progress, then what came back", async () => {
  let finish: (r: Restored) => void = () => {};
  let report: (p: ImportProgress) => void = () => {};
  const restore = vi.fn(
    (_file: Blob, onProgress?: (p: ImportProgress) => void) =>
      new Promise<Restored>((resolve) => {
        finish = resolve;
        report = onProgress!;
      }),
  );
  const onRunning = vi.fn();
  render(<RestoreBackup connect={client({ restore })} onRunning={onRunning} />);
  choose(new File(["…"], "linkvault-backup.jsonl.gz"));
  expect(screen.getByRole("status").textContent).toBe("Checking the backup…");
  expect(onRunning).toHaveBeenLastCalledWith(true);
  act(() => report({ phase: "saving", done: 40_000, total: 97_953 }));
  expect(screen.getByRole("status").textContent).toBe(
    "Restoring 40,000 of 97,953 links…",
  );
  await act(async () =>
    finish({ sources: 2, links: 97_897, stars: 12, alreadyHere: 1 }),
  );
  expect(screen.getByRole("status").textContent).toBe(
    "Restored 2 sources and 97,897 links, with 12 stars. 1 source in the backup was already here.",
  );
  expect(onRunning).toHaveBeenLastCalledWith(false);
});

test("a file that can't be restored says why, in the worker's words", async () => {
  const restore = vi.fn(async () => {
    throw new WorkerError(
      "invalid-backup",
      "The backup is incomplete: it holds less than it says, as if the download was cut short.",
    );
  });
  render(<RestoreBackup connect={client({ restore })} />);
  await act(async () => choose(new File(["…"], "backup.jsonl.gz")));
  expect(screen.getByRole("alert").textContent).toMatch(
    /^The backup is incomplete/,
  );
});

test("nothing new: says the sources are already here; Cancel stops a restore", async () => {
  const restore = vi.fn(async () => ({
    sources: 0,
    links: 0,
    stars: 0,
    alreadyHere: 3,
  }));
  render(<RestoreBackup connect={client({ restore })} />);
  await act(async () => choose(new File(["…"], "backup.jsonl.gz")));
  expect(screen.getByRole("status").textContent).toBe(
    "Nothing to restore: all 3 sources in this backup are already here.",
  );

  const cancel = vi.fn();
  const pending = vi.fn(() => new Promise<Restored>(() => {}));
  render(<RestoreBackup connect={client({ restore: pending, cancel })} />);
  act(() =>
    fireEvent.change(document.querySelectorAll("input[type=file]")[1]!, {
      target: { files: [new File(["…"], "b.jsonl.gz")] },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(cancel).toHaveBeenCalled();
});
