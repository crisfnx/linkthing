// The backup file (PRD §6.5): JSON Lines, gzipped. The first line says what
// the file is; every other line is one record, keyed by what it is:
//
//   {"linkvault":"backup","version":1,"exportedAt":…,"canonicalizerVersion":1,"counts":{…}}
//   {"settings":{"theme":"dark"}}
//   {"source":{"id":"…","name":"Me",…}}
//   {"part":{"id":"…","sourceId":"…",…,"text":"…"}}
//   {"link":{"id":"…","url":"https://…",…}}
//   {"annotation":{"urlKey":"…","starred":1,…}}
//
// One record per line, not one JSON document: a large library is hundreds of
// megabytes of JSON, more than a browser can parse as one string, and lines
// can be read one at a time. Parts carry their text decoded; the file as a
// whole is compressed.
import type { Annotation, Source, StoredSettings } from "@/lib/db/types";
import type { Link } from "@/lib/extract/types";

export const BACKUP_FORMAT = "backup";
export const BACKUP_VERSION = 1;

export interface BackupCounts {
  sources: number;
  parts: number;
  links: number;
  annotations: number;
}

export interface BackupHeader {
  linkvault: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  canonicalizerVersion: number; // the keys' version (§4.4)
  counts: BackupCounts; // a file that ends early is caught by these
}

export interface BackupPart {
  id: string;
  sourceId: string;
  fileName?: string;
  importedAt: number;
  byteSize: number;
  contentHash: string;
  text: string; // SourcePart.raw, decoded
}

export type BackupRecord =
  | { settings: Omit<StoredSettings, "key"> }
  | { source: Source }
  | { part: BackupPart }
  | { link: Link }
  | { annotation: Annotation };

export interface Backup {
  header: BackupHeader;
  settings?: Omit<StoredSettings, "key">;
  sources: Source[];
  parts: BackupPart[];
  links: Link[];
  annotations: Annotation[];
}

// linkvault-backup-2026-10-23.jsonl.gz
export function backupFileName(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `linkvault-backup-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.jsonl.gz`;
}

// What a backup's first bytes look like, gzipped or not: enough to tell one
// from a chat export without reading it all.
export async function looksLikeBackup(file: Blob): Promise<boolean> {
  const start = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let head: string;
  if (start[0] === 0x1f && start[1] === 0x8b) {
    const reader = file
      .stream()
      .pipeThrough(new DecompressionStream("gzip"))
      .pipeThrough(new TextDecoderStream())
      .getReader();
    const { value } = await reader.read().catch(() => ({ value: "" }));
    await reader.cancel().catch(() => {});
    head = value ?? "";
  } else {
    head = await file.slice(0, 64).text();
  }
  return /^\{"linkvault":"backup"/.test(head);
}
