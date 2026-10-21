// Where URLs start and roughly end (PRD §4.1). No `\b` before the scheme, so a
// URL glued to the word before it is still found; `www.` needs a lookbehind so
// "awww." and "foo.www." don't match. The `//` may be JSON-escaped (`\/\/`, or
// two escaped 002F code units); unescape.ts decodes the match. Format
// characters (zero-width and bidi marks, the BOM), emoji and full-width CJK
// punctuation end a match.
const TAIL = String.raw`[^\s<>"\x60\p{Cf}\p{Extended_Pictographic}、。」）]`;
const SCHEMED = String.raw`(?:https?:(?:\/\/|\\\/\\\/|\\u002[fF]\\u002[fF])|(?<![\p{L}\p{N}.-])www\.)${TAIL}+`;

// A bare domain (`codesandbox.io`, `github.com/org/repo`): labels, then a
// dot and letters, not glued to a word, an email address (@) or a file path
// (/ \ . _ -). validate.ts checks the ending against the public suffix list.
const BARE = String.raw`(?<![\p{L}\p{N}@._\/\\-])(?<bare>(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?![\p{L}\p{N}@_-])(?:\/${TAIL}*)?)`;

const CANDIDATE = new RegExp(SCHEMED, "giu");
const CANDIDATE_OR_BARE = new RegExp(`${SCHEMED}|${BARE}`, "giu");

// Links that are counted as "skipped, non-web" but never stored (§4.3).
// `tel:` must be followed by the number itself, so a "Tel: 01632" label isn't one.
const NON_WEB =
  /(?<![\p{L}\p{N}])(?:mailto:[^\s@]+@|tel:[+\d]|whatsapp:\/\/|intent:\/\/)/giu;

export interface Candidate {
  raw: string;
  index: number;
  bare: boolean; // no scheme and no www. (§4.1)
}

export function findCandidates(text: string, bareDomains = true): Candidate[] {
  const pattern = bareDomains ? CANDIDATE_OR_BARE : CANDIDATE;
  return Array.from(text.matchAll(pattern), (match) => ({
    raw: match[0],
    index: match.index,
    bare: match.groups?.bare !== undefined,
  }));
}

export function countNonWebLinks(text: string): number {
  return Array.from(text.matchAll(NON_WEB)).length;
}
