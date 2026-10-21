import type { LinkKind } from "@/lib/extract/types";

// Cheap, URL-only heuristics (PRD §4.6, Appendix B). Looked up by host and then
// by each parent domain, so v.redd.it and music.youtube.com can differ from
// their parents and abc.notion.site still finds notion.site.
const BY_HOST: Record<string, LinkKind> = {
  "v.redd.it": "video",
  "i.redd.it": "image",
  "music.youtube.com": "audio",
  "docs.google.com": "document",
  "podcasts.apple.com": "audio",

  "youtube.com": "video",
  "youtu.be": "video",
  "vimeo.com": "video",
  "twitch.tv": "video",
  "tiktok.com": "video",
  "loom.com": "video",

  "twitter.com": "social",
  "x.com": "social",
  "fxtwitter.com": "social",
  "vxtwitter.com": "social",
  "instagram.com": "social",
  "threads.net": "social",
  "threads.com": "social",
  "bsky.app": "social",
  "reddit.com": "social",
  "facebook.com": "social",
  "fb.com": "social",
  "linkedin.com": "social",

  "github.com": "code",
  "gitlab.com": "code",
  "codesandbox.io": "code",
  "stackblitz.com": "code",
  "npmjs.com": "code",
  "crates.io": "code",
  "pypi.org": "code",

  "imgur.com": "image",
  "notion.site": "document",
  "spotify.com": "audio",
  "soundcloud.com": "audio",
};

const BY_EXTENSION: Record<string, LinkKind> = {
  mp4: "video",
  webm: "video",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  pdf: "document",
  docx: "document",
  pptx: "document",
  mp3: "audio",
};

// A Mastodon-style status: /@user/<numeric id>. Medium's /@user/<slug> is not.
const MASTODON_STATUS = /^\/@[^/]+\/\d+\/?$/;

function byHost(hostname: string): LinkKind | undefined {
  for (let host = hostname; host.includes(".");) {
    const kind = BY_HOST[host];
    if (kind) return kind;
    host = host.slice(host.indexOf(".") + 1);
  }
  return undefined;
}

export function classify(hostname: string, path: string): LinkKind {
  const extension = /\.([a-z0-9]+)\/?$/i.exec(path)?.[1]?.toLowerCase();
  return (
    byHost(hostname) ??
    (extension ? BY_EXTENSION[extension] : undefined) ??
    (MASTODON_STATUS.test(path) ? "social" : "other")
  );
}
