// What an export writes per link (PRD §6.5), gathered in the worker from the
// full stored links: the lean rows lack the message text and the URL as
// found, and building a 100 k-line file is no job for the page's thread.
import type { LinkVaultDb } from "@/lib/db/schema";
import type { Link } from "@/lib/extract/types";
import { siteName } from "@/lib/extract/url/domain";
import { starredKeys } from "@/lib/library/details";
import { deriveTitle } from "@/lib/preview/derive-title";

export type ExportFormat = "csv" | "markdown" | "text";

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  "csv",
  "markdown",
  "text",
];

export const FILE_TYPES: Record<
  ExportFormat,
  { extension: string; type: string }
> = {
  csv: { extension: "csv", type: "text/csv;charset=utf-8" },
  markdown: { extension: "md", type: "text/markdown;charset=utf-8" },
  text: { extension: "txt", type: "text/plain;charset=utf-8" },
};

export interface ExportRow {
  link: Link;
  title: string; // the link text or a Tier 0 title; "" when there's none
  site: string; // as the library shows it: X's links are x.com
  source: string; // the source's name
  starred: boolean;
  shared?: number; // times shared, when each link is exported once
}

// The links with these ids, in this order; ids gone since (a source deleted
// meanwhile) are left out. One read transaction, a page of ids at a time.
export async function exportRows(
  db: LinkVaultDb,
  ids: readonly string[],
  shared?: readonly number[],
  pageSize = 10_000,
): Promise<ExportRow[]> {
  return db.transaction("r", db.sources, db.links, db.annotations, async () => {
    const names = new Map(
      (await db.sources.toArray()).map((source) => [source.id, source.name]),
    );
    const starred = new Set(await starredKeys(db));
    const rows: ExportRow[] = [];
    for (let start = 0; start < ids.length; start += pageSize) {
      const page = await db.links.bulkGet(ids.slice(start, start + pageSize));
      page.forEach((link, i) => {
        if (!link) return;
        const row: ExportRow = {
          link,
          title: deriveTitle(link) ?? "",
          site: siteName(link.domain),
          source: names.get(link.sourceId) ?? "",
          starred: starred.has(link.urlKey),
        };
        const times = shared?.[start + i];
        if (times !== undefined) row.shared = times;
        rows.push(row);
      });
    }
    return rows;
  });
}

// "2026-03-14 21:03" in the browser's time zone, as chat times are read.
export function localDateTime(time: number | undefined): string {
  if (time === undefined) return "";
  const d = new Date(time);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
