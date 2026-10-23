"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState, type KeyboardEvent, type Ref } from "react";
import { kindAt, textAt, type LibraryRows } from "@/lib/library/rows";
import { displayUrl } from "@/lib/preview/display-url";
import { strings } from "@/lib/strings";
import { KindIcon } from "./KindIcon";

// Fixed, so the list never measures a row: two lines of text (20 and 16 px)
// and 14 px between rows, the owner's choice between the first 60 px and a
// tighter 40; other densities and cards come as views (§6.2).
const ROW_HEIGHT = 50;

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
  starred: boolean;
  selected: boolean;
  selecting: boolean; // something is selected: every row shows its checkbox
  linkRef?: Ref<HTMLAnchorElement>;
  onActivate: (position: number) => void;
  onSelect: (position: number, range: boolean) => void;
  onToggleCopies: (row: number) => void;
  onOpen: (row: number) => void; // the details drawer
}

// One link: a site badge (favicons arrive with M7), the title, or the URL
// when there's none, then the kind, URL, sender and source, a star when
// it's starred, and the date. A link shared more than once shows how often;
// its copies sit indented under it when opened. The badge gives way to a
// checkbox when the row is pointed at or focused, and on every row once
// something is selected. Compiled as usual, so rows that stay on screen don't
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
  starred,
  selected,
  selecting,
  linkRef,
  onActivate,
  onSelect,
  onToggleCopies,
  onOpen,
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
      className={`group absolute inset-x-0 top-0 flex items-center gap-2.5 pr-4 hover:bg-current/5 has-focus-visible:bg-current/10 ${selected ? "bg-current/10" : ""} ${copies === 0 ? "pl-12.5" : "pl-4"}`}
      style={{ height: ROW_HEIGHT, transform: `translateY(${start}px)` }}
    >
      <span className="grid size-6 shrink-0 place-items-center">
        <span
          aria-hidden
          className={`size-6 place-items-center rounded text-xs font-semibold text-white ${selecting ? "hidden" : "grid group-hover:hidden group-has-focus-visible:hidden"}`}
          style={{ backgroundColor: siteColor(domain) }}
        >
          {domain.charAt(0).toUpperCase()}
        </span>
        <input
          type="checkbox"
          checked={selected}
          tabIndex={active ? 0 : -1}
          aria-label={strings.selection.select(title || shown)}
          onFocus={() => onActivate(position)}
          // The click behind it carries Shift, for a range (§6.5).
          onChange={(event) =>
            onSelect(position, (event.nativeEvent as MouseEvent).shiftKey)
          }
          // Above the stretched link, so it stays its own control.
          className={`relative z-10 size-4 ${selecting ? "" : "hidden group-hover:block group-has-focus-visible:block"}`}
        />
      </span>
      <div className="min-w-0 flex-1">
        <a
          ref={linkRef}
          href={/^https?:\/\//i.test(url) ? url : undefined}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={active ? 0 : -1}
          aria-haspopup="dialog"
          onFocus={() => onActivate(position)}
          onClick={(event) => {
            // A plain click or Enter opens the details; with a modifier or
            // the middle button it stays a link, opening a new tab (§6.2).
            const plain = !(
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            );
            if (event.button !== 0 || !plain) return;
            event.preventDefault();
            onOpen(row);
          }}
          // Stretched over the whole row, so the row is the target: the
          // link alone would be 20 px tall, under WCAG's 24 px (2.5.8).
          className="block truncate rounded-sm text-sm leading-5 font-medium after:absolute after:inset-0 hover:underline"
        >
          {title || shown}
        </a>
        <p className="flex items-center gap-1 text-xs leading-4 text-foreground/65">
          <KindIcon kind={kind} className="size-3 shrink-0" />
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
          // Above the stretched link, so it stays its own button.
          className="relative z-10 shrink-0 rounded-full border border-current/30 px-2 text-xs tabular-nums"
        >
          {strings.copies(copies)}
        </button>
      )}
      {starred && (
        <span className="shrink-0 text-sm leading-none">
          <span aria-hidden>★</span>
          <span className="sr-only">{strings.details.starred}</span>
        </span>
      )}
      {!Number.isNaN(time) && (
        <time
          dateTime={new Date(time).toISOString()}
          className="shrink-0 text-xs text-foreground/65 tabular-nums"
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
  starred: Uint8Array | null; // per key (starredFlags)
  selected: ReadonlySet<number>; // keys: a selection is of links, every copy
  onSelect: (keys: number[], on: boolean) => void;
  onClearSelection: () => void;
  onToggleCopies: (key: number) => void;
  sourceNames: ReadonlyMap<string, string>;
  // The focused row: Enter or a click opens it, o opens the link, c copies
  // it, s stars it, x selects it, Shift+x selects from the last one (§7).
  onOpen: (row: number) => void;
  onOpenLink: (row: number) => void;
  onCopy: (row: number) => void;
  onStar: (row: number) => void;
}

// The list view (§6.2): only the rows on screen are drawn, so 50 k links
// scroll like 50. One row at a time is in the tab order; j/k or the arrow
// keys move between rows, Home/End and Page Up/Down jump (§7, Keyboard).
export function LinkList({
  rows,
  order,
  copies,
  openKeys,
  starred,
  selected,
  onSelect,
  onClearSelection,
  onToggleCopies,
  sourceNames,
  onOpen,
  onOpenLink,
  onCopy,
  onStar,
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
  // Where the last selection was made: a range runs from here.
  const anchor = useRef<number | null>(null);

  // Selects or unselects the link at this position, or every link from the
  // last one selected, all taking the state the clicked one takes.
  function select(position: number, range: boolean) {
    const keyAt = (p: number) => rows.keys[order[p]!]!;
    const on = !selected.has(keyAt(position));
    const from = range && anchor.current !== null ? anchor.current : position;
    const keys: number[] = [];
    for (let p = Math.min(from, position); p <= Math.max(from, position); p++) {
      keys.push(keyAt(p));
    }
    anchor.current = position;
    onSelect(keys, on);
  }

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
    const actions: Record<string, (row: number) => void> = {
      o: onOpenLink,
      c: onCopy,
      s: onStar,
    };
    if (event.key.toLowerCase() === "x" && count > 0) {
      event.preventDefault();
      select(current, event.shiftKey);
      return;
    }
    if (event.key === "Escape" && selected.size > 0) {
      event.preventDefault();
      onClearSelection();
      return;
    }
    const action = actions[event.key];
    if (action && count > 0) {
      event.preventDefault();
      action(order[current]!);
      return;
    }
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
              starred={starred?.[rows.keys[row]!] === 1}
              selected={selected.has(rows.keys[row]!)}
              selecting={selected.size > 0}
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
              onSelect={select}
              onToggleCopies={(r) => onToggleCopies(rows.keys[r]!)}
              onOpen={onOpen}
            />
          );
        })}
      </div>
    </div>
  );
}
