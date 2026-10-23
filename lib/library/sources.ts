// Renaming and deleting sources (PRD §6.4).
import type { LinkVaultDb } from "@/lib/db/schema";

export const MAX_SOURCE_NAME = 200;

export class SourceNameError extends Error {
  constructor(readonly reason: "empty" | "too-long") {
    super(reason);
    this.name = "SourceNameError";
  }
}

// A name as it will be kept: trimmed, inner whitespace collapsed.
export function cleanSourceName(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean === "") throw new SourceNameError("empty");
  if (clean.length > MAX_SOURCE_NAME) throw new SourceNameError("too-long");
  return clean;
}

// A rename touches only the source row: names reach the list from the live
// sources table, so the rows aren't read again (updatedAt stays as it is).
export async function renameSource(
  db: LinkVaultDb,
  sourceId: string,
  name: string,
): Promise<void> {
  const clean = cleanSourceName(name);
  const updated = await db.sources.update(sourceId, { name: clean });
  if (updated === 0) throw new Error(`No source ${sourceId}`);
}

// The source, its stored parts and its links, in one transaction: all of it
// goes or none does. Stars and other annotations stay, keyed by urlKey, and
// come back to the link if it's imported again (§4.4). Runs in the worker,
// since a large source is tens of thousands of rows.
export async function deleteSource(
  db: LinkVaultDb,
  sourceId: string,
): Promise<{ links: number }> {
  return db.transaction(
    "rw",
    db.sources,
    db.sourceParts,
    db.links,
    async () => {
      if (!(await db.sources.get(sourceId))) {
        throw new Error(`No source ${sourceId}`);
      }
      // Dexie tells the page every deleted key once this commits, which for
      // ~100 k links costs the page one pause of about 70 ms (§8.6).
      // Deleting by id instead measured slower (5.9 s against 4.5 s at
      // 98 k) and sent as much.
      const links = await db.links.where("sourceId").equals(sourceId).delete();
      await db.sourceParts.where("sourceId").equals(sourceId).delete();
      await db.sources.delete(sourceId);
      return { links };
    },
  );
}
