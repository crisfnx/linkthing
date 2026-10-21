// URLs inside JSON exports, logs and HTML arrive escaped (PRD §4.1).

// A JSON string escape that can't be part of a URL (\n, \t, \", \\ …), or a
// backslash at the very end of the match, ends the URL.
const STRING_ESCAPE = /\\(?:[nrtbf"\\]|$)[\s\S]*$/;

// JSON writes `/` as `\/` and may write any character as a \uXXXX escape
// (`&` as 0026, `/` as 002F). HTML writes `&` as `&amp;`.
const JSON_ESCAPE = /\\(?:\/|u([0-9a-fA-F]{4}))/g;
const HTML_ENTITY = /&(?:(amp|quot|apos|lt|gt)|#(\d+)|#x([0-9a-fA-F]+));/gi;
const NAMED: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
};

export function cutAtStringEscape(raw: string): string {
  return raw.replace(STRING_ESCAPE, "");
}

function fromCodePoint(code: number, fallback: string): string {
  return code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

export function unescapeUrl(raw: string): string {
  return raw
    .replace(JSON_ESCAPE, (_, hex: string | undefined) =>
      hex === undefined ? "/" : String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(
      HTML_ENTITY,
      (
        entity,
        name: string | undefined,
        decimal: string | undefined,
        hex: string | undefined,
      ) => {
        if (name) return NAMED[name.toLowerCase()] ?? entity;
        if (decimal) return fromCodePoint(Number(decimal), entity);
        return fromCodePoint(Number.parseInt(hex ?? "", 16), entity);
      },
    );
}
