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
  index: number;
  start: number;
  active: boolean;
  showSender: boolean;
  sourceName?: string;
  linkRef?: Ref<HTMLAnchorElement>;
  onActivate: (index: number) => void;
}

// One link: a site badge (favicons arrive with M7), the title, or the URL
// when there's none, then the kind, URL, sender and source, and the date.
// Compiled as usual, so rows that stay on screen don't redraw on scroll.
function LinkRow({
  rows,
  index,
  start,
  active,
  showSender,
  sourceName,
  linkRef,
  onActivate,
}: RowProps) {
  const url = textAt(rows.urls, index);
  const shown = displayUrl(url);
  const title = textAt(rows.titles, index);
  const domain = rows.domainNames[rows.domains[index]!]!;
  const kind = kindAt(rows, index);
  const time = rows.timestamps[index]!;
  const sender = showSender ? rows.senderNames[rows.senders[index]!] : "";
  const details = [title ? shown : domain, sender, sourceName]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={rows.count}
      className="absolute inset-x-0 top-0 flex items-center gap-3 px-4 hover:bg-current/5 has-focus-visible:bg-current/10"
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
          onFocus={() => onActivate(index)}
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
  sourceNames: ReadonlyMap<string, string>;
}

// The list view (§6.2): only the rows on screen are drawn, so 50 k links
// scroll like 50. One row at a time is in the tab order; j/k or the arrow
// keys move between rows, Home/End and Page Up/Down jump (§7, Keyboard).
export function LinkList({ rows, sourceNames }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  // useVirtualizer returns functions the React Compiler can't memoize without
  // stale rows (§8.1), so the compiler leaves this component as written, as
  // it should; LinkRow is still compiled.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.count,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  const [active, setActive] = useState(0);
  const current = Math.min(active, rows.count - 1);
  // Set by a key press, so the row it moved to takes focus once drawn.
  const focusNext = useRef(false);

  function move(to: number) {
    const next = Math.max(0, Math.min(rows.count - 1, to));
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
      End: rows.count - 1,
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
        {virtualizer.getVirtualItems().map(({ index, start }) => (
          <LinkRow
            key={index}
            rows={rows}
            index={index}
            start={start}
            active={index === current}
            showSender={showSender}
            sourceName={
              showSource
                ? sourceNames.get(rows.sourceIds[rows.sources[index]!]!)
                : undefined
            }
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
          />
        ))}
      </div>
    </div>
  );
}
