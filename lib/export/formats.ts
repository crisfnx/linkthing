// The export files (PRD §6.5): CSV for spreadsheets, a Markdown list for
// notes, plain text, one URL per line, and JSON for other apps and scripts.
// The backup is its own thing (lib/backup/), the one file a restore reads;
// the Netscape bookmarks file follows in Phase 1.5.
import { displayUrl } from "@/lib/preview/display-url";
import { localDateTime, type ExportFormat, type ExportRow } from "./rows";

// --- CSV ------------------------------------------------------------------------

const COLUMNS = [
  "url",
  "title",
  "site",
  "kind",
  "date",
  "sender",
  "source",
  "starred",
  "message",
  "url_as_found",
];

const BYTE_ORDER_MARK = "\uFEFF";

// Every cell quoted, quotes doubled. A cell a spreadsheet would read as a
// formula (=, +, -, @, tab, carriage return first) gets a leading ', so
// opening the file can't run anything from a chat.
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

// CRLF between records (RFC 4180), and a byte-order mark so Excel reads the
// file as UTF-8 rather than mangling accents and emoji.
export function toCsv(rows: readonly ExportRow[]): string {
  const once = rows.some((row) => row.shared !== undefined);
  const header = once ? [...COLUMNS, "times_shared"] : COLUMNS;
  const lines = [header.map(csvCell).join(",")];
  for (const { link, title, site, source, starred, shared } of rows) {
    const cells = [
      link.canonicalUrl,
      title,
      site,
      link.kind,
      localDateTime(link.timestamp),
      link.sender ?? "",
      source,
      starred ? "yes" : "",
      link.context ?? "",
      link.url,
    ];
    if (once) cells.push(String(shared ?? 1));
    lines.push(cells.map(csvCell).join(","));
  }
  return `${BYTE_ORDER_MARK}${lines.join("\r\n")}\r\n`;
}

// --- Markdown -------------------------------------------------------------------

// Brackets in a title would end the link text; backslashes would escape what
// follows. One line each.
export function markdownText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\[\]]/g, "\\$&");
}

// Parentheses would end the link's destination, spaces break it.
export function markdownUrl(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
}

//   - [Lisbon beyond the trams](https://www.theguardian.com/…) — 2026-03-10
// The URL stands in for a missing title; undated links have no date.
export function toMarkdown(rows: readonly ExportRow[]): string {
  const lines = rows.map(({ link, title }) => {
    const text = markdownText(title || displayUrl(link.canonicalUrl));
    const date = localDateTime(link.timestamp).slice(0, 10);
    return `- [${text}](${markdownUrl(link.canonicalUrl)})${date ? ` — ${date}` : ""}`;
  });
  return lines.length ? `${lines.join("\n")}\n` : "";
}

// --- Plain text -----------------------------------------------------------------

export function toText(urls: readonly string[]): string {
  return urls.length ? `${urls.join("\n")}\n` : "";
}

// --- JSON -----------------------------------------------------------------------

// A list of links, one object a line: the CSV's columns with JSON's types
// (dates as ISO 8601, starred a boolean), and fields a link lacks left out.
export function toJson(rows: readonly ExportRow[]): string {
  const objects = rows.map(({ link, title, site, source, starred, shared }) =>
    JSON.stringify({
      url: link.canonicalUrl,
      title: title || undefined,
      site,
      kind: link.kind,
      date:
        link.timestamp === undefined
          ? undefined
          : new Date(link.timestamp).toISOString(),
      sender: link.sender,
      source,
      starred,
      message: link.context,
      urlAsFound: link.url,
      timesShared: shared,
    }),
  );
  return objects.length ? `[\n${objects.join(",\n")}\n]\n` : "[]\n";
}

export function formatExport(
  rows: readonly ExportRow[],
  format: ExportFormat,
): string {
  switch (format) {
    case "csv":
      return toCsv(rows);
    case "markdown":
      return toMarkdown(rows);
    case "text":
      return toText(rows.map(({ link }) => link.canonicalUrl));
    case "json":
      return toJson(rows);
  }
}
