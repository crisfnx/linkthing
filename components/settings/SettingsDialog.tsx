"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { use, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ImportFlowContext } from "@/components/import/ImportFlow";
import type { LinkVaultDb } from "@/lib/db/schema";
import type { Source } from "@/lib/db/types";
import { bareLinksBySource, type LibraryRows } from "@/lib/library/rows";
import { deleteEverything } from "@/lib/library/sources";
import { saveSettings, THEMES, type UserSettings } from "@/lib/settings";
import {
  askToPersist,
  isPersisted,
  storageUse,
  type StorageUse,
} from "@/lib/storage";
import { strings } from "@/lib/strings";

interface Props {
  db: LinkVaultDb;
  settings: UserSettings;
  sources: readonly Source[];
  rows: LibraryRows | null; // to count bare links; null until read
  onClose: () => void;
}

const button =
  "rounded-md border border-current/40 px-2.5 py-1 text-sm font-medium aria-disabled:opacity-50";

const ORDERS = ["DMY", "MDY"] as const;

type Confirming = "bare" | "delete" | "deleting" | null;

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

// Settings (§6.7) in the browser's own <dialog>. Each choice is saved as it's
// made. Two ask first, in place, as Sources' delete does: turning "Find bare
// domains" off or on reads the sources again (the import flow's re-extract,
// so the dialog closes to show its progress), and "Delete everything".
export function SettingsDialog({
  db,
  settings,
  sources,
  rows,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bareNoteId = useId();
  const flow = use(ImportFlowContext);
  const busy = flow?.busy ?? false;
  // Shown as chosen at once; the live settings catch up a moment later.
  const [chosen, setChosen] = useState(settings);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [failed, setFailed] = useState(false);
  const [storage, setStorage] = useState<{
    use?: StorageUse;
    persisted?: boolean;
    refused?: boolean;
  }>({});
  const stars = useLiveQuery(
    () => db.annotations.where("starred").equals(1).count(),
    [db],
  );
  // Where focus goes when a question is put away: the control that asked it.
  const focusAfter = useRef<string | null>(null);
  const bareId = `${titleId}-bare`;
  const deleteId = `${titleId}-delete`;

  const bare = rows ? bareLinksBySource(rows) : new Map<string, number>();
  const bareLinks = [...bare.values()].reduce((sum, n) => sum + n, 0);
  const links = sources.reduce((sum, source) => sum + source.stats.links, 0);

  // Once, even when React runs effects twice in development.
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.all([storageUse(), isPersisted()]).then(([use, persisted]) => {
      if (current) setStorage({ use, persisted });
    });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!focusAfter.current) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  function change(next: Partial<UserSettings>) {
    setChosen({ ...chosen, ...next });
    void saveSettings(db, next);
  }

  function backOut(to: string) {
    focusAfter.current = to;
    setConfirming(null);
  }

  // Turning it off with nothing found that way changes no link: no question.
  function toggleBare() {
    if (busy) return;
    if (chosen.findBareDomains && bareLinks === 0) {
      change({ findBareDomains: false });
    } else {
      setConfirming("bare");
    }
  }

  async function confirmBare() {
    const findBareDomains = !chosen.findBareDomains;
    await saveSettings(db, { findBareDomains });
    setChosen({ ...chosen, findBareDomains });
    // Off: only the sources with bare links change. On: any source may have
    // some.
    const reread = findBareDomains
      ? sources
      : sources.filter((source) => bare.has(source.id));
    if (flow && reread.length > 0) {
      setConfirming(null);
      flow.reextract(reread, {});
      dialog.current?.close();
    } else {
      backOut(bareId);
    }
  }

  async function confirmDelete() {
    setConfirming("deleting");
    setFailed(false);
    try {
      // The library empties and the first screen takes the page, this
      // dialog with it.
      await deleteEverything(db);
    } catch {
      setFailed(true);
      setConfirming("delete");
    }
  }

  async function keepData() {
    const persisted = await askToPersist();
    setStorage({ ...storage, persisted, refused: persisted === false });
  }

  const deleting = confirming === "deleting";

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        // Esc backs out of a question, not the dialog; while deleting it
        // waits.
        if (!confirming) return;
        event.preventDefault();
        if (confirming === "bare") backOut(bareId);
        else if (confirming === "delete") backOut(deleteId);
      }}
      className="m-auto max-h-[85dvh] w-[min(36rem,calc(100%-2rem))] rounded-lg border border-current/20 bg-background p-6 text-foreground backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-6">
        <h2
          id={titleId}
          // Focus lands here on opening: something to read, so no ring.
          tabIndex={-1}
          className="text-lg font-semibold focus:outline-none"
        >
          {strings.settings.title}
        </h2>

        <Section title={strings.settings.appearance}>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1">{strings.settings.theme}</legend>
            {THEMES.map((theme) => (
              <label key={theme} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${titleId}-theme`}
                  checked={chosen.theme === theme}
                  onChange={() => change({ theme })}
                />
                {strings.settings.themes[theme]}
              </label>
            ))}
          </fieldset>
        </Section>

        <Section title={strings.settings.importing}>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1">{strings.settings.dateOrder}</legend>
            {ORDERS.map((order) => (
              <label key={order} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${titleId}-dates`}
                  checked={chosen.defaultDateOrder === order}
                  onChange={() => change({ defaultDateOrder: order })}
                />
                {strings.settings.order(order)}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2">
              <input
                id={bareId}
                type="checkbox"
                checked={chosen.findBareDomains}
                aria-disabled={busy}
                aria-describedby={bareNoteId}
                onChange={toggleBare}
              />
              {strings.settings.bareDomains}
            </label>
            <p id={bareNoteId} className="ml-6 text-sm text-foreground/65">
              {busy
                ? strings.settings.waitForImport
                : strings.settings.bareNote(bareLinks)}
            </p>
          </div>
          {confirming === "bare" && (
            <div
              role="group"
              aria-label={strings.settings.bareDomains}
              className="flex flex-col gap-2 rounded-md border border-current/30 p-3"
            >
              <p>
                {chosen.findBareDomains
                  ? strings.settings.bareOff(bareLinks, bare.size)
                  : strings.settings.bareOn(sources.length)}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  autoFocus
                  className={button}
                  onClick={() => void confirmBare()}
                >
                  {chosen.findBareDomains
                    ? strings.settings.turnOff
                    : strings.settings.turnOn}
                </button>
                <button
                  type="button"
                  className={button}
                  onClick={() => backOut(bareId)}
                >
                  {strings.settings.cancel}
                </button>
              </div>
            </div>
          )}
        </Section>

        <Section title={strings.settings.list}>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={chosen.dedupeByDefault}
              onChange={(event) =>
                change({ dedupeByDefault: event.target.checked })
              }
            />
            {strings.settings.dedupe}
          </label>
        </Section>

        <Section title={strings.settings.storage}>
          <p>{strings.settings.local}</p>
          <p>
            {storage.use
              ? strings.settings.using(storage.use.usage, storage.use.quota)
              : strings.settings.usageUnknown}{" "}
            {storage.persisted
              ? strings.settings.kept
              : storage.persisted === false
                ? strings.settings.notKept
                : null}
          </p>
          {storage.persisted === false && (
            <div className="flex flex-col items-start gap-1">
              <button
                type="button"
                className={button}
                onClick={() => void keepData()}
              >
                {strings.settings.askToKeep}
              </button>
              {storage.refused && (
                <p role="status" className="text-sm">
                  {strings.settings.refused}
                </p>
              )}
            </div>
          )}
        </Section>

        <Section title={strings.settings.deleteEverything}>
          <p className="text-sm">{strings.settings.deleteNote}</p>
          {confirming === "delete" || deleting ? (
            <div
              role="group"
              aria-label={strings.settings.deleteEverything}
              className="flex flex-col gap-2 rounded-md border border-current/30 p-3"
            >
              <p>
                {strings.settings.confirmDelete(
                  sources.length,
                  links,
                  stars ?? 0,
                )}
              </p>
              {failed && <p role="alert">{strings.settings.deleteFailed}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  autoFocus
                  className={button}
                  aria-disabled={deleting}
                  onClick={() => !deleting && void confirmDelete()}
                >
                  {deleting
                    ? strings.settings.deleting
                    : strings.settings.deleteEverything}
                </button>
                <button
                  type="button"
                  className={button}
                  aria-disabled={deleting}
                  onClick={() => !deleting && backOut(deleteId)}
                >
                  {strings.settings.keep}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-1">
              <button
                type="button"
                id={deleteId}
                className={button}
                aria-disabled={busy}
                onClick={() => !busy && setConfirming("delete")}
              >
                {strings.settings.deleteEverything}
              </button>
              {busy && (
                <p className="text-sm text-foreground/65">
                  {strings.settings.waitForImport}
                </p>
              )}
            </div>
          )}
        </Section>

        <div className="flex justify-end">
          <button
            type="button"
            className={button}
            aria-disabled={deleting}
            onClick={() => !deleting && dialog.current?.close()}
          >
            {strings.settings.close}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// The header's Settings button and the dialog it opens.
export function SettingsButton(props: Omit<Props, "onClose">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="rounded-md border border-current px-3 py-1.5 font-medium"
        onClick={() => setOpen(true)}
      >
        {strings.settings.button}
      </button>
      {open && <SettingsDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
