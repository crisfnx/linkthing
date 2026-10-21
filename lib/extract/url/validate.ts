import { parse } from "tldts";

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const TWO_LABELS = /^[^.]+(?:\.[^.]+)+\.?$/;
const TEMPLATE = /\$\{|\{\{/;

// Domain endings that are also file extensions (design.md, setup.sh) or code
// words (user.name, item.id). A bare domain ending in one needs a path to
// count (allegro.pl/oferta/1 does; readme.pl doesn't). Endings real sites use
// bare (.ai, .app, .so for notion.so, .info, .page) are deliberately left out.
const AMBIGUOUS_ENDINGS = new Set([
  ...["md", "sh", "py", "rs", "pl", "pm", "cc", "mm", "java", "ps"],
  ...["zip", "mov", "gd", "mk", "ml", "sc", "gs"],
  ...["name", "id", "style", "host", "click", "show", "run", "new"],
  ...["global", "data", "map", "events", "menu", "email", "group"],
]);

// Whether a repaired candidate is a web address worth storing (PRD §4.3).
export function isWebUrl(candidate: string): boolean {
  // Code pasted into a chat: `https://api.example.com/users/${id}`.
  if (TEMPLATE.test(candidate)) return false;

  let url: URL;
  try {
    url = new URL(candidate); // not URL.canParse: it needs Safari 17
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname;
  return (
    host === "localhost" ||
    host.startsWith("[") || // IPv6
    IPV4.test(host) ||
    TWO_LABELS.test(host)
  );
}

// Whether a bare match (no scheme, no www.) is a real domain (PRD §4.1): its
// ending is on the public suffix list, and it isn't an ambiguous ending
// without a path.
export function isBareDomain(hostname: string, hasPath: boolean): boolean {
  const host = hostname.toLowerCase();
  const { isIcann, domain } = parse(host);
  if (!isIcann || !domain) return false;
  const ending = host.slice(host.lastIndexOf(".") + 1);
  return hasPath || !AMBIGUOUS_ENDINGS.has(ending);
}
