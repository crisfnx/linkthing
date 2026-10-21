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
