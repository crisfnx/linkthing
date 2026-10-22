import { adapterFor } from "./adapters";
import {
  contextAround,
  isLittleMoreThanLinks,
  nearbyText,
  textBesideLinks,
  type MessageNote,
} from "./context";
import { linkId } from "./keys";
import type {
  AdapterOptions,
  Link,
  Message,
  SourceKind,
  SourceStats,
  TrackingParam,
} from "./types";
import { describeUrl } from "./url/describe";
import { extractUrls, type ExtractOptions, type FoundUrl } from "./url/extract";
import { countNonWebLinks } from "./url/find";
import { DEFAULT_TRACKING_PARAMS } from "./url/tracking-params";

export interface PipelineOptions extends AdapterOptions, ExtractOptions {
  trackingParams?: readonly TrackingParam[];
}

export interface PipelineResult {
  links: Link[];
  stats: SourceStats;
}

// Line and column of a link inside the message's text. The column counts from
// the start of the message's line of text, after any chat header.
function positionOf(message: Message, found: FoundUrl): Link["position"] {
  const before = message.text.slice(0, found.index);
  const lineBreaks = before.split("\n").length - 1;
  return {
    line: message.lineStart + lineBreaks,
    column: found.index - (before.lastIndexOf("\n") + 1),
    messageIndex: message.index,
  };
}

function statsOf(messages: Message[], links: Link[]): SourceStats {
  const stats: SourceStats = {
    messages: messages.length,
    links: links.length,
    uniqueLinks: new Set(links.map((link) => link.urlKey)).size,
    domains: new Set(links.map((link) => link.domain)).size,
    skippedNonWeb: messages.reduce((n, m) => n + countNonWebLinks(m.text), 0),
  };
  // A loop, not Math.min(...times): a big chat has more links than a call can
  // take arguments.
  for (const { timestamp } of links) {
    if (timestamp === undefined) continue;
    if (stats.earliest === undefined || timestamp < stats.earliest) {
      stats.earliest = timestamp;
    }
    if (stats.latest === undefined || timestamp > stats.latest) {
      stats.latest = timestamp;
    }
  }
  return stats;
}

export interface LinkCount {
  message: Pick<Message, "key" | "index">;
  count: number;
}

// How many links each message holds: enough for the ids extractLinks would
// give them, without describing a single URL. The import scan compares those
// ids with a stored chat's to spot a newer export of it (§6.1).
export function linkCounts(
  text: string,
  kind: SourceKind,
  options: PipelineOptions = {},
): LinkCount[] {
  const counts: LinkCount[] = [];
  for (const message of adapterFor(kind).parse({ text }, options)) {
    const count = extractUrls(message.text, options).length;
    if (count > 0) counts.push({ message, count });
  }
  return counts;
}

export function linkIdsFor(sourceId: string, counts: LinkCount[]): string[] {
  return counts.flatMap(({ message, count }) =>
    Array.from({ length: count }, (_, occurrence) =>
      linkId(sourceId, message, occurrence),
    ),
  );
}

// detect → parse → extract → Link[] (PRD §4). Pure: the worker calls it and
// writes the result in one transaction (§8.2).
export function extractLinks(
  text: string,
  sourceId: string,
  kind: SourceKind,
  options: PipelineOptions = {},
): PipelineResult {
  const rules = options.trackingParams ?? DEFAULT_TRACKING_PARAMS;
  const messages = adapterFor(kind).parse({ text }, options);
  const notes: MessageNote[] = messages.map((message) => {
    const found = extractUrls(message.text, options);
    return { found, rest: textBesideLinks(message.text, found) };
  });

  const links: Link[] = [];
  messages.forEach((message, i) => {
    const note = notes[i];
    if (!note || note.found.length === 0) return;
    const nearby = isLittleMoreThanLinks(note.rest, note.found)
      ? nearbyText(messages, notes, i)
      : undefined;

    note.found.forEach((found, occurrence) => {
      const link: Link = {
        id: linkId(sourceId, message, occurrence),
        sourceId,
        url: found.url,
        ...describeUrl(found.url, rules),
        position: positionOf(message, found),
      };
      if (message.key !== undefined) link.messageKey = message.key;
      if (note.rest !== "") {
        const context = contextAround(message.text, found.index, found.length);
        if (context !== undefined) link.context = context;
      }
      if (nearby !== undefined) link.nearby = nearby;
      if (message.timestamp !== undefined) link.timestamp = message.timestamp;
      if (message.sender !== undefined) link.sender = message.sender;
      if (found.bare) link.isBare = true;
      links.push(link);
    });
  });

  return { links, stats: statsOf(messages, links) };
}
