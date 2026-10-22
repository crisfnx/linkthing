"use client";

import { useEffect, useId, useRef } from "react";
import { strings } from "@/lib/strings";
import { ImportForm } from "./ImportForm";

interface Props {
  busy: boolean;
  onFiles: (files: File[]) => void;
  onText: (text: string) => void;
  onClose: () => void;
}

// Once the library has links, the ways in sit behind the header's Import
// button: the same form, in the browser's own <dialog> (focus kept inside,
// Esc closes, focus goes back to the button). Choosing files or importing
// text closes it, so the progress shows above the list. Dropping a file
// anywhere on the page works as before.
export function ImportPanel({ busy, onFiles, onText, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Once, even when React runs effects twice in development.
  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    element.showModal();
  }, []);

  function closeThen(start: () => void) {
    dialog.current?.close();
    start();
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(36rem,calc(100%-2rem))] rounded-lg border border-current/20 bg-background p-6 text-foreground backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-6">
        <h2 id={titleId} className="text-lg font-semibold">
          {strings.importPanel}
        </h2>
        <ImportForm
          busy={busy}
          onFiles={(files) => closeThen(() => onFiles(files))}
          onText={(text) => {
            // An empty paste does nothing, so the dialog stays.
            if (text.trim() !== "") closeThen(() => onText(text));
          }}
        />
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-md border border-current px-3 py-1.5 font-medium"
            onClick={() => dialog.current?.close()}
          >
            {strings.close}
          </button>
        </div>
      </div>
    </dialog>
  );
}
