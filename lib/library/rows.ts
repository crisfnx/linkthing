// The library as the page browses it (PRD §5, querying strategy): one lean row
// per link, built in the worker and posted to the page after load and after
// each import.
//
// Rows travel as columns, not as an object per link. Each kind of text is one
// long string and every number column a typed array, so the page receives a
// few large values instead of tens of thousands of small objects: at 50 k
// links that is about 4 ms of structured clone instead of 40 ms, against the
// main thread's 50 ms budget (§8.6). The typed arrays are transferred, not
// copied.
import type { LinkVaultDb } from "@/lib/db/schema";
import { LINK_KINDS, type Link, type LinkKind } from "@/lib/extract/types";
import { searchNamesOf, siteName } from "@/lib/extract/url/domain";
import { deriveTitle } from "@/lib/preview/derive-title";

// Row i's text is text.slice(offsets[i], offsets[i + 1] - 1). Rows are joined
// by U+0000, which no row contains, so a search can't match across two.
export interface PackedText {
  text: string;
  offsets: Uint32Array; // count + 1 entries
}

export interface LibraryRows {
  count: number;
  // Newest first; undated links last, latest import first, then in file order.
  ids: PackedText; // Link ids, for reading the full link (drawer, exports)
  titles: PackedText; // link text or a Tier 0 title; "" when there's none
  urls: PackedText; // the canonical URL: opened on click, read via displayUrl
  search: PackedText; // lowercased and without accents (foldForSearch)
  timestamps: Float64Array; // NaN when undated
  kinds: Uint8Array; // index into LINK_KINDS
  flags: Uint8Array; // SHORTENED | BARE
  domains: Uint32Array; // index into domainNames
  domainNames: string[]; // sites as shown (siteName): twitter.com is x.com
  senders: Uint32Array; // index into senderNames; 0 is no sender
  senderNames: string[];
  sources: Uint32Array; // index into sourceIds
  sourceIds: string[];
  keys: Uint32Array; // duplicates share a key: the same urlKey (§4.4)
  keyCount: number; // distinct links
}

export const SHORTENED = 1;
export const BARE = 2;

export function textAt({ text, offsets }: PackedText, row: number): string {
  return text.slice(offsets[row], offsets[row + 1]! - 1);
}

export function kindAt(rows: LibraryRows, row: number): LinkKind {
  return LINK_KINDS[rows.kinds[row]!]!;
}

// The buffers to transfer with postMessage rather than copy.
export function transferablesOf(rows: LibraryRows): ArrayBuffer[] {
  return [
    rows.ids.offsets,
    rows.titles.offsets,
    rows.urls.offsets,
    rows.search.offsets,
    rows.timestamps,
    rows.kinds,
    rows.flags,
    rows.domains,
    rows.senders,
    rows.sources,
    rows.keys,
  ].map((column) => column.buffer as ArrayBuffer);
}

// Search text and queries alike: lowercase, accents off ("belem" finds
// Belém), whitespace collapsed. Most text is ASCII and skips the Unicode work.
export function foldForSearch(text: string): string {
  let folded = text.toLowerCase();
  if (/[^\x00-\x7f]/.test(folded)) {
    folded = folded.normalize("NFD").replace(/\p{M}/gu, "");
  }
  return folded.replace(/[\s\0]+/g, " ").trim();
}

const KIND_INDEX = new Map<LinkKind, number>(
  LINK_KINDS.map((kind, i) => [kind, i]),
);

// Each distinct value once, numbered in the order first seen.
class Table {
  readonly names: string[] = [];
  private readonly index = new Map<string, number>();

  constructor(initial: readonly string[] = []) {
    for (const name of initial) this.indexOf(name);
  }

  indexOf(name: string): number {
    let i = this.index.get(name);
    if (i === undefined) {
      i = this.names.push(name) - 1;
      this.index.set(name, i);
    }
    return i;
  }
}

function pack(column: readonly string[], order: Uint32Array): PackedText {
  const offsets = new Uint32Array(order.length + 1);
  const parts = new Array<string>(order.length);
  let at = 0;
  order.forEach((row, i) => {
    const text = column[row]!;
    offsets[i] = at;
    parts[i] = text;
    at += text.length + 1;
  });
  offsets[order.length] = at;
  return { text: parts.join("\0"), offsets };
}

// Builds rows one link at a time, so links can be read a page at a time and
// let go. Sources come in the order their undated links should show.
export class RowsBuilder {
  private readonly ids: string[] = [];
  private readonly titles: string[] = [];
  private readonly urls: string[] = [];
  private readonly search: string[] = [];
  private readonly timestamps: number[] = [];
  private readonly kinds: number[] = [];
  private readonly flags: number[] = [];
  private readonly domains: number[] = [];
  private readonly senders: number[] = [];
  private readonly sources: number[] = [];
  private readonly keys: number[] = [];
  private readonly lines: number[] = [];
  private readonly columns: number[] = [];

  private readonly domainTable = new Table();
  private readonly senderTable = new Table([""]);
  private readonly sourceTable: Table;
  private readonly keyTable = new Table();
  private readonly names = new Map<string, string>();

  constructor(sourceIds: readonly string[] = []) {
    this.sourceTable = new Table(sourceIds);
  }

  add(link: Link): void {
    const title = deriveTitle(link) ?? "";
    // Per host, since Wikipedia's names depend on the language's host.
    let names = this.names.get(link.host);
    if (names === undefined) {
      names = searchNamesOf(link.domain, link.host).join(" ");
      this.names.set(link.host, names);
    }
    this.ids.push(link.id);
    this.titles.push(title);
    this.urls.push(link.canonicalUrl);
    this.search.push(
      foldForSearch(
        [
          link.canonicalUrl,
          link.url === link.canonicalUrl ? "" : link.url,
          title,
          link.folder,
          link.context,
          link.nearby,
          link.sender,
          names,
        ].join(" "),
      ),
    );
    this.timestamps.push(link.timestamp ?? NaN);
    this.kinds.push(KIND_INDEX.get(link.kind) ?? KIND_INDEX.get("other")!);
    this.flags.push(
      (link.isShortened ? SHORTENED : 0) | (link.isBare ? BARE : 0),
    );
    this.domains.push(this.domainTable.indexOf(siteName(link.domain)));
    this.senders.push(this.senderTable.indexOf(link.sender ?? ""));
    this.sources.push(this.sourceTable.indexOf(link.sourceId));
    this.keys.push(this.keyTable.indexOf(link.urlKey));
    this.lines.push(link.position.line);
    this.columns.push(link.position.column);
  }

  finish(): LibraryRows {
    const count = this.ids.length;
    const { timestamps, sources, lines, columns } = this;
    const order = new Uint32Array(count).map((_, i) => i);
    order.sort((a, b) => {
      const ta = timestamps[a]!;
      const tb = timestamps[b]!;
      const datedA = !Number.isNaN(ta);
      const datedB = !Number.isNaN(tb);
      if (datedA !== datedB) return datedA ? -1 : 1;
      if (datedA && ta !== tb) return tb - ta;
      return (
        sources[a]! - sources[b]! ||
        lines[a]! - lines[b]! ||
        columns[a]! - columns[b]!
      );
    });
    const take = <T extends Float64Array | Uint8Array | Uint32Array>(
      column: readonly number[],
      into: T,
    ): T => {
      order.forEach((row, i) => (into[i] = column[row]!));
      return into;
    };
    return {
      count,
      ids: pack(this.ids, order),
      titles: pack(this.titles, order),
      urls: pack(this.urls, order),
      search: pack(this.search, order),
      timestamps: take(timestamps, new Float64Array(count)),
      kinds: take(this.kinds, new Uint8Array(count)),
      flags: take(this.flags, new Uint8Array(count)),
      domains: take(this.domains, new Uint32Array(count)),
      domainNames: this.domainTable.names,
      senders: take(this.senders, new Uint32Array(count)),
      senderNames: this.senderTable.names,
      sources: take(sources, new Uint32Array(count)),
      sourceIds: this.sourceTable.names,
      keys: take(this.keys, new Uint32Array(count)),
      keyCount: this.keyTable.names.length,
    };
  }
}

// Reads every link, a page at a time so a large library isn't held as full
// records all at once, in one read transaction so an import committing
// halfway through can't leave half a source in the rows.
export async function loadRows(
  db: LinkVaultDb,
  pageSize = 10_000,
): Promise<LibraryRows> {
  return db.transaction("r", db.sources, db.links, async () => {
    const sourceIds = await db.sources
      .orderBy("importedAt")
      .reverse()
      .primaryKeys();
    const builder = new RowsBuilder(sourceIds);
    let after: string | undefined;
    for (;;) {
      const page = await (
        after === undefined
          ? db.links.toCollection()
          : db.links.where(":id").above(after)
      )
        .limit(pageSize)
        .toArray();
      for (const link of page) builder.add(link);
      if (page.length < pageSize) break;
      after = page.at(-1)!.id;
    }
    return builder.finish();
  });
}
