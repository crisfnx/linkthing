const TRAILING = `.,;:!?'">…`;
const OPENER: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
const EMPHASIS = "*_~";
// The `;` of an HTML entity (`&amp;`) belongs to the URL; unescape.ts decodes it.
const ENTITY_END = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);$/i;
const ENTITY_CHAR = /[\da-z#]/i;

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

// Whether the URL ends in an entity, testing only its tail: the `&` can be no
// further back than the run of entity characters before the `;`. Testing the
// whole URL for each trailing `;` was quadratic.
function endsInEntity(url: string): boolean {
  let start = url.length - 1;
  while (start > 0 && ENTITY_CHAR.test(url.charAt(start - 1))) start--;
  return ENTITY_END.test(url.slice(Math.max(0, start - 1)));
}

// Trims what a sentence or markup added to the end of a URL (PRD §4.2).
// `before` is the text right before the match: an emphasis mark is stripped
// only as many times as it also opens the URL, because real tokens can end in
// `_`.
export function repairCandidate(raw: string, before: string): string {
  let url = raw;
  let marks = /[*_~]*$/.exec(before)?.[0] ?? "";
  // Brackets are counted once and the count kept as the end is trimmed:
  // recounting per trimmed character was quadratic. Counted only when the
  // URL first ends in a closing bracket, which most never do. Nothing
  // trimmed before then is a bracket, so the count is the same.
  let brackets: Map<string, number> | undefined;
  const bracketsOf = (char: string) => {
    if (!brackets) {
      brackets = new Map();
      for (const each of "()[]{}") brackets.set(each, count(url, each));
    }
    return brackets.get(char) ?? 0;
  };

  for (;;) {
    const last = url.at(-1);
    if (last === undefined) break;
    const opener = OPENER[last];
    if (last === ";" && endsInEntity(url)) break;
    if (
      TRAILING.includes(last) ||
      (opener !== undefined && bracketsOf(opener) < bracketsOf(last))
    ) {
      url = url.slice(0, -1);
      if (opener !== undefined) brackets?.set(last, bracketsOf(last) - 1);
    } else if (EMPHASIS.includes(last) && marks.endsWith(last)) {
      url = url.slice(0, -1);
      marks = marks.slice(0, -1);
    } else {
      break;
    }
  }

  return url;
}
