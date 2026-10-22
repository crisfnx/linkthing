"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { LinkVaultDb } from "@/lib/db/schema";
import type { Link } from "@/lib/extract/types";
import { markLink, removedByCleaning } from "@/lib/library/details";
import { kindAt, textAt, type LibraryRows } from "@/lib/library/rows";
import { displayUrl } from "@/lib/preview/display-url";
import { strings } from "@/lib/strings";
import { KindIcon } from "./KindIcon";

interface Props {
  db: LinkVaultDb;
  rows: LibraryRows;
  row: number; // the link, in rows
  sourceNames: ReadonlyMap<string, string>;
  onClose: () => void;
  onOpenLink: (row: number) => void;
  onCopy: (row: number) => void;
  onStar: (link: Link) => void;
  // "Link copied." and the like. Shown inside the dialog: everything outside
  // a modal dialog is inert, so a notice there would be dimmed and unheard.
  notice?: ReactNode;
}

const button =
  "rounded-md border border-current/40 px-3 py-1.5 font-medium aria-pressed:bg-current/10";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-foreground/65">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

// The details of one link (§6.2), in the browser's own <dialog> on the
// right: focus stays inside, Esc or a click beside it closes it, and focus
// goes back to the row. The row's own data shows at once; the full link
// (context, nearby, position) is read by id and fills in a moment later.
// o opens the link, c copies it, s stars it (§7).
export function DetailsDrawer({
  db,
  rows,
  row,
  sourceNames,
  onClose,
  onOpenLink,
  onCopy,
  onStar,
  notice,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const id = textAt(rows.ids, row);
  const link = useLiveQuery(() => db.links.get(id), [db, id]);
  const annotation = useLiveQuery(
    async () => (link ? db.annotations.get(link.urlKey) : undefined),
    [db, link?.urlKey],
  );
  const starred = annotation?.starred === true;

  // Once, even when React runs effects twice in development.
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const url = textAt(rows.urls, row);
  const title = textAt(rows.titles, row) || displayUrl(url);
  const domain = rows.domainNames[rows.domains[row]!]!;
  const kind = kindAt(rows, row);
  const time = rows.timestamps[row]!;
  const sender = rows.senderNames[rows.senders[row]!];
  const sourceName = sourceNames.get(rows.sourceIds[rows.sources[row]!]!);
  const removed = link ? removedByCleaning(link.url, link.canonicalUrl) : [];

  function onKeyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "o") onOpenLink(row);
    else if (event.key === "c") onCopy(row);
    else if (event.key === "s" && link) onStar(link);
    else return;
    event.preventDefault();
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        // The dialog itself, not its content: the backdrop beside it.
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
      className="m-0 ml-auto h-dvh max-h-none w-[min(32rem,100%)] max-w-none border-l border-current/20 bg-background p-0 text-foreground backdrop:bg-black/40"
    >
      <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
        <div className="flex items-start gap-3">
          <h2
            id={titleId}
            className="min-w-0 flex-1 text-lg font-semibold break-words"
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label={strings.details.close}
            className="rounded-md px-2 text-xl leading-none"
            onClick={() => dialog.current?.close()}
          >
            <span aria-hidden>×</span>
          </button>
        </div>

        {/* Tier 0 until M7 puts the fetched preview here (§6.8). */}
        <div className="flex items-center gap-3 rounded-lg border border-current/15 p-3 text-sm">
          <KindIcon kind={kind} className="size-5 shrink-0" />
          <span>{strings.details.tier0(strings.kindNames[kind], domain)}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            onClick={() => onOpenLink(row)}
          >
            {strings.details.open}
          </button>
          <button type="button" className={button} onClick={() => onCopy(row)}>
            {strings.details.copy}
          </button>
          <button
            type="button"
            className={button}
            aria-pressed={starred}
            disabled={!link}
            onClick={() => link && onStar(link)}
          >
            <span aria-hidden>{starred ? "★ " : "☆ "}</span>
            {starred ? strings.details.starred : strings.details.star}
          </button>
        </div>
        <p className="-mt-4 text-sm text-foreground/65 pointer-coarse:hidden">
          {strings.details.keys}
        </p>

        <section className="flex flex-col gap-1">
          <h3 className="font-semibold">{strings.details.link}</h3>
          <p className="font-mono text-sm break-all">{url}</p>
          {removed.length > 0 && (
            <p className="text-sm text-foreground/65">
              {strings.details.removed(removed)}
            </p>
          )}
          {link && link.url !== link.canonicalUrl && (
            <p className="text-sm">
              <span className="text-foreground/65">
                {strings.details.asFound}:{" "}
              </span>
              <span className="font-mono break-all">{link.url}</span>
            </p>
          )}
          {link?.isBare && <p className="text-sm">{strings.details.bare}</p>}
          {link?.isShortened && (
            <p className="text-sm">{strings.details.shortened}</p>
          )}
        </section>

        {link?.context && (
          <section className="flex flex-col gap-1">
            <h3 className="font-semibold">{strings.details.message}</h3>
            <p className="break-words whitespace-pre-wrap">
              {markLink(link.context, link).map((part, i) =>
                part.link ? (
                  <mark
                    key={i}
                    className="rounded-sm bg-yellow-200 px-0.5 text-black"
                  >
                    {part.text}
                  </mark>
                ) : (
                  <span key={i}>{part.text}</span>
                ),
              )}
            </p>
          </section>
        )}

        {link?.nearby && (
          <section className="flex flex-col gap-1">
            <h3 className="font-semibold">{strings.details.nearby}</h3>
            <p className="break-words whitespace-pre-wrap text-foreground/80">
              {link.nearby}
            </p>
          </section>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {sender && <Field label={strings.details.sentBy}>{sender}</Field>}
          {!Number.isNaN(time) && (
            <Field label={strings.details.date}>
              {strings.linkDateAndTime(time)}
            </Field>
          )}
          {sourceName && (
            <Field label={strings.details.source}>
              {link
                ? strings.details.sourceLine(sourceName, link.position.line)
                : sourceName}
            </Field>
          )}
          <Field label={strings.details.kind}>{strings.kindNames[kind]}</Field>
        </dl>
      </div>
      {notice}
    </dialog>
  );
}
