// Whether a URL is a web address by its scheme alone, for URLs the app didn't
// just extract: those read from a backup, and any it opens or links to. A
// `javascript:` URL there would run in this page. Looser than isWebUrl on
// purpose, so no URL the app itself stored is refused. No imports, so the
// page can use it without loading the domain list.
export function hasWebScheme(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
