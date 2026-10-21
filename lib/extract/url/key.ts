// Hosts that serve the same page at the same path (PRD Appendix B).
const MIRRORS: Record<string, string> = {
  "x.com": "twitter.com",
  "mobile.twitter.com": "twitter.com",
  "fxtwitter.com": "twitter.com",
  "vxtwitter.com": "twitter.com",
  "m.youtube.com": "youtube.com",
  "old.reddit.com": "reddit.com",
  "np.reddit.com": "reddit.com",
  "m.facebook.com": "facebook.com",
  "fb.com": "facebook.com",
};
const MOBILE_WIKIPEDIA = /^([a-z-]+)\.m\.wikipedia\.org$/;

// X ignores the username in a tweet URL: /<user>/status/<id>, /i/status/<id>
// and /i/web/status/<id> are one tweet.
const TWEET = /^\/(?:i\/web|[^/]+)\/status\/(\d+)(?:\/.*)?$/;
const SHORTS = /^\/shorts\/([^/]+)\/?$/;

// The identity used for dedupe and by every per-URL table (PRD §4.4). Never
// shown, so it can be rebuilt freely: https, no `www.`, mirrors folded, no
// fragment (except hash routes), no trailing slash, sorted parameters.
export function toUrlKey(canonicalUrl: string): string {
  const url = new URL(canonicalUrl);
  const params = new URLSearchParams(url.search);
  let hostname = url.hostname.replace(/^www\./, "");
  hostname =
    MIRRORS[hostname] ?? hostname.replace(MOBILE_WIKIPEDIA, "$1.wikipedia.org");
  let path = url.pathname;

  if (hostname === "twitter.com") path = path.replace(TWEET, "/i/status/$1");

  const shortsId = hostname === "youtube.com" ? SHORTS.exec(path)?.[1] : null;
  const shortLinkId = hostname === "youtu.be" ? path.split("/")[1] : null;
  const videoId = shortsId ?? shortLinkId;
  if (videoId) {
    hostname = "youtube.com";
    path = "/watch";
    params.set("v", videoId);
  }

  path = path.replace(/\/+$/, "");
  params.sort();
  const query = params.toString();
  const port = url.port ? `:${url.port}` : "";
  const hash = /^#[!/]/.test(url.hash) ? url.hash : "";

  return `https://${hostname}${port}${path}${query ? `?${query}` : ""}${hash}`;
}
