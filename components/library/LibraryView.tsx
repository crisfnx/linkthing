"use client";

import { useDeferredValue, useEffect, useId, useRef, useState } from "react";
import type { LinkVaultDb } from "@/lib/db/schema";
import type { Link } from "@/lib/extract/types";
import { toggleStar } from "@/lib/library/details";
import { textAt, type LibraryRows } from "@/lib/library/rows";
import {
  buildView,
  EMPTY_QUERY,
  SORTS,
  type Query,
  type Sort,
} from "@/lib/query/view";
import { strings } from "@/lib/strings";
import { DetailsDrawer } from "./DetailsDrawer";
import { FacetPanel } from "./FacetPanel";
import { LinkList } from "./LinkList";

interface Props {
  db: LinkVaultDb; // the page's connection: full links by id, and stars
  rows: LibraryRows;
  sourceNames: ReadonlyMap<string, string>;
}

const control =
  "rounded-md border border-current/40 bg-transparent px-2 py-1.5";

// Typing in these doesn't jump to the search box.
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

// Search, sort, duplicates and filters over the list (§6.3). The search text
// is deferred: the box takes every keystroke at once and the list follows as
// soon as it can, which at 50 k links is the next frame or two (§8.6).
export function LibraryView({ db, rows, sourceNames }: Props) {
  const [query, setQuery] = useState<Query>(EMPTY_QUERY);
  const text = useDeferredValue(query.text);
  // Opened groups of copies, for these rows; a new read starts closed.
  const [open, setOpen] = useState<{
    rows: LibraryRows;
    keys: ReadonlySet<number>;
  }>({ rows, keys: new Set() });
  const openKeys = open.rows === rows ? open.keys : new Set<number>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The link whose details are open, kept with the rows it belongs to.
  const [details, setDetails] = useState<{
    rows: LibraryRows;
    row: number;
  } | null>(null);
  const detailsRow = details?.rows === rows ? details.row : null;
  // "Link copied." and the like, said for a moment, then gone.
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(
    null,
  );
  const search = useRef<HTMLInputElement>(null);
  const filtersDialog = useRef<HTMLDialogElement>(null);
  const filtersTitle = useId();

  const view = buildView(rows, { ...query, text }, openKeys);
  const chosen =
    query.sites.length +
    query.kinds.length +
    query.senders.length +
    query.sources.length +
    query.dates.length;
  const narrowed = chosen > 0 || text.trim() !== "";
  // A new search, filter or sort starts the list at the top.
  const listKey = JSON.stringify({ ...query, text });

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const say = (text: string) => setNotice({ text, at: Date.now() });
  const said = notice && (
    <p
      key={notice.at}
      role="status"
      className="fixed bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-sm text-background"
    >
      {notice.text}
    </p>
  );

  // The canonical URL: cleaned of tracking, so that is what's opened and
  // copied (§4.4). noopener: the page opened can't reach back into this one.
  function openLink(row: number) {
    window.open(textAt(rows.urls, row), "_blank", "noopener,noreferrer");
  }

  function copy(row: number) {
    navigator.clipboard.writeText(textAt(rows.urls, row)).then(
      () => say(strings.copied),
      () => say(strings.copyFailed),
    );
  }

  async function star(link: Link) {
    const starred = await toggleStar(db, link);
    say(starred ? strings.starredNotice : strings.unstarredNotice);
  }

  // From the list, which has the row but not the link's urlKey.
  async function starRow(row: number) {
    const link = await db.links.get(textAt(rows.ids, row));
    if (link) await star(link);
  }

  // "/" goes to the search box (§7, Keyboard).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTyping(event.target)) return;
      event.preventDefault();
      search.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The filters dialog on narrow screens: the browser's own <dialog>.
  useEffect(() => {
    const dialog = filtersDialog.current;
    if (filtersOpen && dialog && !dialog.open) dialog.showModal();
  }, [filtersOpen]);

  const facets = (
    <FacetPanel
      facets={view.facets}
      query={query}
      sourceNames={sourceNames}
      onChange={(group, values) => setQuery({ ...query, [group]: values })}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <input
          ref={search}
          type="search"
          value={query.text}
          onChange={(event) => setQuery({ ...query, text: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query.text !== "") {
              event.preventDefault();
              setQuery({ ...query, text: "" });
            }
          }}
          aria-label={strings.searchLabel}
          placeholder={strings.searchLabel}
          aria-keyshortcuts="/"
          className={`${control} min-w-48 flex-1 sm:max-w-md`}
        />
        <label className="flex items-center gap-2">
          <span className="sr-only sm:not-sr-only">{strings.sortLabel}</span>
          <select
            value={query.sort}
            onChange={(event) =>
              setQuery({ ...query, sort: event.target.value as Sort })
            }
            className={control}
          >
            {SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {strings.sorts[sort]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={query.dedupe}
            onChange={(event) =>
              setQuery({ ...query, dedupe: event.target.checked })
            }
          />
          {strings.dedupe}
        </label>
        <button
          type="button"
          className={`${control} md:hidden`}
          onClick={() => setFiltersOpen(true)}
        >
          {chosen > 0 ? strings.filtersOn(chosen) : strings.filters}
        </button>
      </div>
      <p role="status" className="px-4 py-2 text-sm text-foreground/65">
        {strings.showing(view.matching, rows.count, view.unique)}
      </p>

      <div className="flex min-h-0 flex-1 border-t border-current/15">
        <aside
          aria-label={strings.filters}
          className="hidden w-64 shrink-0 overflow-y-auto border-r border-current/15 p-4 md:block"
        >
          {facets}
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {view.order.length > 0 ? (
            <LinkList
              key={listKey}
              rows={rows}
              order={view.order}
              copies={view.copies}
              openKeys={openKeys}
              onToggleCopies={(key) => {
                const keys = new Set(openKeys);
                if (!keys.delete(key)) keys.add(key);
                setOpen({ rows, keys });
              }}
              sourceNames={sourceNames}
              onOpen={(row) => setDetails({ rows, row })}
              onOpenLink={openLink}
              onCopy={copy}
              onStar={(row) => void starRow(row)}
            />
          ) : (
            <div className="flex flex-col items-start gap-3 p-4">
              <p>{strings.noMatches}</p>
              {narrowed && (
                <button
                  type="button"
                  className={control}
                  onClick={() =>
                    setQuery({
                      ...EMPTY_QUERY,
                      sort: query.sort,
                      dedupe: query.dedupe,
                    })
                  }
                >
                  {strings.clearAll}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {detailsRow !== null && (
        <DetailsDrawer
          key={detailsRow}
          db={db}
          rows={rows}
          row={detailsRow}
          sourceNames={sourceNames}
          onClose={() => setDetails(null)}
          onOpenLink={openLink}
          onCopy={copy}
          onStar={(link) => void star(link)}
          notice={said}
        />
      )}
      {detailsRow === null && said}

      {filtersOpen && (
        <dialog
          ref={filtersDialog}
          aria-labelledby={filtersTitle}
          onClose={() => setFiltersOpen(false)}
          className="m-auto max-h-[85dvh] w-[min(28rem,calc(100%-2rem))] rounded-lg border border-current/20 bg-background p-6 text-foreground backdrop:bg-black/50"
        >
          <div className="flex flex-col gap-6">
            <h2 id={filtersTitle} className="text-lg font-semibold">
              {strings.filters}
            </h2>
            {facets}
            <button
              type="button"
              className={`${control} self-end`}
              onClick={() => filtersDialog.current?.close()}
            >
              {strings.done}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
