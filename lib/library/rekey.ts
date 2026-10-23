// Re-keying after the canonicalizer changes (PRD §4.4). Every stored link's
// URL fields are worked out again from its as-found url, and the per-URL rows
// (annotations, enrichments, classifications) follow their links to the new
// keys: several old keys can merge into one, one can split into several, and
// a row whose links are gone is re-keyed from its own url. Runs in the worker,
// once, before anything reads the library.
import type { LinkVaultDb } from "@/lib/db/schema";
import type {
  Annotation,
  Classification,
  Enrichment,
  Meta,
} from "@/lib/db/types";
import type { Link } from "@/lib/extract/types";
import { CANONICALIZER_VERSION } from "@/lib/extract/url/canonicalize";
import { describeUrl, type UrlFields } from "@/lib/extract/url/describe";

export interface Canonicalizer {
  version: number;
  describe: (url: string) => UrlFields;
}

// From Phase 1.5 the user's tracking-param rules join the default ones here.
export const CURRENT_CANONICALIZER: Canonicalizer = {
  version: CANONICALIZER_VERSION,
  describe: (url) => describeUrl(url),
};

// Libraries from before the meta row was written were keyed by version 1,
// the only one there was.
const FIRST_VERSION = 1;

const URL_FIELDS = [
  "canonicalUrl",
  "urlKey",
  "host",
  "domain",
  "path",
  "kind",
  "isShortened",
] as const satisfies readonly (keyof UrlFields)[];

export interface Rekeyed {
  from: number;
  to: number;
  links: number; // links whose URL fields changed
  moved: number; // per-URL rows written under a new key, or merged
}

function isMeta(row: unknown): row is Meta {
  return (row as { key?: unknown } | undefined)?.key === "meta";
}

type Keyed = { urlKey: string; url: string };

// A star or a tag is something the user did, so a merge keeps all of them;
// for the rest of an annotation the newest row wins (§4.4).
function mergeAnnotations(a: Annotation, b: Annotation): Annotation {
  const [older, newer] = a.updatedAt <= b.updatedAt ? [a, b] : [b, a];
  const merged: Annotation = { ...older, ...newer };
  const union = (x?: string[], y?: string[]) =>
    x || y ? [...new Set([...(x ?? []), ...(y ?? [])])] : undefined;
  const tags = union(a.tags, b.tags);
  const rejected = union(a.rejectedTags, b.rejectedTags);
  if (tags) merged.tags = tags;
  if (rejected) merged.rejectedTags = rejected;
  if (a.starred || b.starred) merged.starred = 1;
  return merged;
}

const newest =
  <T>(time: (row: T) => number) =>
  (a: T, b: T): T =>
    time(b) > time(a) ? b : a;

// Brings stored links and per-URL rows up to the canonicalizer's version, in
// one transaction: a failure part-way leaves the library as it was, and a
// second tab doing the same waits, then finds nothing to do. Null when the
// library was already up to date.
export async function rekeyIfNeeded(
  db: LinkVaultDb,
  { version, describe }: Canonicalizer = CURRENT_CANONICALIZER,
  pageSize = 10_000,
): Promise<Rekeyed | null> {
  return db.transaction(
    "rw",
    [
      db.settings,
      db.sources,
      db.links,
      db.annotations,
      db.enrichments,
      db.classifications,
    ],
    async () => {
      // A URL the canonicalizer can't read keeps what it has, rather than
      // failing the whole re-key on every load.
      const read = (url: string): UrlFields | null => {
        try {
          return describe(url);
        } catch {
          return null;
        }
      };

      const meta = await db.settings.get("meta");
      const from = isMeta(meta) ? meta.canonicalizerVersion : FIRST_VERSION;
      const current: Meta = { key: "meta", canonicalizerVersion: version };
      if (from === version) {
        if (!isMeta(meta)) await db.settings.put(current);
        return null;
      }

      // Each old key's new keys, as its links now have them, and an as-found
      // URL for each new key, for the rows that land there.
      const keysOf = new Map<string, string | Set<string>>();
      const urlFor = new Map<string, string>();
      const perSource = new Map<
        string,
        { keys: Set<string>; domains: Set<string> }
      >();
      let changedLinks = 0;

      // A page at a time, as the rows are read (§5): a large library isn't
      // held as full records all at once. Ids don't depend on the URL, so
      // writing a page doesn't move the next one.
      let after: string | undefined;
      for (;;) {
        const page = await (
          after === undefined
            ? db.links.toCollection()
            : db.links.where(":id").above(after)
        )
          .limit(pageSize)
          .toArray();
        const changed: Link[] = [];
        for (const link of page) {
          const fields = read(link.url) ?? link;
          if (URL_FIELDS.some((field) => link[field] !== fields[field])) {
            changed.push({ ...link, ...fields });
          }
          const known = keysOf.get(link.urlKey);
          if (known === undefined) keysOf.set(link.urlKey, fields.urlKey);
          else if (typeof known === "string") {
            if (known !== fields.urlKey) {
              keysOf.set(link.urlKey, new Set([known, fields.urlKey]));
            }
          } else known.add(fields.urlKey);
          if (!urlFor.has(fields.urlKey)) urlFor.set(fields.urlKey, link.url);
          let source = perSource.get(link.sourceId);
          if (!source) {
            source = { keys: new Set(), domains: new Set() };
            perSource.set(link.sourceId, source);
          }
          source.keys.add(fields.urlKey);
          source.domains.add(fields.domain);
        }
        if (changed.length > 0) await db.links.bulkPut(changed);
        changedLinks += changed.length;
        if (page.length < pageSize) break;
        after = page.at(-1)!.id;
      }

      // Merges change how many distinct links and sites a source has.
      for (const source of await db.sources.toArray()) {
        const now = perSource.get(source.id);
        if (!now) continue;
        const { uniqueLinks, domains } = source.stats;
        if (uniqueLinks === now.keys.size && domains === now.domains.size) {
          continue;
        }
        await db.sources.update(source.id, {
          stats: {
            ...source.stats,
            uniqueLinks: now.keys.size,
            domains: now.domains.size,
          },
        });
      }

      // Where a row goes: wherever its links went, or, with no links left,
      // where its own as-found URL leads.
      const destinations = (row: Keyed): string[] => {
        const known = keysOf.get(row.urlKey);
        if (known === undefined) return [read(row.url)?.urlKey ?? row.urlKey];
        return typeof known === "string" ? [known] : [...known];
      };

      async function move<T extends Keyed>(
        table: { toArray(): Promise<T[]> } & {
          bulkDelete(keys: string[]): Promise<void>;
          bulkPut(rows: T[]): Promise<unknown>;
        },
        merge: (a: T, b: T) => T,
      ): Promise<number> {
        const rows = await table.toArray();
        const unchanged = new Set<T>();
        const landing = new Map<string, T>();
        for (const row of rows) {
          for (const key of destinations(row)) {
            const arriving =
              key === row.urlKey
                ? row
                : { ...row, urlKey: key, url: urlFor.get(key) ?? row.url };
            const there = landing.get(key);
            landing.set(
              key,
              there ? { ...merge(there, arriving), urlKey: key } : arriving,
            );
          }
        }
        // A row that stays where it was, alone, needs no write.
        for (const row of rows) {
          if (landing.get(row.urlKey) === row) unchanged.add(row);
        }
        const gone = rows
          .map((row) => row.urlKey)
          .filter((key) => !landing.has(key));
        const written = [...landing.values()].filter(
          (row) => !unchanged.has(row),
        );
        await table.bulkDelete(gone);
        await table.bulkPut(written);
        return written.length;
      }

      const moved =
        (await move<Annotation>(db.annotations, mergeAnnotations)) +
        (await move<Enrichment>(
          db.enrichments,
          newest((row) => row.fetchedAt),
        )) +
        (await move<Classification>(
          db.classifications,
          newest((row) => row.classifiedAt),
        ));

      await db.settings.put(current);
      return { from, to: version, links: changedLinks, moved };
    },
  );
}
