import { findCandidates } from "./find";
import { repairCandidate } from "./repair";
import { cutAtStringEscape, unescapeUrl } from "./unescape";
import { isWebUrl } from "./validate";

export interface FoundUrl {
  url: string; // decoded and repaired; `www.` gets https:// (Link.url)
  index: number; // where the match starts in the text
  length: number; // length of the match in the text, escapes included
}

// find → repair → decode → validate (PRD §4.1–4.3).
export function extractUrls(text: string): FoundUrl[] {
  const found: FoundUrl[] = [];
  for (const { raw, index } of findCandidates(text)) {
    const before = text.slice(Math.max(0, index - 8), index);
    const span = repairCandidate(cutAtStringEscape(raw), before);
    const decoded = unescapeUrl(span);
    const url = /^www\./i.test(decoded) ? `https://${decoded}` : decoded;
    if (isWebUrl(url)) found.push({ url, index, length: span.length });
  }
  return found;
}
