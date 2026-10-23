"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  EXPORT_FORMATS,
  FILE_TYPES,
  type ExportFormat,
} from "@/lib/export/rows";
import {
  exportOrder,
  fileName,
  idsOf,
  saveFile,
  urlsOf,
  type ExportScope,
} from "@/lib/export/scope";
import type { LibraryRows } from "@/lib/library/rows";
import { strings } from "@/lib/strings";
import type { ExtractClient } from "@/lib/workers/client";

interface Props {
  rows: LibraryRows;
  // Each scope's rows in order, copies included; no selection, no option.
  lists: Record<ExportScope, Uint32Array | null>;
  scope: ExportScope; // chosen when it opens
  once: boolean; // as the list shows duplicates
  connect: () => ExtractClient; // files are written in the worker
  // After a download or a copy, said by the page: the dialog has closed.
  onDone: (notice: string) => void;
  onClose: () => void;
}

const SCOPES: readonly ExportScope[] = ["view", "selection", "library"];

const button =
  "rounded-md border border-current/40 px-2.5 py-1 text-sm font-medium aria-disabled:opacity-50";

// Export (§6.5) in the browser's own <dialog>: which links, links shared
// more than once, and the format. Download writes the file in the worker,
// with the message and sender the rows don't carry; Copy URLs takes them
// from the rows at once. Focus starts on the chosen scope, so Enter
// downloads and Esc closes.
export function ExportDialog({
  rows,
  lists,
  scope: initialScope,
  once: initialOnce,
  connect,
  onDone,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [scope, setScope] = useState(initialScope);
  const [once, setOnce] = useState(initialOnce);
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const planFor = (which: ExportScope) => {
    const list = lists[which];
    return list ? exportOrder(rows, list, once) : null;
  };
  const plan = planFor(scope);
  const count = plan?.order.length ?? 0;

  // Once, even when React runs effects twice in development.
  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    element.showModal();
    element.querySelector<HTMLInputElement>("input:checked")?.focus();
  }, []);

  async function download() {
    if (busy || !plan || count === 0) return;
    setBusy(true);
    setProblem(null);
    try {
      const { file, links } = await connect().exportLinks(
        idsOf(rows, plan.order),
        format,
        plan.shared ? Array.from(plan.shared) : undefined,
      );
      saveFile(file, fileName(scope, FILE_TYPES[format].extension));
      onDone(strings.exports.exported(links));
      dialog.current?.close();
    } catch {
      setProblem(strings.exports.failed);
      setBusy(false);
    }
  }

  // Straight from the click, with nothing awaited first: browsers allow the
  // clipboard only in answer to one.
  function copy() {
    if (busy || !plan || count === 0) return;
    navigator.clipboard.writeText(urlsOf(rows, plan.order).join("\n")).then(
      () => {
        onDone(strings.exports.copied(count));
        dialog.current?.close();
      },
      () => setProblem(strings.exports.copyFailed),
    );
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        // While the file is written, it waits.
        if (busy) event.preventDefault();
      }}
      className="m-auto max-h-[85dvh] w-[min(32rem,calc(100%-2rem))] rounded-lg border border-current/20 bg-background p-6 text-foreground backdrop:bg-black/50"
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void download();
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {strings.exports.title}
        </h2>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">{strings.exports.which}</legend>
          {SCOPES.filter((which) => lists[which]).map((which) => (
            <label key={which} className="flex items-center gap-2">
              <input
                type="radio"
                name={`${titleId}-scope`}
                checked={scope === which}
                onChange={() => setScope(which)}
              />
              {strings.exports.scopes[which](planFor(which)?.order.length ?? 0)}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">
            {strings.exports.duplicates}
          </legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${titleId}-once`}
              checked={once}
              onChange={() => setOnce(true)}
            />
            {strings.exports.once}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${titleId}-once`}
              checked={!once}
              onChange={() => setOnce(false)}
            />
            {strings.exports.everyTime}
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-medium">{strings.exports.format}</legend>
          {EXPORT_FORMATS.map((which) => (
            <label key={which} className="flex items-center gap-2">
              <input
                type="radio"
                name={`${titleId}-format`}
                checked={format === which}
                onChange={() => setFormat(which)}
              />
              {strings.exports.formats[which]}
            </label>
          ))}
        </fieldset>

        {problem && <p role="alert">{problem}</p>}
        {busy && <p role="status">{strings.exports.preparing}</p>}
        {count === 0 && <p>{strings.exports.nothing}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={button}
            aria-disabled={busy}
            onClick={() => !busy && dialog.current?.close()}
          >
            {strings.exports.cancel}
          </button>
          <button
            type="button"
            className={button}
            aria-disabled={busy || count === 0}
            onClick={copy}
          >
            {strings.exports.copy}
          </button>
          <button
            type="submit"
            className={button}
            aria-disabled={busy || count === 0}
          >
            {strings.exports.download}
          </button>
        </div>
      </form>
    </dialog>
  );
}
