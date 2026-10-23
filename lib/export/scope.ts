// Which links an export takes, worked out on the page from the lean rows
// (PRD §6.5): the view, the selected links, or the whole library, each link
// once or every time it was shared.
import { textAt, type LibraryRows } from "@/lib/library/rows";

export type ExportScope = "view" | "selection" | "library";

// The rows of the selected links (by key, so every copy), in library order.
export function selectedRows(
  rows: LibraryRows,
  keys: ReadonlySet<number>,
): Uint32Array {
  const out: number[] = [];
  for (let r = 0; r < rows.count; r++) {
    if (keys.has(rows.keys[r]!)) out.push(r);
  }
  return Uint32Array.from(out);
}

export function allRows(rows: LibraryRows): Uint32Array {
  return new Uint32Array(rows.count).map((_, i) => i);
}

// Each link once: its first row in the list's order, with how many of the
// list's rows share it. Every time: the list as it is.
export function exportOrder(
  rows: LibraryRows,
  list: Uint32Array,
  once: boolean,
): { order: Uint32Array; shared: Uint32Array | null } {
  if (!once) return { order: list, shared: null };
  const counts = new Uint32Array(rows.keyCount);
  for (const row of list) counts[rows.keys[row]!]!++;
  const seen = new Uint8Array(rows.keyCount);
  const order: number[] = [];
  const shared: number[] = [];
  for (const row of list) {
    const key = rows.keys[row]!;
    if (seen[key]) continue;
    seen[key] = 1;
    order.push(row);
    shared.push(counts[key]!);
  }
  return { order: Uint32Array.from(order), shared: Uint32Array.from(shared) };
}

export function idsOf(rows: LibraryRows, order: Uint32Array): string[] {
  return Array.from(order, (row) => textAt(rows.ids, row));
}

export function urlsOf(rows: LibraryRows, order: Uint32Array): string[] {
  return Array.from(order, (row) => textAt(rows.urls, row));
}

// linkvault-view-2026-10-23.csv
export function fileName(
  scope: ExportScope,
  extension: string,
  now = new Date(),
): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  return `linkvault-${scope}-${day}.${extension}`;
}

// Hands a file to the browser's downloads. The address is let go once the
// download has had a moment to start.
export function saveFile(file: Blob, name: string): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
