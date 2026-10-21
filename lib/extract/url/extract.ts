import { findCandidates } from "./find";
import { repairCandidate } from "./repair";
import { isWebUrl } from "./validate";

export interface FoundUrl {
  url: string; // as found, repaired; `www.` gets https:// (Link.url)
  index: number; // where the match starts in the text
  length: number; // length of the repaired match in the text
}

// find → repair → validate (PRD §4.1–4.3).
export function extractUrls(text: string): FoundUrl[] {
  const found: FoundUrl[] = [];
  for (const { raw, index } of findCandidates(text)) {
    const before = text.slice(Math.max(0, index - 8), index);
    const repaired = repairCandidate(raw, before);
    const url = /^www\./i.test(repaired) ? `https://${repaired}` : repaired;
    if (isWebUrl(url)) found.push({ url, index, length: repaired.length });
  }
  return found;
}
