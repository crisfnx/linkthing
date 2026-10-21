const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const TWO_LABELS = /^[^.]+(?:\.[^.]+)+\.?$/;
const TEMPLATE = /\$\{|\{\{/;

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
