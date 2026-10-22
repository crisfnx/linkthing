"use client";

import { useDeferredValue, useEffect, useId, useRef, useState } from "react";
import type { LibraryRows } from "@/lib/library/rows";
import {
  buildView,
  EMPTY_QUERY,
  SORTS,
  type Query,
  type Sort,
} from "@/lib/query/view";
import { strings } from "@/lib/strings";
import { FacetPanel } from "./FacetPanel";
import { LinkList } from "./LinkList";

interface Props {
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
export function LibraryView({ rows, sourceNames }: Props) {
  const [query, setQuery] = useState<Query>(EMPTY_QUERY);
  const text = useDeferredValue(query.text);
  // Opened groups of copies, for these rows; a new read starts closed.
  const [open, setOpen] = useState<{
    rows: LibraryRows;
    keys: ReadonlySet<number>;
  }>({ rows, keys: new Set() });
  const openKeys = open.rows === rows ? open.keys : new Set<number>();
  const [filtersOpen, setFiltersOpen] = useState(false);
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
