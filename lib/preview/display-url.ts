// How a link's URL reads on screen, and the cleaning that titles share
// (PRD §6.8). Kept apart from derive-title.ts, which runs in the worker, so
// the page can format the rows it shows without loading the title rules.

// Bidi controls, zero-width characters and C0/C1 controls.
const INVISIBLE =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

export function clean(text: string): string {
  return text.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

// A canonical URL without its scheme, "www." and trailing slash, decoded for
// reading: "en.wikipedia.org/wiki/Belém_Tower". Hosts stay as they are, in
// punycode where they're written that way (§8.7).
export function displayUrl(canonicalUrl: string): string {
  let text = canonicalUrl.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (text.endsWith("/")) text = text.slice(0, -1);
  try {
    text = decodeURI(text);
  } catch {
    // a malformed escape: show it as written
  }
  return clean(text);
}
