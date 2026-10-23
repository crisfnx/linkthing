"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { DateOrder, SourceKind } from "@/lib/extract/types";
import type { ImportChoice } from "@/lib/import/save";
import { likelyKind, type ScanResult } from "@/lib/import/scan";
import { dateOrderFor } from "@/lib/locale";
import { strings } from "@/lib/strings";

interface Props {
  scan: ScanResult;
  // The answer preselected for dates that fit both orders: Settings' default
  // (§6.7), else the browser language's order.
  defaultDateOrder?: DateOrder;
  // null: don't import this one.
  onDecide: (choice: ImportChoice | null) => void;
}

const button = "rounded-md border border-current px-3 py-1.5 font-medium";

function Choice(props: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-start gap-2">
      <input
        type="radio"
        name={props.name}
        checked={props.checked}
        onChange={props.onSelect}
        className="mt-1.5"
      />
      <span>{props.children}</span>
    </label>
  );
}

// Asks only what the scan couldn't settle (§6.1), all in one dialog: whether
// to add a newer export to its chat, what kind of file an unsure one is, and
// which way round its dates are. A duplicate file is confirmed first.
//
// The browser's own <dialog>: showModal() keeps focus inside it, makes the
// page behind it inert, closes it on Esc and puts focus back afterwards.
export function ImportDialog({ scan, defaultDateOrder, onDecide }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Set on submit; Esc and "Don't import" close the dialog without one.
  const answer = useRef<ImportChoice | null>(null);
  const titleId = useId();
  const groupName = useId();

  const update = scan.updateCandidate;
  const replace = scan.replaceCandidate;
  const offered = likelyKind(scan.detection);
  const [asUpdate, setAsUpdate] = useState(update !== undefined);
  // Replace is the likely intent for a file of the same name: an edited
  // version of the same notes (§6.1). Stars survive it either way.
  const [asReplace, setAsReplace] = useState(replace !== undefined);
  const [kind, setKind] = useState<SourceKind>(offered);
  const [dateOrder, setDateOrder] = useState<DateOrder>(
    () => defaultDateOrder ?? dateOrderFor(navigator.language),
  );

  // Once, even when React runs effects twice in development. The browser
  // focuses the first control, which may be an unchecked option; the checked
  // one is the answer that Enter would give, so it starts there.
  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    element.showModal();
    element.querySelector<HTMLInputElement>("input:checked")?.focus();
  }, []);

  // An update keeps the chat's kind and day/month order, so it asks neither.
  const asksKind = scan.questions.includes("adapter") && !asUpdate;
  const asksDates = scan.dateOrderAmbiguous && !asUpdate && kind === "whatsapp";

  function choice(): ImportChoice {
    if (update && asUpdate) return { updateOf: update.sourceId };
    const read: ImportChoice = asksDates ? { kind, dateOrder } : { kind };
    return replace && asReplace
      ? { ...read, replaceOf: replace.sourceId }
      : read;
  }

  const label = scan.fileName ?? strings.pastedText;
  const { dialog: say } = strings;
  const primary =
    update && asUpdate
      ? say.addToSource(update.sourceName)
      : replace && asReplace
        ? say.replaceSource(replace.sourceName)
        : scan.duplicateOf
          ? say.importAgain
          : say.import;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={() => onDecide(answer.current)}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-lg border border-current/20 bg-background p-6 text-foreground backdrop:bg-black/50"
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          answer.current = choice();
          dialog.current?.close();
        }}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {say.title(label)}
        </h2>

        {scan.duplicateOf && (
          <p>
            {say.duplicate(
              scan.duplicateOf.importedAt,
              scan.duplicateOf.sourceName,
            )}
          </p>
        )}

        {update && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2">{say.update(update.sourceName)}</legend>
            <Choice
              name={`${groupName}-update`}
              checked={asUpdate}
              onSelect={() => setAsUpdate(true)}
            >
              {say.addTo(update.sourceName, update.newLinks)}
            </Choice>
            <Choice
              name={`${groupName}-update`}
              checked={!asUpdate}
              onSelect={() => setAsUpdate(false)}
            >
              {say.asNewSource}
            </Choice>
          </fieldset>
        )}

        {replace && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2">{say.replace(replace.sourceName)}</legend>
            <Choice
              name={`${groupName}-replace`}
              checked={asReplace}
              onSelect={() => setAsReplace(true)}
            >
              {say.replaceIt}
            </Choice>
            <Choice
              name={`${groupName}-replace`}
              checked={!asReplace}
              onSelect={() => setAsReplace(false)}
            >
              {say.asNewSource}
            </Choice>
          </fieldset>
        )}

        {asksKind && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2">{say.kind}</legend>
            {[offered, "plaintext" as const].map((option) => (
              <Choice
                key={option}
                name={`${groupName}-kind`}
                checked={kind === option}
                onSelect={() => setKind(option)}
              >
                {say.readAs(option)}
              </Choice>
            ))}
          </fieldset>
        )}

        {asksDates && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2">
              {say.dateOrder(scan.dateSample?.written)}
            </legend>
            <Choice
              name={`${groupName}-dates`}
              checked={dateOrder === "DMY"}
              onSelect={() => setDateOrder("DMY")}
            >
              {say.dayFirst(scan.dateSample?.dayFirst)}
            </Choice>
            <Choice
              name={`${groupName}-dates`}
              checked={dateOrder === "MDY"}
              onSelect={() => setDateOrder("MDY")}
            >
              {say.monthFirst(scan.dateSample?.monthFirst)}
            </Choice>
          </fieldset>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className={`${button} bg-foreground text-background`}
          >
            {primary}
          </button>
          <button
            type="button"
            className={button}
            onClick={() => dialog.current?.close()}
          >
            {say.skip}
          </button>
        </div>
      </form>
    </dialog>
  );
}
