"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState, type KeyboardEvent, type Ref } from "react";
import { kindAt, textAt, type LibraryRows } from "@/lib/library/rows";
import { displayUrl } from "@/lib/preview/display-url";
import { strings } from "@/lib/strings";
import { KindIcon } from "./KindIcon";

// Fixed, so the list never measures a row: two lines of text and padding.
const ROW_HEIGHT = 60;

// A site's badge colour, the same for every link to it. OKLCH keeps the
// lightness equal across hues, so white letters read on all of them.
function siteColor(domain: string): string {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = (hash * 31 + domain.charCodeAt(i)) >>> 0;
  }
  return `oklch(0.5 0.12 ${hash % 360})`;
}

interface RowProps {
  rows: LibraryRows;
  row: number; // in rows
  position: number; // in the list
  count: number; // rows in the list
  start: number;
  active: boolean;
  showSender: boolean;
  sourceName?: string;
  // With duplicates collapsed: how many times this link was shared (1 when
  // once), or 0 for a copy shown under an expanded one.
  copies?: number;
  open: boolean;
  linkRef?: Ref<HTMLAnchorElement>;
  onActivate: (position: number) => void;
  onToggleCopies: (row: number) => void;
}

// One link: a site badge (favicons arrive with M7), the title, or the URL
// when there's none, then the kind, URL, sender and source, and the date.
// A link shared more than once shows how often; its copies sit indented
// under it when opened. Compiled as usual, so rows that stay on screen don't
// redraw on scroll.
function LinkRow({
  rows,
  row,
  position,
  count,
  start,
  active,
  showSender,
  sourceName,
  copies,
  open,
  linkRef,
  onActivate,
  onToggleCopies,
}: RowProps) {
  const url = textAt(rows.urls, row);
  const shown = displayUrl(url);
  const title = textAt(rows.titles, row);
  const domain = rows.domainNames[rows.domains[row]!]!;
  const kind = kindAt(rows, row);
  const time = rows.timestamps[row]!;
  const sender = showSender ? rows.senderNames[rows.senders[row]!] : "";
  const details = [title ? shown : domain, sender, sourceName]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      role="listitem"
      aria-posinset={position + 1}
      aria-setsize={count}
      className={`absolute inset-x-0 top-0 flex items-center gap-3 pr-4 hover:bg-current/5 has-focus-visible:bg-current/10 ${copies === 0 ? "pl-15" : "pl-4"}`}
      style={{ height: ROW_HEIGHT, transform: `translateY(${start}px)` }}
    >
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-md text-sm font-semibold text-white"
        style={{ backgroundColor: siteColor(domain) }}
      >
        {domain.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <a
          ref={linkRef}
          href={/^https?:\/\//i.test(url) ? url : undefined}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={active ? 0 : -1}
          onFocus={() => onActivate(position)}
          className="block truncate rounded-sm font-medium hover:underline"
        >
          {title || shown}
          <span className="sr-only">, {strings.opensInNewTab}</span>
        </a>
        <p className="flex items-center gap-1.5 text-sm text-foreground/65">
          <KindIcon kind={kind} className="size-3.5 shrink-0" />
          <span className="sr-only">{strings.kindNames[kind]}: </span>
          <span className="truncate">{details}</span>
        </p>
      </div>
      {copies !== undefined && copies > 1 && (
        <button
          type="button"
          tabIndex={active ? 0 : -1}
          aria-expanded={open}
          aria-label={strings.copiesLabel(copies, open)}
          onFocus={() => onActivate(position)}
          onClick={() => onToggleCopies(row)}
          className="shrink-0 rounded-full border border-current/30 px-2 text-sm tabular-nums"
        >
          {strings.copies(copies)}
        </button>
      )}
      {!Number.isNaN(time) && (
        <time
          dateTime={new Date(time).toISOString()}
          title={strings.linkDateAndTime(time)}
          className="shrink-0 text-sm text-foreground/65 tabular-nums"
        >
          {strings.linkDate(time)}
        </time>
      )}
    </div>
  );
}

interface Props {
  rows: LibraryRows;
  order: Uint32Array; // the rows to show, in order (lib/query/view.ts)
  copies: Uint32Array | null; // per shown row, with duplicates collapsed
  openKeys: ReadonlySet<number>; // keys whose copies are shown
  onToggleCopies: (key: number) => void;
  sourceNames: ReadonlyMap<string, string>;
}

// The list view (§6.2): only the rows on screen are drawn, so 50 k links
// scroll like 50. One row at a time is in the tab order; j/k or the arrow
// keys move between rows, Home/End and Page Up/Down jump (§7, Keyboard).
export function LinkList({
  rows,
  order,
  copies,
  openKeys,
  onToggleCopies,
  sourceNames,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  // useVirtualizer returns functions the React Compiler can't memoize without
  // stale rows (§8.1), so the compiler leaves this component as written, as
  // it should; LinkRow is still compiled.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  const count = order.length;
  const [active, setActive] = useState(0);
  const current = Math.min(active, count - 1);
  // Set by a key press, so the row it moved to takes focus once drawn.
  const focusNext = useRef(false);

  function move(to: number) {
    const next = Math.max(0, Math.min(count - 1, to));
    focusNext.current = true;
    setActive(next);
    virtualizer.scrollToIndex(next, { align: "auto" });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const visible = (scroller.current?.clientHeight ?? 0) / ROW_HEIGHT;
    const page = Math.max(1, Math.floor(visible) - 1);
    const targets: Record<string, number> = {
      j: current + 1,
      ArrowDown: current + 1,
      k: current - 1,
      ArrowUp: current - 1,
      Home: 0,
      End: count - 1,
      PageDown: current + page,
      PageUp: current - page,
    };
    const to = targets[event.key];
    if (to === undefined) return;
    event.preventDefault();
    move(to);
  }

  // Senders and sources only tell rows apart when there's more than one.
  const showSender = rows.senderNames.length > 2; // "" (none) and two names
  const showSource = rows.sourceIds.length > 1;

  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto"
      onKeyDown={onKeyDown}
    >
      <div
        role="list"
        aria-label={strings.linksLabel}
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map(({ index, start }) => {
          const row = order[index]!;
          return (
            <LinkRow
              key={row}
              rows={rows}
              row={row}
              position={index}
              count={count}
              start={start}
              active={index === current}
              showSender={showSender}
              sourceName={
                showSource
                  ? sourceNames.get(rows.sourceIds[rows.sources[row]!]!)
                  : undefined
              }
              copies={copies?.[index]}
              open={openKeys.has(rows.keys[row]!)}
              linkRef={
                index === current
                  ? (link) => {
                      if (link && focusNext.current) {
                        focusNext.current = false;
                        link.focus({ preventScroll: true });
                      }
                    }
                  : undefined
              }
              onActivate={setActive}
              onToggleCopies={(r) => onToggleCopies(rows.keys[r]!)}
            />
          );
        })}
      </div>
    </div>
  );
}
