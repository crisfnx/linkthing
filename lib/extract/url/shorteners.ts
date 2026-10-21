// Links that only redirect somewhere else (PRD §4.7, Appendix B). youtu.be is
// left out: its target is known from the path, so urlKey resolves it.
const SHORTENER_HOSTS = new Set([
  "t.co",
  "bit.ly",
  "tinyurl.com",
  "goo.gl",
  "maps.app.goo.gl",
  "g.co",
  "share.google",
  "search.app",
  "lnkd.in",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "rebrand.ly",
  "cutt.ly",
  "amzn.to",
  "amzn.eu",
  "fb.me",
]);

// Share links on sites that otherwise have real paths.
const SHARE_PATHS: Array<[domain: string, path: RegExp]> = [
  ["reddit.com", /^\/(?:r|u|user)\/[^/]+\/s\/[^/]+\/?$/],
  ["facebook.com", /^\/share\//],
];

export function isShortened(hostname: string, path: string): boolean {
  const host = hostname.replace(/^www\./, "");
  if (SHORTENER_HOSTS.has(host)) return true;
  return SHARE_PATHS.some(
    ([domain, pattern]) =>
      (host === domain || host.endsWith(`.${domain}`)) && pattern.test(path),
  );
}
