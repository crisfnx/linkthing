import { findCandidates } from "./find";
import { repairCandidate } from "./repair";
import { cutAtStringEscape, unescapeUrl } from "./unescape";
import { isBareDomain, isWebUrl } from "./validate";

export interface FoundUrl {
  url: string; // decoded and repaired; `www.` and bare domains get https:// (Link.url)
  index: number; // where the match starts in the text
  length: number; // length of the match in the text, escapes included
  bare: boolean; // found without a scheme or www. (Link.isBare)
}

export interface ExtractOptions {
  bareDomains?: boolean; // Settings → "Find bare domains", default on
}

// find → repair → decode → validate (PRD §4.1–4.3).
export function extractUrls(
  text: string,
  { bareDomains = true }: ExtractOptions = {},
): FoundUrl[] {
  const found: FoundUrl[] = [];
  for (const { raw, index, bare } of findCandidates(text, bareDomains)) {
    const before = text.slice(Math.max(0, index - 8), index);
    const span = repairCandidate(cutAtStringEscape(raw), before);
    const decoded = unescapeUrl(span);
    const url =
      bare || /^www\./i.test(decoded) ? `https://${decoded}` : decoded;
    if (!isWebUrl(url)) continue;
    if (bare && !isBareDomain(new URL(url).hostname, decoded.includes("/"))) {
      continue;
    }
    found.push({ url, index, length: span.length, bare });
  }
  return found;
}
