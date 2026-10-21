// Pure types shared by the extraction pipeline, the worker and the database
// (PRD §5). No React, no DOM. Times are epoch milliseconds.

export type SourceKind =
  "plaintext" | "whatsapp" | "markdown" | "netscape" | "html" | "telegram-json";
// zip is a container, not a kind: an iOS export becomes a 'whatsapp' source.

export type DateOrder = "DMY" | "MDY" | "YMD";

export interface SourceStats {
  messages: number;
  links: number;
  uniqueLinks: number;
  domains: number;
  skippedNonWeb: number;
  earliest?: number;
  latest?: number;
}

// In-worker intermediate; not persisted.
export interface Message {
  index: number;
  key?: string; // chat adapters only (§3)
  lineStart: number;
  text: string;
  timestamp?: number;
  sender?: string;
  isSystem?: boolean;
}

export type LinkKind =
  "video" | "social" | "code" | "image" | "document" | "audio" | "other";

export interface Link {
  // Stable hash of (sourceId, message key, occurrence) for chat sources, so
  // updates merge (§6.1); of (sourceId, messageIndex, occurrence) for others.
  id: string;
  sourceId: string;
  messageKey?: string; // chat sources; compared when a newer export arrives
  url: string; // as found, after repair
  canonicalUrl: string; // cleaned, for display and export (§4.4)
  urlKey: string; // identity for dedupe and every per-URL table (§4.4)
  host: string; // m.youtube.com
  domain: string; // youtube.com (registrable, alias-mapped)
  path: string;
  title?: string;
  folder?: string; // bookmark folder path, e.g. "Bookmarks bar › Recipes"
  context?: string; // ≤ 200 chars of the message around the URL (§4.8)
  nearby?: string; // ≤ 200 chars from adjacent same-sender messages (§4.8)
  timestamp?: number;
  sender?: string;
  kind: LinkKind;
  isShortened: boolean;
  position: { line: number; column: number; messageIndex: number };
}
