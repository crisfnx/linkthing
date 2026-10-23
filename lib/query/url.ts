// The view in the address bar (PRD §6.3): search, filters, sort and collapsed
// duplicates as a query string, so a view can be bookmarked, survives a
// reload, and the back button undoes a change. Defaults are left out, so an
// unfiltered library is just "/".
//
//   ?q=lisbon&site=wikipedia.org&site=theguardian.com&sender=&starred=1&sort=oldest&dedupe=1
//
// A filter value repeats its parameter; an empty value is "no sender" or
// "no date". Unknown kinds and sorts are dropped rather than trusted.
// Duplicates follow Settings → "Collapse duplicates" unless the address
// says otherwise (dedupe=1 or dedupe=0): `base` is the view with the user's
// defaults.
import { LINK_KINDS, type LinkKind } from "@/lib/extract/types";
import { siteName } from "@/lib/extract/url/domain";
import { EMPTY_QUERY, SORTS, type Query, type Sort } from "./view";

const LISTS = [
  ["site", "sites"],
  ["kind", "kinds"],
  ["sender", "senders"],
  ["source", "sources"],
  ["date", "dates"],
] as const;

export function queryFromSearch(
  search: string,
  base: Query = EMPTY_QUERY,
): Query {
  const params = new URLSearchParams(search);
  const kinds = params
    .getAll("kind")
    .filter((kind): kind is LinkKind =>
      (LINK_KINDS as readonly string[]).includes(kind),
    );
  const sort = params.get("sort");
  const dedupe = params.get("dedupe");
  return {
    text: params.get("q") ?? "",
    // An address from before X's links were shown as x.com still works.
    sites: [...new Set(params.getAll("site").map(siteName))],
    kinds: [...new Set(kinds)],
    senders: params.getAll("sender"),
    sources: params.getAll("source"),
    dates: params.getAll("date"),
    starred: params.get("starred") === "1",
    sort: SORTS.includes(sort as Sort) ? (sort as Sort) : base.sort,
    dedupe: dedupe === "1" ? true : dedupe === "0" ? false : base.dedupe,
  };
}

// The query string for a query, without its "?"; "" when it's all defaults.
export function searchFromQuery(
  query: Query,
  base: Query = EMPTY_QUERY,
): string {
  const params = new URLSearchParams();
  if (query.text !== "") params.set("q", query.text);
  for (const [param, field] of LISTS) {
    for (const value of query[field]) params.append(param, value);
  }
  if (query.starred) params.set("starred", "1");
  if (query.sort !== base.sort) params.set("sort", query.sort);
  if (query.dedupe !== base.dedupe)
    params.set("dedupe", query.dedupe ? "1" : "0");
  return params.toString();
}

// Whether two queries differ only in their search text: typing replaces the
// history entry, every other change adds one.
export function onlyTextDiffers(a: Query, b: Query): boolean {
  return (
    searchFromQuery({ ...a, text: "" }) === searchFromQuery({ ...b, text: "" })
  );
}
