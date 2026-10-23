// Writing a backup, in the worker (PRD §6.5). Everything is read in one read
// transaction, so an import committing meanwhile is either all in the file
// or not at all. Links are read a page at a time and turned into lines at
// once, so the full records aren't all held together, and the file is built
// from many strings rather than one.
import type { LinkVaultDb } from "@/lib/db/schema";
import { decompressText } from "@/lib/db/raw";
import type { Meta, StoredSettings } from "@/lib/db/types";
import { CANONICALIZER_VERSION } from "@/lib/extract/url/canonicalize";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupCounts,
  type BackupHeader,
  type BackupRecord,
} from "./format";

const line = (record: BackupRecord | BackupHeader) =>
  `${JSON.stringify(record)}\n`;

const lines = <T>(rows: T[], record: (row: T) => BackupRecord) =>
  rows.map((row) => line(record(row))).join("");

// The settings as chosen, without the row's key.
function chosenSettings(row: StoredSettings): Omit<StoredSettings, "key"> {
  const chosen: Partial<StoredSettings> = { ...row };
  delete chosen.key;
  return chosen;
}

export async function writeBackup(
  db: LinkVaultDb,
  { now = Date.now(), pageSize = 10_000 } = {},
): Promise<{ file: Blob; counts: BackupCounts }> {
  const read = await db.transaction(
    "r",
    [db.settings, db.sources, db.sourceParts, db.links, db.annotations],
    async () => {
      const meta = (await db.settings.get("meta")) as Meta | undefined;
      const settings = (await db.settings.get("settings")) as
        StoredSettings | undefined;
      const sources = await db.sources.toArray();
      const parts = await db.sourceParts.toArray();
      const annotations = await db.annotations.toArray();
      const links: string[] = [];
      let linkCount = 0;
      let after: string | undefined;
      for (;;) {
        const page = await (
          after === undefined
            ? db.links.toCollection()
            : db.links.where(":id").above(after)
        )
          .limit(pageSize)
          .toArray();
        links.push(lines(page, (link) => ({ link })));
        linkCount += page.length;
        if (page.length < pageSize) break;
        after = page.at(-1)!.id;
      }
      return { meta, settings, sources, parts, annotations, links, linkCount };
    },
  );

  const counts: BackupCounts = {
    sources: read.sources.length,
    parts: read.parts.length,
    links: read.linkCount,
    annotations: read.annotations.length,
  };
  const header: BackupHeader = {
    linkvault: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    canonicalizerVersion:
      read.meta?.canonicalizerVersion ?? CANONICALIZER_VERSION,
    counts,
  };
  // Decompressing waits on a stream, which would end a Dexie transaction:
  // the parts' blobs were read in it, their text is read now.
  const parts = await Promise.all(
    read.parts.map(async ({ raw, ...part }) =>
      line({ part: { ...part, text: await decompressText(raw) } }),
    ),
  );

  const file = new Blob([
    line(header),
    read.settings ? line({ settings: chosenSettings(read.settings) }) : "",
    lines(read.sources, (source) => ({ source })),
    ...parts,
    ...read.links,
    lines(read.annotations, (annotation) => ({ annotation })),
  ])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const gzipped = await new Response(file).arrayBuffer();
  return {
    file: new Blob([gzipped], { type: "application/gzip" }),
    counts,
  };
}
