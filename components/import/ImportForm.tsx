"use client";

import { useId, useRef, useState, type Ref } from "react";
import { loadSample } from "@/lib/import/sample";
import { strings } from "@/lib/strings";

interface Props {
  busy: boolean;
  sample?: boolean; // offer the sample data (the library is empty)
  onFiles: (files: File[]) => void;
  onText: (text: string) => void;
  // The "Choose files" button, where focus goes back after an import.
  ref?: Ref<HTMLButtonElement>;
}

const button =
  "rounded-md border border-current px-3 py-1.5 font-medium aria-disabled:opacity-50";

// The ways in besides dropping (§6.1): a file picker, a paste box, the
// clipboard and, while the library is empty, the sample chat. The paste box is
// uncontrolled, so a 10 MB paste isn't copied into React state on every
// change.
//
// While an import runs, the controls are marked aria-disabled rather than
// disabled: a disabled button loses focus, and with it the keyboard user's
// place on the page. Input that arrives meanwhile is ignored.
export function ImportForm({ busy, sample, onFiles, onText, ref }: Props) {
  const files = useRef<HTMLInputElement>(null);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [sampleFailed, setSampleFailed] = useState(false);
  const pasteId = useId();
  const hintId = useId();
  const sampleHintId = useId();

  async function pasteFromClipboard() {
    if (busy) return;
    try {
      const text = await navigator.clipboard.readText();
      setClipboardFailed(false);
      onText(text);
    } catch {
      setClipboardFailed(true);
    }
  }

  async function trySample() {
    if (busy) return;
    try {
      const file = await loadSample();
      setSampleFailed(false);
      onFiles([file]);
    } catch {
      setSampleFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-1">
        <button
          ref={ref}
          type="button"
          className={button}
          aria-disabled={busy}
          aria-describedby={hintId}
          onClick={() => {
            if (!busy) files.current?.click();
          }}
        >
          {strings.chooseFiles}
        </button>
        <p id={hintId} className="text-sm opacity-70">
          {strings.filesHint}
        </p>
        {/* Any extension: unknown ones are read as plain text (§6.1). */}
        <input
          ref={files}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const picked = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = ""; // so the same file can be picked again
            onFiles(picked);
          }}
        />
      </div>

      <form
        className="flex flex-col gap-2"
        action={(data) => {
          if (!busy) onText(String(data.get("text") ?? ""));
        }}
      >
        <label htmlFor={pasteId} className="font-medium">
          {strings.pasteLabel}
        </label>
        <textarea
          id={pasteId}
          name="text"
          rows={6}
          readOnly={busy}
          className="rounded-md border border-current/60 bg-transparent p-2 font-mono text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={button} aria-disabled={busy}>
            {strings.importText}
          </button>
          <button
            type="button"
            className={button}
            aria-disabled={busy}
            onClick={pasteFromClipboard}
          >
            {strings.pasteFromClipboard}
          </button>
        </div>
        {clipboardFailed && <p role="alert">{strings.clipboardFailed}</p>}
      </form>

      {sample && (
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            className={button}
            aria-disabled={busy}
            aria-describedby={sampleHintId}
            onClick={trySample}
          >
            {strings.trySample}
          </button>
          <p id={sampleHintId} className="text-sm opacity-70">
            {strings.sampleHint}
          </p>
          {sampleFailed && <p role="alert">{strings.sampleFailed}</p>}
        </div>
      )}
    </div>
  );
}
