// Persisted records (PRD §5). Times are epoch milliseconds, so records survive
// JSON export and structured clone unchanged.
import type {
  DateOrder,
  SourceKind,
  SourceStats,
  TrackingParam,
} from "@/lib/extract/types";

// No status field: an import is one transaction, so a stored source is
// complete (§8.2).
export interface Source {
  id: string; // crypto.randomUUID()
  name: string; // chat name, file name or "Pasted text, 1 Sep 2026 14:02"
  kind: SourceKind;
  adapterVersion: number;
  importedAt: number; // first import
  updatedAt: number; // last import, update or re-extract (§6.1)
  stats: SourceStats;
  options: { dateOrder?: DateOrder };
}

// One per imported file: a chat updated twice has three.
export interface SourcePart {
  id: string;
  sourceId: string;
  fileName?: string;
  importedAt: number;
  byteSize: number; // decoded text, before compression
  contentHash: string; // SHA-256 of the decoded text
  raw: Blob; // gzipped decoded text, kept for re-extraction
}

// Per-URL rows are keyed by urlKey and also store an as-found url, so they can
// be re-keyed once their links are gone (§4.4).
export interface Annotation {
  urlKey: string;
  url: string;
  starred?: boolean;
  tags?: string[]; // Tag ids
  status?: "unread" | "read" | "archived"; // Phase 3
  note?: string; // Phase 3
  rejectedTags?: string[]; // AI suggestions the user rejected (§6.9)
  updatedAt: number;
}

export interface Tag {
  id: string; // immutable; annotations and classifications reference it
  slug: string; // unique, editable
  name: string;
  aliases: string[];
  description?: string;
  color?: string;
  origin: "user" | "ai";
  createdAt: number;
  updatedAt: number;
}

export interface Classification {
  urlKey: string;
  url: string;
  tags: Array<{ tagId: string; confidence: number }>;
  tagIds: string[]; // flattened for the multi-entry index
  proposedTags?: string[];
  summary?: string; // single-link "Suggest tags" runs only
  inputHash: string; // hash of what was sent; re-run only when it changes
  model: string;
  promptVersion: number;
  classifiedAt: number;
}

export interface Enrichment {
  urlKey: string;
  url: string;
  fetchedAt: number;
  status: "ok" | "no-metadata" | "dead" | "blocked" | "error";
  httpStatus?: number;
  finalUrl?: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string; // URL only; bytes are never stored
  imageWidth?: number;
  imageHeight?: number;
  favicon?: string;
  ogType?: string;
  publishedAt?: number;
  provider: "oembed" | "og" | "twitter" | "html" | "derived";
}

export interface Settings {
  key: "settings";
  theme: "system" | "light" | "dark";
  defaultDateOrder: "DMY" | "MDY";
  trackingParams: TrackingParam[]; // built-in rules; editable from Phase 1.5
  showCanonicalUrls: boolean;
  dedupeByDefault: boolean;
  previews: "off" | "icons" | "full";
  autoFetchPreviews: boolean;
  ai: {
    mode: "off" | "own-key";
    model: string;
    includeContext: boolean;
    rememberKey: boolean;
  };
}

export interface Meta {
  key: "meta";
  canonicalizerVersion: number; // last version applied to stored links (§4.4)
}
