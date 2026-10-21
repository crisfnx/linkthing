import type { Link, TrackingParam } from "@/lib/extract/types";
import { canonicalize } from "./canonicalize";
import { classify } from "./classify";
import { domainOf } from "./domain";
import { toUrlKey } from "./key";
import { isShortened } from "./shorteners";
import { DEFAULT_TRACKING_PARAMS } from "./tracking-params";

export type UrlFields = Pick<
  Link,
  | "canonicalUrl"
  | "urlKey"
  | "host"
  | "domain"
  | "path"
  | "kind"
  | "isShortened"
>;

// Everything a Link stores about its URL, from the repaired URL as found
// (PRD §4.4–4.7).
export function describeUrl(
  url: string,
  rules: readonly TrackingParam[] = DEFAULT_TRACKING_PARAMS,
): UrlFields {
  const canonicalUrl = canonicalize(url, rules);
  const { hostname, pathname } = new URL(canonicalUrl);
  return {
    canonicalUrl,
    urlKey: toUrlKey(canonicalUrl),
    host: hostname,
    domain: domainOf(hostname),
    path: pathname,
    kind: classify(hostname, pathname),
    isShortened: isShortened(hostname, pathname),
  };
}
