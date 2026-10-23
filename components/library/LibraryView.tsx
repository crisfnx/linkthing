"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  use,
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ImportFlowContext } from "@/components/import/ImportFlow";
import type { LinkVaultDb } from "@/lib/db/schema";
import type { Source } from "@/lib/db/types";
import type { Link } from "@/lib/extract/types";
import { starredKeys, toggleStar } from "@/lib/library/details";
import { starredFlags, textAt, type LibraryRows } from "@/lib/library/rows";
import {
  onlyTextDiffers,
  queryFromSearch,
  searchFromQuery,
} from "@/lib/query/url";
import {
  buildView,
  EMPTY_QUERY,
  SORTS,
  type Query,
  type Sort,
} from "@/lib/query/view";
import { strings } from "@/lib/strings";
import type { ExtractClient } from "@/lib/workers/client";
import { DetailsDrawer } from "./DetailsDrawer";
import { FacetPanel } from "./FacetPanel";
import { LinkList } from "./LinkList";
import { SourcesDialog } from "./SourcesDialog";

interface Props {
  db: LinkVaultDb; // the page's connection: full links by id, and stars
  rows: LibraryRows;
  sourceNames: ReadonlyMap<string, string>;
  sources: readonly Source[]; // for the Sources dialog
  connect: () => ExtractClient; // the page's worker: deletes run there
  dedupeByDefault?: boolean; // Settings → "Collapse duplicates"
}

const control =
  "rounded-md border border-current/40 bg-transparent px-2 py-1.5";

// One empty set, not a new one per render: the view is worked out again
// only when its inputs change, and a fresh set would count as a change, so
// every render (a notice, the sources table) would redo all the rows.
const NO_KEYS: ReadonlySet<number> = new Set();
const NO_STARS: readonly string[] = [];

// The view with nothing chosen, as Settings has it: what the address leaves
// out (§6.3). One object each, for the same reason as NO_KEYS.
const COLLAPSED: Query = { ...EMPTY_QUERY, dedupe: true };
const baseQuery = (dedupe: boolean) => (dedupe ? COLLAPSED : EMPTY_QUERY);

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
export function LibraryView({
  db,
  rows,
  sourceNames,
  sources,
  connect,
  dedupeByDefault = false,
}: Props) {
  const base = baseQuery(dedupeByDefault);
  // The view lives in the address (§6.3): read once here, written back below.
  const [query, setQuery] = useState<Query>(() =>
    queryFromSearch(window.location.search, base),
  );
  // A new default in Settings applies to the view on screen too.
  const [defaultShown, setDefaultShown] = useState(dedupeByDefault);
  if (defaultShown !== dedupeByDefault) {
    setDefaultShown(dedupeByDefault);
    setQuery({ ...query, dedupe: dedupeByDefault });
  }
  const inAddress = useRef(query);
  const text = useDeferredValue(query.text);
  // Opened groups of copies, for these rows; a new read starts closed.
  const [open, setOpen] = useState<{
    rows: LibraryRows;
    keys: ReadonlySet<number>;
  }>({ rows, keys: new Set() });
  const openKeys = open.rows === rows ? open.keys : NO_KEYS;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // Re-extract runs through the Importer's flow, with its progress and cancel.
  const flow = use(ImportFlowContext);
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
  // Stars live in the small annotations table, so they're a live query; a
  // star from the drawer or with s marks its row at once.
  const stars = useLiveQuery(() => starredKeys(db), [db]) ?? NO_STARS;
  const starred = starredFlags(rows, stars);

  const view = buildView(rows, { ...query, text }, openKeys, starred);
  const chosen =
    query.sites.length +
    query.kinds.length +
    query.senders.length +
    query.sources.length +
    query.dates.length +
    (query.starred ? 1 : 0);
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

  // Typing replaces the history entry, so Back doesn't step through letters;
  // a filter, sort or duplicates change adds one, so Back undoes it. Next.js
  // follows pushState and replaceState (it patches them). A view the address
  // already says, as after a new default, adds nothing.
  useEffect(() => {
    const search = searchFromQuery(query, base);
    if (search === new URLSearchParams(location.search).toString()) {
      inAddress.current = query;
      return;
    }
    const url = `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
    if (onlyTextDiffers(inAddress.current, query)) {
      history.replaceState(null, "", url);
    } else {
      history.pushState(null, "", url);
    }
    inAddress.current = query;
  }, [query, base]);

  // Back and Forward: the view the address now holds.
  useEffect(() => {
    function onPopState() {
      const next = queryFromSearch(location.search, base);
      inAddress.current = next;
      setQuery(next);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [base]);

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
      hasStars={stars.length > 0}
      onChange={(group, values) => setQuery({ ...query, [group]: values })}
      onStarredChange={(on) => setQuery({ ...query, starred: on })}
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
        <button
          type="button"
          className={control}
          onClick={() => setSourcesOpen(true)}
        >
          {strings.sources.button}
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
              starred={starred}
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
      {sourcesOpen && (
        <SourcesDialog
          db={db}
          connect={connect}
          sources={[...sources].sort((a, b) => b.importedAt - a.importedAt)}
          onDeleted={(sourceId) =>
            // A filter on a source that's gone would show nothing.
            setQuery((current) =>
              current.sources.includes(sourceId)
                ? {
                    ...current,
                    sources: current.sources.filter((id) => id !== sourceId),
                  }
                : current,
            )
          }
          onClose={() => setSourcesOpen(false)}
          say={say}
          notice={said}
          onReextract={
            flow
              ? (source, choice) => flow.reextract([source], choice)
              : undefined
          }
          jobRunning={flow?.busy}
        />
      )}
      {detailsRow === null && !sourcesOpen && said}

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
