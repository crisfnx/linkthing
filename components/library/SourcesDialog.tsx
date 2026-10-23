"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { LinkVaultDb } from "@/lib/db/schema";
import type { Source } from "@/lib/db/types";
import { ADAPTER_VERSIONS } from "@/lib/extract/adapters/versions";
import type { DateOrder, SourceKind } from "@/lib/extract/types";
import type { ReextractChoice } from "@/lib/import/reextract";
import {
  MAX_SOURCE_NAME,
  renameSource,
  SourceNameError,
} from "@/lib/library/sources";
import { strings } from "@/lib/strings";
import type { ExtractClient } from "@/lib/workers/client";

interface Props {
  db: LinkVaultDb; // renames, on the page
  connect: () => ExtractClient; // deletes, in the worker
  sources: readonly Source[]; // latest import first
  onDeleted: (sourceId: string) => void;
  onClose: () => void;
  // "Deleted “Notes” and 12 links." and the like, shown inside the dialog:
  // it's modal, so a notice outside would be inert and unheard.
  say: (text: string) => void;
  notice?: ReactNode;
  // Re-extract runs as an import does (the Importer's flow), so it closes
  // the dialog to show its progress; none while another job runs.
  onReextract?: (source: Source, choice: ReextractChoice) => void;
  jobRunning?: boolean;
}

// The adapters a source can be read with (§3); Phase 1.5 adds more.
const READERS: readonly SourceKind[] = ["whatsapp", "plaintext"];
const ORDERS: readonly DateOrder[] = ["DMY", "MDY", "YMD"];

const button =
  "rounded-md border border-current/40 px-2.5 py-1 text-sm font-medium aria-disabled:opacity-50";

type Editing =
  | { kind: "rename"; sourceId: string; error?: string }
  | { kind: "delete"; sourceId: string }
  | { kind: "deleting"; sourceId: string }
  | {
      kind: "reextract";
      sourceId: string;
      read: SourceKind;
      dateOrder: DateOrder;
    };

// Read by an adapter older than the current one, which may read it better.
function readByOlder(source: Source): boolean {
  const current = ADAPTER_VERSIONS[source.kind];
  return current !== undefined && source.adapterVersion < current;
}

function details(source: Source): string {
  const { stats, kind, importedAt, updatedAt } = source;
  const parts = [
    strings.sources.kind(kind),
    strings.sources.links(stats.links),
  ];
  if (stats.earliest !== undefined && stats.latest !== undefined) {
    parts.push(strings.dateRange(stats.earliest, stats.latest));
  }
  parts.push(strings.sources.imported(importedAt));
  if (updatedAt !== importedAt) parts.push(strings.sources.updated(updatedAt));
  if (readByOlder(source)) parts.push(strings.sources.newerReader);
  return parts.join(" · ");
}

// Every source, to rename, re-extract or delete (§6.4), in the browser's own
// <dialog>.
// Rename edits in place: Enter saves, Esc puts the name back without closing
// the dialog. Delete asks first, in place, and says how many links go; stars
// stay, keyed by the links' addresses. When a source leaves the list, focus
// goes to the heading rather than nowhere.
export function SourcesDialog({
  db,
  connect,
  sources,
  onDeleted,
  onClose,
  say,
  notice,
  onReextract,
  jobRunning = false,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState("");
  // Stored parts per source: a chat updated from several exports can only be
  // read as a chat, since only chat messages merge by key.
  const parts = useLiveQuery(async () => {
    const counts = new Map<string, number>();
    for (const id of await db.sourceParts.orderBy("sourceId").keys()) {
      counts.set(String(id), (counts.get(String(id)) ?? 0) + 1);
    }
    return counts;
  }, [db]);
  // Where focus goes once a rename or a delete question is put away: the
  // button that opened it, which comes back with the next render.
  const focusAfter = useRef<string | null>(null);
  const actionId = (sourceId: string, action: string) =>
    `${titleId}-${sourceId}-${action}`;

  // Another render can land first (a rename also updates the live sources),
  // while the button isn't drawn yet: keep the target until it is.
  useEffect(() => {
    if (!focusAfter.current) return;
    const target = document.getElementById(focusAfter.current);
    if (!target) return;
    target.focus();
    focusAfter.current = null;
  });

  function stopEditing(back?: { sourceId: string; action: string }) {
    if (back) focusAfter.current = actionId(back.sourceId, back.action);
    setEditing(null);
  }

  // Once, even when React runs effects twice in development.
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  function startRename(source: Source) {
    setDraft(source.name);
    setEditing({ kind: "rename", sourceId: source.id });
  }

  async function saveRename(source: Source) {
    try {
      await renameSource(db, source.id, draft);
      stopEditing({ sourceId: source.id, action: "rename" });
    } catch (error) {
      if (!(error instanceof SourceNameError)) throw error;
      setEditing({
        kind: "rename",
        sourceId: source.id,
        error:
          error.reason === "empty"
            ? strings.sources.nameEmpty
            : strings.sources.nameTooLong(MAX_SOURCE_NAME),
      });
    }
  }

  async function confirmDelete(source: Source) {
    setEditing({ kind: "deleting", sourceId: source.id });
    say(strings.sources.deleting(source.name));
    try {
      const { links } = await connect().deleteSource(source.id);
      say(strings.sources.deleted(source.name, links));
      onDeleted(source.id);
      setEditing(null);
      heading.current?.focus();
    } catch {
      say(strings.sources.deleteFailed(source.name));
      setEditing({ kind: "delete", sourceId: source.id });
    }
  }

  function startReextract(source: Source) {
    setEditing({
      kind: "reextract",
      sourceId: source.id,
      read: READERS.includes(source.kind) ? source.kind : "plaintext",
      dateOrder: source.options.dateOrder ?? "DMY",
    });
  }

  const busy = editing?.kind === "deleting";

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        // Esc while renaming or confirming backs out of that, not the dialog;
        // while deleting it waits.
        if (editing) {
          event.preventDefault();
          if (!busy) {
            stopEditing({
              sourceId: editing.sourceId,
              action: editing.kind,
            });
          }
        }
      }}
      className="m-auto max-h-[85dvh] w-[min(40rem,calc(100%-2rem))] rounded-lg border border-current/20 bg-background p-6 text-foreground backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4">
        <h2
          ref={heading}
          id={titleId}
          // Focus lands here on opening and after a delete: something to
          // read, not to act on, so no ring.
          tabIndex={-1}
          className="text-lg font-semibold focus:outline-none"
        >
          {strings.sources.title(sources.length)}
        </h2>
        <ul className="flex flex-col divide-y divide-current/15">
          {sources.map((source) => {
            const mine = editing?.sourceId === source.id ? editing : null;
            const errorId = `${titleId}-${source.id}-error`;
            return (
              <li key={source.id} className="flex flex-col gap-2 py-3">
                {mine?.kind === "rename" ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveRename(source);
                    }}
                  >
                    <input
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onFocus={(event) => event.target.select()}
                      aria-label={strings.sources.renameLabel(source.name)}
                      aria-invalid={mine.error !== undefined}
                      aria-describedby={mine.error ? errorId : undefined}
                      maxLength={MAX_SOURCE_NAME + 50}
                      className="min-w-48 flex-1 rounded-md border border-current/60 bg-transparent px-2 py-1"
                    />
                    <button type="submit" className={button}>
                      {strings.sources.save}
                    </button>
                    <button
                      type="button"
                      className={button}
                      onClick={() =>
                        stopEditing({ sourceId: source.id, action: "rename" })
                      }
                    >
                      {strings.sources.cancel}
                    </button>
                    {mine.error && (
                      <p id={errorId} role="alert" className="w-full text-sm">
                        {mine.error}
                      </p>
                    )}
                  </form>
                ) : (
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 font-medium break-words">
                      {source.name}
                    </span>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        id={actionId(source.id, "rename")}
                        className={button}
                        aria-disabled={busy}
                        onClick={() => !busy && startRename(source)}
                      >
                        {strings.sources.rename}
                      </button>
                      {onReextract && (
                        <button
                          type="button"
                          id={actionId(source.id, "reextract")}
                          className={button}
                          aria-disabled={busy || jobRunning}
                          onClick={() =>
                            !busy && !jobRunning && startReextract(source)
                          }
                        >
                          {strings.sources.reextract}
                        </button>
                      )}
                      <button
                        type="button"
                        id={actionId(source.id, "delete")}
                        className={button}
                        aria-disabled={busy}
                        onClick={() =>
                          !busy &&
                          setEditing({ kind: "delete", sourceId: source.id })
                        }
                      >
                        {strings.sources.delete}
                      </button>
                    </span>
                  </div>
                )}
                <p className="text-sm text-foreground/65">{details(source)}</p>
                {mine?.kind === "reextract" && onReextract && (
                  <form
                    aria-label={strings.sources.reextract}
                    className="flex flex-col gap-3 rounded-md border border-current/30 p-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onReextract(source, {
                        kind: mine.read,
                        ...(mine.read === "whatsapp"
                          ? { dateOrder: mine.dateOrder }
                          : {}),
                      });
                      dialog.current?.close();
                    }}
                  >
                    <fieldset className="flex flex-col gap-1">
                      <legend className="mb-1 font-medium">
                        {strings.sources.readAs}
                      </legend>
                      {READERS.map((reader) => {
                        const onlyChat =
                          (parts?.get(source.id) ?? 1) > 1 &&
                          reader !== "whatsapp";
                        return (
                          <label
                            key={reader}
                            className="flex items-start gap-2"
                          >
                            <input
                              type="radio"
                              name={`${titleId}-${source.id}-read`}
                              checked={mine.read === reader}
                              disabled={onlyChat}
                              onChange={() =>
                                setEditing({ ...mine, read: reader })
                              }
                              className="mt-1.5"
                            />
                            <span className={onlyChat ? "opacity-60" : ""}>
                              {strings.dialog.readAs(reader)}
                              {onlyChat && (
                                <span className="block text-sm">
                                  {strings.sources.onlyAsChat}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>
                    {mine.read === "whatsapp" && (
                      <fieldset className="flex flex-col gap-1">
                        <legend className="mb-1 font-medium">
                          {strings.sources.datesAre}
                        </legend>
                        {ORDERS.filter(
                          (order) =>
                            order !== "YMD" ||
                            source.options.dateOrder === "YMD",
                        ).map((order) => (
                          <label
                            key={order}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="radio"
                              name={`${titleId}-${source.id}-dates`}
                              checked={mine.dateOrder === order}
                              onChange={() =>
                                setEditing({ ...mine, dateOrder: order })
                              }
                            />
                            {strings.sources.order(order)}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <p className="text-sm">{strings.sources.reextractNote}</p>
                    <div className="flex gap-2">
                      <button type="submit" autoFocus className={button}>
                        {strings.sources.reextract}
                      </button>
                      <button
                        type="button"
                        className={button}
                        onClick={() =>
                          stopEditing({
                            sourceId: source.id,
                            action: "reextract",
                          })
                        }
                      >
                        {strings.sources.cancel}
                      </button>
                    </div>
                  </form>
                )}
                {(mine?.kind === "delete" || mine?.kind === "deleting") && (
                  <div
                    role="group"
                    aria-label={strings.sources.delete}
                    className="flex flex-col gap-2 rounded-md border border-current/30 p-3"
                  >
                    <p>
                      {strings.sources.confirmDelete(
                        source.name,
                        source.stats.links,
                      )}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        autoFocus
                        className={button}
                        aria-disabled={busy}
                        onClick={() => !busy && void confirmDelete(source)}
                      >
                        {busy
                          ? strings.sources.deleting(source.name)
                          : strings.sources.delete}
                      </button>
                      <button
                        type="button"
                        className={button}
                        aria-disabled={busy}
                        onClick={() =>
                          !busy &&
                          stopEditing({ sourceId: source.id, action: "delete" })
                        }
                      >
                        {strings.sources.keep}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end">
          <button
            type="button"
            className={button}
            aria-disabled={busy}
            onClick={() => !busy && dialog.current?.close()}
          >
            {strings.close}
          </button>
        </div>
      </div>
      {notice}
    </dialog>
  );
}
