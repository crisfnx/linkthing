import Dexie, { type EntityTable } from "dexie";
import type { Link } from "@/lib/extract/types";
import type {
  Annotation,
  Classification,
  Enrichment,
  Meta,
  Source,
  SourcePart,
  StoredSettings,
  Tag,
} from "./types";

export const DB_NAME = "linkvault";

export type LinkVaultDb = Dexie & {
  sources: EntityTable<Source, "id">;
  sourceParts: EntityTable<SourcePart, "id">;
  links: EntityTable<Link, "id">;
  annotations: EntityTable<Annotation, "urlKey">;
  enrichments: EntityTable<Enrichment, "urlKey">;
  tags: EntityTable<Tag, "id">;
  classifications: EntityTable<Classification, "urlKey">;
  settings: EntityTable<StoredSettings | Meta, "key">;
};

export function createDb(
  name = DB_NAME,
  onUpgradeElsewhere?: () => void,
): LinkVaultDb {
  const db = new Dexie(name) as LinkVaultDb;

  db.version(1).stores({
    sources: "id, importedAt",
    // Raw input lives apart from sources so live queries on sources stay small.
    sourceParts: "id, sourceId, contentHash",
    // Filtering runs in memory (§5); each extra index slows every import.
    links: "id, sourceId, urlKey",
    annotations: "urlKey, starred, *tags",
    enrichments: "urlKey, fetchedAt",
    tags: "id, &slug",
    classifications: "urlKey, promptVersion, *tagIds",
    settings: "key", // the 'settings' and 'meta' rows
  });

  // v2: a star is stored as 1. IndexedDB can't index booleans, so v1's
  // `starred: true` never reached the starred index; the Starred filter
  // reads that index.
  db.version(2)
    .stores({ annotations: "urlKey, starred, *tags" })
    .upgrade((tx) =>
      tx
        .table<{ starred?: boolean | 1 }>("annotations")
        .toCollection()
        .modify((annotation) => {
          if (annotation.starred) annotation.starred = 1;
          else delete annotation.starred;
        }),
    );

  // When another tab opens a newer schema, Dexie closes this connection so the
  // upgrade isn't blocked. This tab's code still knows only the old schema, so
  // it has to reload (§8.2).
  db.on("versionchange", (event) => {
    if (event.newVersion) onUpgradeElsewhere?.();
  });

  return db;
}
