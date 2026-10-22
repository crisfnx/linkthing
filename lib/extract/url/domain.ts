import { getDomain } from "tldts";

// Registrable domains that are the same service, merged for display grouping
// only (PRD §4.5, Appendix B). `host` keeps the real one.
const ALIASES: Record<string, string> = {
  "x.com": "twitter.com",
  "fxtwitter.com": "twitter.com",
  "vxtwitter.com": "twitter.com",
  "youtu.be": "youtube.com",
  "fb.com": "facebook.com",
  "redd.it": "reddit.com",
};

// m.youtube.com → youtube.com; foo.github.io stays foo.github.io. IPs and
// localhost have no registrable domain, so they stand for themselves.
export function registrableDomain(hostname: string): string {
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;
}

export function domainOf(hostname: string): string {
  const domain = registrableDomain(hostname);
  return ALIASES[domain] ?? domain;
}

// Every name a grouped domain goes by, so a search for "x.com" or "youtu.be"
// finds links grouped as twitter.com or youtube.com, and the other way round
// (PRD §6.3).
export function aliasesOf(domain: string): string[] {
  return [
    domain,
    ...Object.keys(ALIASES).filter((alias) => ALIASES[alias] === domain),
  ];
}

// The mirrors in Appendix B that are hosts of the same registrable domain:
// a search for any of them finds the whole group too.
const MIRROR_HOSTS: Record<string, string[]> = {
  "twitter.com": ["mobile.twitter.com"],
  "youtube.com": ["m.youtube.com", "www.youtube.com", "music.youtube.com"],
  "reddit.com": [
    "old.reddit.com",
    "np.reddit.com",
    "www.reddit.com",
    "v.redd.it",
    "i.redd.it",
  ],
  "facebook.com": ["m.facebook.com"],
};

// Every name a link can be searched by (§6.3, Appendix B): its domain's
// aliases and mirror hosts, and for Wikipedia its language's mobile host.
export function searchNamesOf(domain: string, host: string): string[] {
  const names = [...aliasesOf(domain), ...(MIRROR_HOSTS[domain] ?? [])];
  const wiki = /^([a-z-]+)\.(?:m\.)?wikipedia\.org$/.exec(host);
  if (wiki)
    names.push(`${wiki[1]}.wikipedia.org`, `${wiki[1]}.m.wikipedia.org`);
  return names;
}
