// The view in the address bar (PRD §6.3): search, filters, sort and collapsed
// duplicates as a query string, so a view can be bookmarked, survives a
// reload, and the back button undoes a change. Defaults are left out, so an
// unfiltered library is just "/".
//
//   ?q=lisbon&site=wikipedia.org&site=theguardian.com&sender=&sort=oldest&dedupe=1
//
// A filter value repeats its parameter; an empty value is "no sender" or
// "no date". Unknown kinds and sorts are dropped rather than trusted.
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

export function queryFromSearch(search: string): Query {
  const params = new URLSearchParams(search);
  const kinds = params
    .getAll("kind")
    .filter((kind): kind is LinkKind =>
      (LINK_KINDS as readonly string[]).includes(kind),
    );
  const sort = params.get("sort");
  return {
    text: params.get("q") ?? "",
    // An address from before X's links were shown as x.com still works.
    sites: [...new Set(params.getAll("site").map(siteName))],
    kinds: [...new Set(kinds)],
    senders: params.getAll("sender"),
    sources: params.getAll("source"),
    dates: params.getAll("date"),
    sort: SORTS.includes(sort as Sort) ? (sort as Sort) : EMPTY_QUERY.sort,
    dedupe: params.get("dedupe") === "1",
  };
}

// The query string for a query, without its "?"; "" when it's all defaults.
export function searchFromQuery(query: Query): string {
  const params = new URLSearchParams();
  if (query.text !== "") params.set("q", query.text);
  for (const [param, field] of LISTS) {
    for (const value of query[field]) params.append(param, value);
  }
  if (query.sort !== EMPTY_QUERY.sort) params.set("sort", query.sort);
  if (query.dedupe) params.set("dedupe", "1");
  return params.toString();
}

// Whether two queries differ only in their search text: typing replaces the
// history entry, every other change adds one.
export function onlyTextDiffers(a: Query, b: Query): boolean {
  return (
    searchFromQuery({ ...a, text: "" }) === searchFromQuery({ ...b, text: "" })
  );
}
