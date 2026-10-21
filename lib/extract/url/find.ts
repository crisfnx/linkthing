// Where URLs start and roughly end (PRD §4.1). No `\b` before the scheme, so a
// URL glued to the word before it is still found; `www.` needs a lookbehind so
// "awww." and "foo.www." don't match. Format characters (zero-width and bidi
// marks, the BOM), emoji and full-width CJK punctuation end a match.
const CANDIDATE =
  /(?:https?:\/\/|(?<![\p{L}\p{N}.-])www\.)[^\s<>"`\p{Cf}\p{Extended_Pictographic}、。」）]+/giu;

// Links that are counted as "skipped, non-web" but never stored (§4.3).
// `tel:` must be followed by the number itself, so a "Tel: 01632" label isn't one.
const NON_WEB =
  /(?<![\p{L}\p{N}])(?:mailto:[^\s@]+@|tel:[+\d]|whatsapp:\/\/|intent:\/\/)/giu;

export interface Candidate {
  raw: string;
  index: number;
}

export function findCandidates(text: string): Candidate[] {
  return Array.from(text.matchAll(CANDIDATE), (match) => ({
    raw: match[0],
    index: match.index,
  }));
}

export function countNonWebLinks(text: string): number {
  return Array.from(text.matchAll(NON_WEB)).length;
}
