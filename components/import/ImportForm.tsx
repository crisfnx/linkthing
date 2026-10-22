"use client";

import { useId, useRef, useState } from "react";
import { strings } from "@/lib/strings";

interface Props {
  disabled: boolean;
  onFiles: (files: File[]) => void;
  onText: (text: string) => void;
}

const button =
  "rounded-md border border-current px-3 py-1.5 font-medium disabled:opacity-50";

// The ways in besides dropping (§6.1): a file picker, a paste box and the
// clipboard. The paste box is uncontrolled, so a 10 MB paste isn't copied
// into React state on every change.
export function ImportForm({ disabled, onFiles, onText }: Props) {
  const files = useRef<HTMLInputElement>(null);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const pasteId = useId();
  const hintId = useId();

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      setClipboardFailed(false);
      onText(text);
    } catch {
      setClipboardFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          className={button}
          disabled={disabled}
          aria-describedby={hintId}
          onClick={() => files.current?.click()}
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
        action={(data) => onText(String(data.get("text") ?? ""))}
      >
        <label htmlFor={pasteId} className="font-medium">
          {strings.pasteLabel}
        </label>
        <textarea
          id={pasteId}
          name="text"
          rows={6}
          disabled={disabled}
          className="rounded-md border border-current/40 bg-transparent p-2 font-mono text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={button} disabled={disabled}>
            {strings.importText}
          </button>
          <button
            type="button"
            className={button}
            disabled={disabled}
            onClick={pasteFromClipboard}
          >
            {strings.pasteFromClipboard}
          </button>
        </div>
        {clipboardFailed && <p role="alert">{strings.clipboardFailed}</p>}
      </form>
    </div>
  );
}
