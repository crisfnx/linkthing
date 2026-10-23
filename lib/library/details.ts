// What the details drawer shows beyond the row (PRD §6.2): what cleaning took
// out of a URL, where the link sits in its message, and the star (§5,
// Annotation). Runs on the page, for one link at a time.
import type { LinkVaultDb } from "@/lib/db/schema";
import type { Annotation } from "@/lib/db/types";
import type { Link } from "@/lib/extract/types";

function paramNames(url: string): string[] {
  const query = url.split("#")[0]!.split("?")[1];
  if (!query) return [];
  return query
    .split("&")
    .filter(Boolean)
    .map((part) => {
      const name = part.split("=")[0]!;
      try {
        return decodeURIComponent(name.replace(/\+/g, " "));
      } catch {
        return name;
      }
    });
}

// The parameters cleaning removed (§4.4): in the URL as found, not in the
// cleaned one. Sign-in details in the URL count as removed too.
export function removedByCleaning(url: string, canonicalUrl: string): string[] {
  const kept = new Set(paramNames(canonicalUrl));
  const removed = new Set(paramNames(url).filter((name) => !kept.has(name)));
  try {
    const { username, password } = new URL(url);
    if (username || password) removed.add("user:password@");
  } catch {
    // not a URL as written: nothing more to say
  }
  return [...removed];
}

export interface Part {
  text: string;
  link: boolean; // this part is the link itself
}

// The message around the link, split where the link appears so it can be
// marked. Context is cut at 200 characters (§4.8), so the link may run off
// an edge, or be absent: then the text is one plain part.
export function markLink(
  context: string,
  link: Pick<Link, "url" | "canonicalUrl">,
): Part[] {
  const bare = (url: string) => url.replace(/^https?:\/\//i, "");
  for (const candidate of [link.url, link.canonicalUrl, bare(link.url)]) {
    const at = context.indexOf(candidate);
    if (at === -1) continue;
    return [
      { text: context.slice(0, at), link: false },
      { text: candidate, link: true },
      { text: context.slice(at + candidate.length), link: false },
    ].filter((part) => part.text !== "");
  }
  return [{ text: context, link: false }];
}

// Stars are kept by urlKey, so every copy of a link shares one (§4.4).
// Unstarring a link with nothing else on it removes its row.
export async function toggleStar(
  db: LinkVaultDb,
  link: Pick<Link, "urlKey" | "url">,
): Promise<boolean> {
  return db.transaction("rw", db.annotations, async () => {
    const existing = await db.annotations.get(link.urlKey);
    const starred = !existing?.starred;
    const otherwiseEmpty =
      !existing?.tags?.length &&
      !existing?.status &&
      !existing?.note &&
      !existing?.rejectedTags?.length;
    if (!starred && otherwiseEmpty) {
      await db.annotations.delete(link.urlKey);
    } else {
      const next: Annotation = {
        ...existing,
        urlKey: link.urlKey,
        url: existing?.url ?? link.url,
        updatedAt: Date.now(),
      };
      if (starred) next.starred = 1;
      else delete next.starred;
      await db.annotations.put(next);
    }
    return starred;
  });
}

// The urlKeys of every starred link, from the starred index: keys only, so
// a live query on it stays cheap however many links there are.
export async function starredKeys(db: LinkVaultDb): Promise<string[]> {
  return db.annotations.where("starred").equals(1).primaryKeys();
}
