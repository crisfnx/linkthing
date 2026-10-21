const TRAILING = `.,;:!?'">…`;
const OPENER: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
const EMPHASIS = "*_~";
// The `;` of an HTML entity (`&amp;`) belongs to the URL; unescape.ts decodes it.
const ENTITY_END = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);$/i;

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

// Trims what a sentence or markup added to the end of a URL (PRD §4.2).
// `before` is the text right before the match: an emphasis mark is stripped
// only as many times as it also opens the URL, because real tokens can end in
// `_`.
export function repairCandidate(raw: string, before: string): string {
  let url = raw;
  let marks = /[*_~]*$/.exec(before)?.[0] ?? "";

  for (;;) {
    const last = url.at(-1);
    if (last === undefined) break;
    const opener = OPENER[last];
    if (last === ";" && ENTITY_END.test(url)) break;
    if (
      TRAILING.includes(last) ||
      (opener !== undefined && count(url, opener) < count(url, last))
    ) {
      url = url.slice(0, -1);
    } else if (EMPHASIS.includes(last) && marks.endsWith(last)) {
      url = url.slice(0, -1);
      marks = marks.slice(0, -1);
    } else {
      break;
    }
  }

  return url;
}
