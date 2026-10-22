// Tier 0 of link previews (PRD §6.8): a readable title from the link alone,
// with nothing fetched. The source's own link text wins; then a rule for the
// sites people share most (the owner's export: 46 % X, 17 % Reddit, 8 %
// Instagram, §15); then the URL's most readable path segment
// (`/blog/how-to-ship-fast` → "How to ship fast"). Undefined when the URL
// says nothing a person would read, and the list shows the URL instead.
//
// Titles and display URLs are decoded from percent-encoding, so invisible
// and direction-changing characters are removed: a URL can't make its own
// title read backwards.

export interface TitleInput {
  canonicalUrl: string;
  domain: string; // registrable and alias-mapped: youtu.be → youtube.com
  title?: string; // link text from the source (Markdown, bookmarks, HTML)
  isShortened?: boolean; // bit.ly/ex4mpleCP: the path is a code, not words
}

interface Parts {
  host: string;
  segments: string[]; // decoded, empty ones dropped
  params: URLSearchParams;
}

const MAX_TITLE = 100;

// Bidi controls, zero-width characters and C0/C1 controls.
const INVISIBLE =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

function clean(text: string): string {
  return text.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function truncate(text: string): string {
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1)}…` : text;
}

// "how to ship fast" → "How to ship fast"; "Using IndexedDB" is left alone.
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A canonical URL without its scheme, "www." and trailing slash, decoded for
// reading: "en.wikipedia.org/wiki/Belém_Tower". Hosts stay as they are, in
// punycode where they're written that way (§8.7).
export function displayUrl(canonicalUrl: string): string {
  let text = canonicalUrl.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (text.endsWith("/")) text = text.slice(0, -1);
  try {
    text = decodeURI(text);
  } catch {
    // a malformed escape: show it as written
  }
  return clean(text);
}

// --- The generic rule: the URL's most readable path segment ------------------

const EXTENSION = /\.(?:s?html?|php|aspx?|jsp|cfm)$/i;
const LOCALE_SUFFIX = /\.[a-z]{2}-[a-z]{2}$/i; // example-hotel.en-gb.html

// Segments that name a kind of page, not the page: /p/…, /en-GB/…, /index.
const STRUCTURAL = new Set([
  "a",
  "amp",
  "app",
  "article",
  "articles",
  "c",
  "d",
  "default",
  "dp",
  "e",
  "en",
  "gp",
  "home",
  "i",
  "index",
  "item",
  "p",
  "page",
  "post",
  "posts",
  "r",
  "s",
  "story",
  "u",
  "view",
  "watch",
  "www",
]);

// "Ex4mpLeV1d0", "B0EX4MPLE1", "g189158", "1700000000", "AbCdEfGhIjK": ids,
// not words. Names like "IndexedDB" or "JavaScript" switch case only twice.
function isIdLike(word: string): boolean {
  if (/^\d{5,}$/.test(word)) return true;
  if (/^[a-z]\d{4,}$/i.test(word)) return true;
  const digits = word.replace(/\D/g, "").length;
  if (word.length >= 6 && digits >= 3 && /[a-z]/i.test(word)) return true;
  const caseSwitches = word.match(/[a-z](?=[A-Z])|[A-Z](?=[a-z])/g)?.length;
  return word.length >= 6 && (caseSwitches ?? 0) >= 4;
}

// A short id at the end of a slug: dev.to's "-2abc", Notion's "-3f2a1b".
function isTrailingId(word: string): boolean {
  return /\d/.test(word) && /[a-z]/i.test(word) && word.length >= 3;
}

function isLocale(segment: string): boolean {
  return /^[a-z]{2}(?:[-_][a-z]{2})?$/i.test(segment);
}

function titleFromSegment(segment: string): string | undefined {
  const bare = segment.replace(EXTENSION, "").replace(LOCALE_SUFFIX, "");
  if (STRUCTURAL.has(bare.toLowerCase()) || isLocale(bare)) return undefined;
  const words = bare.split(/[-_+.\s]+/).filter((word) => !isIdLike(word));
  const last = words.at(-1);
  if (words.length >= 3 && last !== undefined && isTrailingId(last)) {
    words.pop();
  }
  const text = clean(words.join(" "));
  // At least one real word: "R p" and "x1" aren't titles.
  if (!/\p{L}{3}/u.test(text)) return undefined;
  return sentence(text);
}

const QUERY_PARAMS = ["q", "query", "search_query", "search", "k"];

function queryOf(params: URLSearchParams): string | undefined {
  for (const name of QUERY_PARAMS) {
    const value = clean(params.get(name) ?? "");
    if (value) return value;
  }
  return undefined;
}

function generic({ segments, params }: Parts): string | undefined {
  let fromPath: string | undefined;
  for (let i = segments.length - 1; i >= 0 && !fromPath; i--) {
    const title = titleFromSegment(segments[i]!);
    // Above an id, one word names the section, not the page: /rooms/0001.
    const section = i < segments.length - 1 && !title?.includes(" ");
    if (!section) fromPath = title;
  }
  // A page about its query (/search?q=…, /travel/flights?q=…) says more by
  // the query than by a one-word path.
  const query = queryOf(params);
  if (query && (!fromPath || !fromPath.includes(" "))) {
    const searching = segments.length === 0 || segments.includes("search");
    return searching ? `Search: ${query}` : sentence(query);
  }
  return fromPath;
}

// --- Rules for the sites shared most ------------------------------------------

type Rule = (parts: Parts) => string | undefined;

const handle = (name: string) => `@${name.replace(/^@/, "")}`;

// "95s", "95", "1m35s", "1h2m3s" → "1:35"
function timestamp(value: string | null): string | undefined {
  if (!value) return undefined;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value);
  if (!match || !value) return undefined;
  const [, h = "0", m = "0", s = "0"] = match;
  const total = Number(h) * 3600 + Number(m) * 60 + Number(s);
  if (total === 0) return undefined;
  const mm = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, "0");
  return total >= 3600
    ? `${Math.floor(total / 3600)}:${String(mm).padStart(2, "0")}:${ss}`
    : `${mm}:${ss}`;
}

const TWITTER_RESERVED = new Set([
  "home",
  "explore",
  "search",
  "intent",
  "share",
  "settings",
  "messages",
  "notifications",
]);

const twitter: Rule = ({ segments: [first, second, , fourth], params }) => {
  if (!first) return undefined;
  if (first === "i") return second === "status" ? "Post on X" : undefined;
  if (first === "hashtag" && second) return `#${second}`;
  if (first === "search") {
    const query = params.get("q");
    return query ? `Search: ${clean(query)}` : undefined;
  }
  if (TWITTER_RESERVED.has(first)) return undefined;
  if (second === "status") {
    if (fourth === "photo") return `Photo by ${handle(first)}`;
    if (fourth === "video") return `Video by ${handle(first)}`;
    return `Post by ${handle(first)}`;
  }
  return handle(first);
};

const youtube: Rule = ({ host, segments: [first, second], params }) => {
  const at = timestamp(params.get("t"));
  const video = (name: string) => (at ? `${name} at ${at}` : name);
  if (host === "music.youtube.com") {
    if (first === "watch") return "YouTube Music track";
    if (first === "playlist") return "YouTube Music playlist";
    return undefined;
  }
  if (host === "youtu.be") return first ? video("YouTube video") : undefined;
  switch (first) {
    case "watch":
      return params.get("v") ? video("YouTube video") : undefined;
    case "shorts":
      return "YouTube Short";
    case "live":
      return "YouTube live stream";
    case "playlist":
      return "YouTube playlist";
    case "results": {
      const query = params.get("search_query");
      return query ? `Search: ${clean(query)}` : undefined;
    }
    case "channel":
      return "YouTube channel";
    case "c":
    case "user":
      return second ? `${second} on YouTube` : undefined;
  }
  if (first?.startsWith("@")) return `${handle(first)} on YouTube`;
  return undefined;
};

const INSTAGRAM_KINDS: Record<string, string> = {
  p: "post",
  reel: "reel",
  reels: "reel",
  tv: "video",
};

const INSTAGRAM_RESERVED = new Set(["accounts", "direct", "explore", "about"]);

const instagram: Rule = ({ segments: [first, second, third] }) => {
  if (!first) return undefined;
  const kind = INSTAGRAM_KINDS[first];
  if (kind) return `Instagram ${kind}`;
  if (first === "stories" && second) return `Story by ${handle(second)}`;
  if (first === "explore" && second === "tags" && third) {
    return `#${third} on Instagram`;
  }
  if (INSTAGRAM_RESERVED.has(first)) return undefined;
  // instagram.com/<user>/p/<id>, newer share links
  const userKind = second ? INSTAGRAM_KINDS[second] : undefined;
  if (userKind) return `${sentence(userKind)} by ${handle(first)}`;
  return `${handle(first)} on Instagram`;
};

const tiktok: Rule = ({ host, segments: [first, second] }) => {
  if (host.startsWith("vm.") || host.startsWith("vt.") || first === "t") {
    return "TikTok video";
  }
  if (!first?.startsWith("@")) return undefined;
  if (second === "video") return `TikTok video by ${handle(first)}`;
  if (second === "photo") return `TikTok photos by ${handle(first)}`;
  return `${handle(first)} on TikTok`;
};

const reddit: Rule = ({ host, segments }) => {
  const [first, second, third, , fifth] = segments;
  if (host === "v.redd.it") return "Reddit video";
  if (host === "redd.it" || host === "i.redd.it") return undefined;
  if ((first === "u" || first === "user") && second) return `u/${second}`;
  if (first !== "r" || !second) return undefined;
  const sub = `r/${second}`;
  if (third === "s") return `Shared post in ${sub}`;
  if (third === "comments") {
    const slug = fifth ? titleFromSegment(fifth) : undefined;
    return slug ? `${slug} · ${sub}` : `Post in ${sub}`;
  }
  if (third === "wiki") return `${sub} wiki`;
  return sub;
};

const GITHUB_RESERVED = new Set([
  "about",
  "collections",
  "explore",
  "features",
  "login",
  "marketplace",
  "orgs",
  "settings",
  "sponsors",
  "topics",
]);

const GITHUB_NUMBERED: Record<string, string> = {
  issues: "issue",
  pull: "pull request",
  discussions: "discussion",
};

const github: Rule = ({ host, segments }) => {
  const [owner, repo, section, item, ...rest] = segments;
  if (host === "gist.github.com") return owner ? `Gist by ${owner}` : undefined;
  if (host !== "github.com" || !owner || GITHUB_RESERVED.has(owner)) {
    return undefined;
  }
  if (!repo) return `${owner} on GitHub`;
  const name = `${owner}/${repo}`;
  const numbered = section ? GITHUB_NUMBERED[section] : undefined;
  if (numbered && item && /^\d+$/.test(item)) {
    return `${name} ${numbered} #${item}`;
  }
  if (section === "commit" && item) return `${name} commit ${item.slice(0, 7)}`;
  if (section === "releases" && item === "tag" && rest[0]) {
    return `${name} ${rest[0]}`;
  }
  if ((section === "blob" || section === "tree") && rest.length > 0) {
    return `${rest.at(-1)} in ${name}`;
  }
  return name;
};

const wikipedia: Rule = ({ segments: [first, article] }) =>
  first === "wiki" && article
    ? clean(article.replace(/_/g, " ")) || undefined
    : undefined;

const SPOTIFY_KINDS = new Set([
  "album",
  "artist",
  "audiobook",
  "episode",
  "playlist",
  "show",
  "track",
]);

const spotify: Rule = ({ segments }) => {
  // open.spotify.com/intl-de/track/…
  const kind = segments.find((segment) => SPOTIFY_KINDS.has(segment));
  return kind ? `Spotify ${kind}` : undefined;
};

const GOOGLE_DOCS: Record<string, string> = {
  document: "Google Doc",
  spreadsheets: "Google Sheet",
  presentation: "Google Slides",
  forms: "Google Form",
};

const google: Rule = ({ host, segments, params }) => {
  const [first, second, third] = segments;
  if (host === "docs.google.com") return first && GOOGLE_DOCS[first];
  if (host === "drive.google.com") {
    if (first === "file") return "Google Drive file";
    if (first === "drive" && second === "folders") return "Google Drive folder";
    return undefined;
  }
  if (first === "maps") {
    if (second === "place" && third) return clean(third.replace(/\+/g, " "));
    if (second === "dir") return "Directions on Google Maps";
    const query = params.get("q");
    return query ? clean(query) : "Google Maps link";
  }
  if (first === "search") {
    const query = params.get("q");
    return query ? `Search: ${clean(query)}` : undefined;
  }
  return undefined;
};

const googleShort: Rule = ({ host, segments: [first] }) => {
  if (host === "maps.app.goo.gl" || first === "maps") return "Google Maps link";
  if (host === "photos.app.goo.gl") return "Google Photos album";
  return undefined;
};

const FACEBOOK_SHARES: Record<string, string> = {
  r: "Facebook reel",
  v: "Facebook video",
  p: "Facebook post",
};

const facebook: Rule = ({ segments: [first, second], params }) => {
  if (first === "share" && second) return FACEBOOK_SHARES[second];
  if (first === "reel") return "Facebook reel";
  if (first === "watch" && params.get("v")) return "Facebook video";
  return undefined;
};

const hackerNews: Rule = ({ host, segments: [first], params }) =>
  host === "news.ycombinator.com" && first === "item" && params.get("id")
    ? "Hacker News discussion"
    : undefined;

const linkedin: Rule = ({ segments: [first, second] }) =>
  first === "in" && second ? `${second} on LinkedIn` : undefined;

// amazon.co.uk/Some-Product-Name/dp/B0…: the words before /dp/.
const amazon: Rule = ({ segments }) => {
  const at = segments.findIndex((s) => s === "dp" || s === "product");
  if (at === -1) return undefined;
  const slug = at > 0 ? titleFromSegment(segments[at - 1]!) : undefined;
  return slug ?? "Amazon product";
};

const RULES: Record<string, Rule> = {
  "twitter.com": twitter,
  "youtube.com": youtube,
  "instagram.com": instagram,
  "tiktok.com": tiktok,
  "reddit.com": reddit,
  "github.com": github,
  "wikipedia.org": wikipedia,
  "spotify.com": spotify,
  "google.com": google,
  "goo.gl": googleShort,
  "facebook.com": facebook,
  "ycombinator.com": hackerNews,
  "linkedin.com": linkedin,
};

function ruleFor(domain: string): Rule | undefined {
  return RULES[domain] ?? (domain.startsWith("amazon.") ? amazon : undefined);
}

function partsOf(canonicalUrl: string): Parts | undefined {
  let url: URL;
  try {
    url = new URL(canonicalUrl);
  } catch {
    return undefined;
  }
  return {
    host: url.hostname,
    segments: url.pathname.split("/").filter(Boolean).map(decode),
    params: url.searchParams,
  };
}

export function deriveTitle({
  canonicalUrl,
  domain,
  title,
  isShortened,
}: TitleInput): string | undefined {
  const own = title && clean(title);
  if (own) return truncate(own);
  const parts = partsOf(canonicalUrl);
  if (!parts) return undefined;
  // A site's rule first: it knows maps.app.goo.gl even though that's a
  // shortener. Other shorteners have nothing readable in the path.
  const derived =
    ruleFor(domain)?.(parts) || (isShortened ? undefined : generic(parts));
  return derived ? truncate(clean(derived)) : undefined;
}
