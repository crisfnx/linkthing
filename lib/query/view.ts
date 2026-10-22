// What the list shows (PRD §6.3): the rows matching a search and filters,
// in the chosen order, optionally one per distinct link, and the counts each
// filter offers. Runs on the page over the lean rows (§5), in a few linear
// passes over typed arrays, so a keystroke stays far inside 100 ms at 50 k
// links (§8.6).
import { LINK_KINDS, type LinkKind } from "@/lib/extract/types";
import { foldForSearch, type LibraryRows } from "@/lib/library/rows";

export type Sort = "newest" | "oldest" | "site" | "frequent" | "imported";

export const SORTS: readonly Sort[] = [
  "newest",
  "oldest",
  "site",
  "frequent",
  "imported",
];

// Filter values are names, not table indexes, so they survive the rows being
// read again after an import. Within a filter any value matches; across
// filters all must.
export interface Query {
  text: string;
  sites: readonly string[]; // sites as shown: x.com covers twitter.com too
  kinds: readonly LinkKind[];
  senders: readonly string[]; // "" is "no sender"
  sources: readonly string[]; // source ids
  dates: readonly string[]; // "2026", "2026-03", or "" for undated
  sort: Sort;
  dedupe: boolean;
}

export const EMPTY_QUERY: Query = {
  text: "",
  sites: [],
  kinds: [],
  senders: [],
  sources: [],
  dates: [],
  sort: "newest",
  dedupe: false,
};

export interface FacetValue {
  value: string;
  count: number; // matches if this value were (also) chosen
  selected: boolean;
}

export interface DateFacet extends FacetValue {
  months: FacetValue[]; // "2026-03", newest first
}

export interface Facets {
  sites: FacetValue[]; // most links first
  kinds: FacetValue[]; // in LINK_KINDS order
  senders: FacetValue[]; // most links first; "" last
  sources: FacetValue[]; // latest import first
  dates: DateFacet[]; // newest year first; "" (undated) last
}

export interface View {
  order: Uint32Array; // rows to show, in order
  // Per shown row: how many matching links share its key, when duplicates
  // are collapsed (1 when alone); 0 marks a copy shown under an expanded one.
  copies: Uint32Array | null;
  matching: number; // links matching the search and filters
  unique: number; // distinct links among them
  facets: Facets;
}

// --- Matching text ------------------------------------------------------------

// Rows whose search text contains every word, or null when there are no
// words. Each word is found by scanning the one long search string, jumping
// to the next row after a hit, so the cost is one pass per word.
export function searchRows(rows: LibraryRows, text: string): Uint8Array | null {
  const words = [...new Set(foldForSearch(text).split(" "))].filter(Boolean);
  if (words.length === 0) return null;
  // Longest first: the rarest, usually, which leaves the least to intersect.
  words.sort((a, b) => b.length - a.length);
  const { text: haystack, offsets } = rows.search;
  let hits: Uint8Array | null = null;
  for (const word of words) {
    const found = new Uint8Array(rows.count);
    let row = 0;
    let at = haystack.indexOf(word);
    while (at !== -1) {
      while (offsets[row + 1]! <= at) row++;
      if (!hits || hits[row]) found[row] = 1;
      at = haystack.indexOf(word, offsets[row + 1]!);
    }
    hits = found;
  }
  return hits;
}

// The last search, kept: choosing a filter or a sort doesn't search again.
let lastSearch:
  { rows: LibraryRows; text: string; hits: Uint8Array | null } | undefined;

function searchCached(rows: LibraryRows, text: string): Uint8Array | null {
  if (lastSearch?.rows !== rows || lastSearch.text !== text) {
    lastSearch = { rows, text, hits: searchRows(rows, text) };
  }
  return lastSearch.hits;
}

// --- Per-rows tables, worked out once per load ----------------------------------

interface Derived {
  month: Uint32Array; // index into months; 0 is undated
  months: number[]; // [0, newest yyyymm, …, oldest]
  siteRank: Uint32Array; // per domain: its place in A–Z order
}

const derivedCache = new WeakMap<LibraryRows, Derived>();

function derive(rows: LibraryRows): Derived {
  const cached = derivedCache.get(rows);
  if (cached) return cached;
  const yyyymm = new Uint32Array(rows.count);
  const seen = new Set<number>();
  for (let r = 0; r < rows.count; r++) {
    const time = rows.timestamps[r]!;
    if (Number.isNaN(time)) continue;
    const date = new Date(time);
    yyyymm[r] = date.getFullYear() * 100 + date.getMonth() + 1;
    seen.add(yyyymm[r]!);
  }
  const months = [0, ...[...seen].sort((a, b) => b - a)];
  const indexOf = new Map(months.map((m, i) => [m, i]));
  const month = yyyymm.map((m) => indexOf.get(m)!);
  const byName = rows.domainNames
    .map((name, i) => ({ name, i }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const siteRank = new Uint32Array(rows.domainNames.length);
  byName.forEach(({ i }, rank) => (siteRank[i] = rank));
  const derived = { month, months, siteRank };
  derivedCache.set(rows, derived);
  return derived;
}

const yearOf = (yyyymm: number) => Math.floor(yyyymm / 100);
const monthKey = (yyyymm: number) =>
  `${yearOf(yyyymm)}-${String(yyyymm % 100).padStart(2, "0")}`;

// --- Sorting ---------------------------------------------------------------------

// A stable counting sort: rows keep their incoming order within a bucket.
function bucketed(
  list: Uint32Array,
  keyOf: (row: number) => number,
  buckets: number,
): Uint32Array {
  const starts = new Uint32Array(buckets + 1);
  for (const row of list) starts[keyOf(row) + 1]!++;
  for (let b = 0; b < buckets; b++) starts[b + 1]! += starts[b]!;
  const out = new Uint32Array(list.length);
  for (const row of list) out[starts[keyOf(row)]!++] = row;
  return out;
}

// Rows arrive newest first with undated ones last (§5), so "newest" is the
// order as it stands and every other sort keeps it within a group.
function sorted(
  rows: LibraryRows,
  list: Uint32Array,
  sort: Sort,
  { siteRank }: Derived,
  siteCount: Uint32Array,
): Uint32Array {
  switch (sort) {
    case "newest":
      return list;
    case "oldest": {
      let dated = list.length;
      while (dated > 0 && Number.isNaN(rows.timestamps[list[dated - 1]!]!)) {
        dated--;
      }
      const out = new Uint32Array(list.length);
      for (let i = 0; i < dated; i++) out[i] = list[dated - 1 - i]!;
      out.set(list.subarray(dated), dated);
      return out;
    }
    case "site":
      return bucketed(
        list,
        (row) => siteRank[rows.domains[row]!]!,
        siteRank.length,
      );
    case "frequent": {
      // Sites with the most matching links first; ties A–Z.
      const sites = Array.from(siteRank.keys()).sort(
        (a, b) => siteCount[b]! - siteCount[a]! || siteRank[a]! - siteRank[b]!,
      );
      const rank = new Uint32Array(sites.length);
      sites.forEach((site, i) => (rank[site] = i));
      return bucketed(list, (row) => rank[rows.domains[row]!]!, rank.length);
    }
    case "imported":
      // Sources are numbered latest import first (§5).
      return bucketed(list, (row) => rows.sources[row]!, rows.sourceIds.length);
  }
}

// --- Filters and their counts -------------------------------------------------

const SITE = 1;
const KIND = 2;
const SENDER = 4;
const SOURCE = 8;
const DATE = 16;

// A selection as a flag per table index, or null when nothing is chosen.
function chosen(
  names: readonly string[],
  values: readonly string[],
): Uint8Array | null {
  if (values.length === 0) return null;
  const wanted = new Set(values);
  return Uint8Array.from(names, (name) => (wanted.has(name) ? 1 : 0));
}

function facet(
  names: readonly string[],
  counts: Uint32Array,
  selection: Uint8Array | null,
): FacetValue[] {
  return names
    .map((value, i) => ({
      value,
      count: counts[i]!,
      selected: selection?.[i] === 1,
    }))
    .filter((v) => v.count > 0 || v.selected);
}

export function buildView(
  rows: LibraryRows,
  query: Query,
  expanded: ReadonlySet<number> = new Set(), // keys shown with all copies
): View {
  const hits = searchCached(rows, query.text);
  const derived = derive(rows);
  const { month, months } = derived;

  const sites = chosen(rows.domainNames, query.sites);
  const kinds = chosen(LINK_KINDS, query.kinds);
  const senders = chosen(rows.senderNames, query.senders);
  const sources = chosen(rows.sourceIds, query.sources);
  // A date matches by its year or its month; "" is undated.
  const dateWanted = new Set(query.dates);
  const dates =
    query.dates.length === 0
      ? null
      : Uint8Array.from(months, (m) =>
          m === 0
            ? +dateWanted.has("")
            : +(
                dateWanted.has(String(yearOf(m))) || dateWanted.has(monthKey(m))
              ),
        );

  const siteCount = new Uint32Array(rows.domainNames.length);
  const kindCount = new Uint32Array(LINK_KINDS.length);
  const senderCount = new Uint32Array(rows.senderNames.length);
  const sourceCount = new Uint32Array(rows.sourceIds.length);
  const monthCount = new Uint32Array(months.length);
  const matched = new Uint32Array(rows.count);
  let matching = 0;

  // One pass. A row failing no filter matches and counts everywhere; a row
  // failing exactly one counts for that filter alone, since choosing its
  // value there would let it in.
  for (let r = 0; r < rows.count; r++) {
    if (hits && !hits[r]) continue;
    const site = rows.domains[r]!;
    const kind = rows.kinds[r]!;
    const sender = rows.senders[r]!;
    const source = rows.sources[r]!;
    const m = month[r]!;
    const failed =
      (sites && !sites[site] ? SITE : 0) |
      (kinds && !kinds[kind] ? KIND : 0) |
      (senders && !senders[sender] ? SENDER : 0) |
      (sources && !sources[source] ? SOURCE : 0) |
      (dates && !dates[m] ? DATE : 0);
    if (failed === 0) {
      matched[matching++] = r;
      siteCount[site]!++;
      kindCount[kind]!++;
      senderCount[sender]!++;
      sourceCount[source]!++;
      monthCount[m]!++;
    } else if ((failed & (failed - 1)) === 0) {
      if (failed === SITE) siteCount[site]!++;
      else if (failed === KIND) kindCount[kind]!++;
      else if (failed === SENDER) senderCount[sender]!++;
      else if (failed === SOURCE) sourceCount[source]!++;
      else monthCount[m]!++;
    }
  }
  const list = sorted(
    rows,
    matched.subarray(0, matching),
    query.sort,
    derived,
    siteCount,
  );

  // Distinct links, and with dedupe one row per key: the first in the
  // chosen order, with its copies under it when expanded.
  const copiesOf = new Uint32Array(rows.keyCount);
  for (const row of list) copiesOf[rows.keys[row]!]!++;
  let unique = 0;
  for (const n of copiesOf) if (n > 0) unique++;

  let order = list;
  let copies: Uint32Array | null = null;
  if (query.dedupe) {
    // Each key's rows in order, as linked lists: first[key], then next[row].
    const first = new Int32Array(rows.keyCount).fill(-1);
    const last = new Int32Array(rows.keyCount).fill(-1);
    const next = new Int32Array(rows.count).fill(-1);
    for (const row of list) {
      const key = rows.keys[row]!;
      if (first[key] === -1) first[key] = row;
      else next[last[key]!] = row;
      last[key] = row;
    }
    const shown: number[] = [];
    const counts: number[] = [];
    for (const row of list) {
      const key = rows.keys[row]!;
      if (first[key] !== row) continue;
      shown.push(row);
      counts.push(copiesOf[key]!);
      if (!expanded.has(key)) continue;
      for (let copy = next[row]!; copy !== -1; copy = next[copy]!) {
        shown.push(copy);
        counts.push(0);
      }
    }
    order = Uint32Array.from(shown);
    copies = Uint32Array.from(counts);
  }

  const byCount = (a: FacetValue, b: FacetValue) =>
    b.count - a.count || a.value.localeCompare(b.value);
  const senderFacet = facet(rows.senderNames, senderCount, senders);
  const dateFacet: DateFacet[] = [];
  months.forEach((m, i) => {
    const value = { count: monthCount[i]!, selected: dates?.[i] === 1 };
    if (m === 0) return;
    let year = dateFacet.at(-1);
    if (year?.value !== String(yearOf(m))) {
      const name = String(yearOf(m));
      year = {
        value: name,
        count: 0,
        selected: dateWanted.has(name),
        months: [],
      };
      dateFacet.push(year);
    }
    year.count += value.count;
    if (value.count > 0 || dateWanted.has(monthKey(m))) {
      year.months.push({
        value: monthKey(m),
        count: value.count,
        selected: dateWanted.has(monthKey(m)),
      });
    }
  });
  const undated = monthCount[0]!;
  const visibleDates = dateFacet.filter(
    (y) => y.count > 0 || y.selected || y.months.some((m) => m.selected),
  );
  if (undated > 0 || dateWanted.has("")) {
    visibleDates.push({
      value: "",
      count: undated,
      selected: dateWanted.has(""),
      months: [],
    });
  }

  return {
    order,
    copies,
    matching,
    unique,
    facets: {
      sites: facet(rows.domainNames, siteCount, sites).sort(byCount),
      kinds: facet(LINK_KINDS, kindCount, kinds),
      senders: [
        ...senderFacet.filter((v) => v.value !== "").sort(byCount),
        ...senderFacet.filter((v) => v.value === ""),
      ],
      sources: facet(rows.sourceIds, sourceCount, sources),
      dates: visibleDates,
    },
  };
}
