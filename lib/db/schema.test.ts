import Dexie from "dexie";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Link } from "@/lib/extract/types";
import { createDb, type LinkVaultDb } from "./schema";
import type {
  Annotation,
  Classification,
  Enrichment,
  Meta,
  Settings,
  Source,
  SourcePart,
  Tag,
} from "./types";

const now = Date.UTC(2026, 9, 21);

const source: Source = {
  id: "source-1",
  name: "WhatsApp Chat with Me",
  kind: "whatsapp",
  adapterVersion: 1,
  importedAt: now,
  updatedAt: now,
  stats: {
    messages: 1,
    links: 1,
    uniqueLinks: 1,
    domains: 1,
    skippedNonWeb: 0,
  },
  options: { dateOrder: "DMY" },
};

const part: SourcePart = {
  id: "part-1",
  sourceId: source.id,
  fileName: "WhatsApp Chat with Me.txt",
  importedAt: now,
  byteSize: 11,
  contentHash: "abc123",
  raw: new Blob(["hello world"]),
};

const link: Link = {
  id: "link-1",
  sourceId: source.id,
  messageKey: "message-1",
  url: "https://example.com/a?utm_source=x",
  canonicalUrl: "https://example.com/a",
  urlKey: "https://example.com/a",
  host: "example.com",
  domain: "example.com",
  path: "/a",
  kind: "other",
  isShortened: false,
  position: { line: 1, column: 0, messageIndex: 0 },
};

const annotation: Annotation = {
  urlKey: link.urlKey,
  url: link.url,
  starred: 1,
  tags: ["tag-1"],
  updatedAt: now,
};

const tag: Tag = {
  id: "tag-1",
  slug: "recipes",
  name: "Recipes",
  aliases: ["recipe"],
  origin: "user",
  createdAt: now,
  updatedAt: now,
};

const classification: Classification = {
  urlKey: link.urlKey,
  url: link.url,
  tags: [{ tagId: tag.id, confidence: 0.9 }],
  tagIds: [tag.id],
  inputHash: "hash",
  model: "test-model",
  promptVersion: 1,
  classifiedAt: now,
};

const enrichment: Enrichment = {
  urlKey: link.urlKey,
  url: link.url,
  fetchedAt: now,
  status: "ok",
  title: "Example",
  provider: "og",
};

const settings: Settings = {
  key: "settings",
  theme: "system",
  defaultDateOrder: "DMY",
  trackingParams: [{ param: "utm_*" }],
  findBareDomains: true,
  showCanonicalUrls: true,
  dedupeByDefault: false,
  previews: "off",
  autoFetchPreviews: false,
  ai: { mode: "off", model: "", includeContext: true, rememberKey: false },
};

const meta: Meta = { key: "meta", canonicalizerVersion: 1 };

const opened: Dexie[] = [];

function freshDb(onUpgradeElsewhere?: () => void): LinkVaultDb {
  const db = createDb(`test-${crypto.randomUUID()}`, onUpgradeElsewhere);
  opened.push(db);
  return db;
}

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

describe("the schema", () => {
  test("opens with every table from the data model", async () => {
    const db = freshDb();
    await db.open();

    expect(db.tables.map((table) => table.name).sort()).toEqual([
      "annotations",
      "classifications",
      "enrichments",
      "links",
      "settings",
      "sourceParts",
      "sources",
      "tags",
    ]);
  });

  test("writes and reads a row in each table", async () => {
    const db = freshDb();

    await db.sources.put(source);
    await db.sourceParts.put(part);
    await db.links.put(link);
    await db.annotations.put(annotation);
    await db.tags.put(tag);
    await db.classifications.put(classification);
    await db.enrichments.put(enrichment);
    await db.settings.bulkPut([settings, meta]);

    expect(await db.sources.get(source.id)).toEqual(source);
    expect(await db.links.get(link.id)).toEqual(link);
    expect(await db.annotations.get(link.urlKey)).toEqual(annotation);
    expect(await db.tags.get(tag.id)).toEqual(tag);
    expect(await db.classifications.get(link.urlKey)).toEqual(classification);
    expect(await db.enrichments.get(link.urlKey)).toEqual(enrichment);
    expect(await db.settings.get("settings")).toEqual(settings);
    expect(await db.settings.get("meta")).toEqual(meta);

    const storedPart = await db.sourceParts.get(part.id);
    expect(await storedPart?.raw.text()).toBe("hello world");
  });

  test("indexes support the lookups the app relies on", async () => {
    const db = freshDb();
    await db.links.put(link);
    await db.annotations.put(annotation);
    await db.tags.put(tag);

    expect(await db.links.where("sourceId").equals(source.id).count()).toBe(1);
    expect(await db.links.where("urlKey").equals(link.urlKey).count()).toBe(1);
    expect(await db.annotations.where("tags").equals(tag.id).count()).toBe(1);
    await expect(db.tags.add({ ...tag, id: "tag-2" })).rejects.toThrow();
  });
});

describe("schema v2", () => {
  test("stars stored as true become 1 and reach the starred index; false goes", async () => {
    const name = `test-${crypto.randomUUID()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ annotations: "urlKey, starred, *tags" });
    await v1.table("annotations").bulkPut([
      { urlKey: "a", url: "https://a.example", starred: true, updatedAt: 1 },
      {
        urlKey: "b",
        url: "https://b.example",
        starred: false,
        tags: ["tag-1"],
        updatedAt: 1,
      },
    ]);
    v1.close();

    const db = createDb(name);
    opened.push(db);
    expect(await db.annotations.get("a")).toMatchObject({ starred: 1 });
    expect(await db.annotations.get("b")).not.toHaveProperty("starred");
    expect(
      await db.annotations.where("starred").equals(1).primaryKeys(),
    ).toEqual(["a"]);
  });
});

describe("an upgrade from another tab", () => {
  test("closes this connection and asks for a reload", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onUpgradeElsewhere = vi.fn();
    const db = freshDb(onUpgradeElsewhere);
    await db.open();

    const newerTab = new Dexie(db.name);
    newerTab.version(3).stores({ sources: "id, importedAt, updatedAt" });
    await newerTab.open();
    newerTab.close();

    expect(onUpgradeElsewhere).toHaveBeenCalledOnce();
    expect(db.isOpen()).toBe(false);
  });
});
