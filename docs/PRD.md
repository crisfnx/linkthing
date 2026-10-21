# LinkVault — Product Requirements Document (v2)

| | |
|---|---|
| **Project** | LinkVault (working name; repo: `linkthing`) |
| **One-liner** | Drop in any text — chat exports, notes, markdown, bookmark files — and get every link back, organized, searchable and yours. |
| **Owner** | Cris Vlasiu |
| **Created** | September 2026 (v1: WhatsApp Link Extractor) |
| **Updated** | 21 October 2026 (v2.7: URL identity rules from M1; see Document history) |
| **Status** | Planning / pre-development |

---

## 0. What changed from v1

v1 was a WhatsApp-only link extractor. v2 keeps the same soul (rescue links buried in text, keep everything on-device) and widens the front door.

| Area | v1 | v2 |
|---|---|---|
| Input | WhatsApp `.txt` export only | Any text: plain text, WhatsApp (Android `.txt`, iOS `.zip`, all locales), Markdown, HTML / browser bookmark exports; more adapters later (Telegram, Slack, email, CSV) |
| Parsing | One hard-coded format | **Source adapters** behind a common interface, with auto-detection and manual override |
| URL handling | Single regex | Extraction + trailing-punctuation repair + validation + **canonicalization** (tracking-param stripping) + registrable-domain grouping + light content-type classification |
| Metadata | timestamp + sender | timestamp and sender when the source has them; always: source, line/position, surrounding context, link text/title when present |
| Storage | localStorage (5 MB cap) | **IndexedDB via Dexie** from day one; raw input kept so links can be re-extracted when adapters improve |
| Processing | On the main thread | **Web Worker** with progress; UI never blocks |
| Stack | Next.js 15, hooks + `useMemo` | Next.js 16.3 (Turbopack, React Compiler), React 19.2, Tailwind v4, Vitest with a fixture corpus |
| Lists | Plain DOM | Virtualized (tens of thousands of links stay smooth) |
| Export | JSON backup | JSON backup, CSV, Markdown, Netscape bookmarks HTML (importable to any browser / Raindrop), plain list, clipboard |
| Link previews | — (a Phase 2 line item) | Designed in now (§6.8): derived titles in the MVP; opt-in favicons, thumbnails, full Open Graph / oEmbed previews through our own preview service, and a card view in milestone M7, right after tags |
| Categories | "AI-powered auto-categorization", one Phase 4 bullet | Specified (§6.9): tags as a first-class object with a user-curated vocabulary; search that understands tags and site names ("recipes from twitter"); AI-assisted discovery and tagging in two reviewable passes with the user's own key (a hosted mode waits for accounts) |

---

## 1. Summary

### Problem

People use chats, notes and documents as "save for later" bins. Links end up buried in WhatsApp threads with themselves, in Telegram "Saved Messages", in Apple Notes exports, in meeting notes, in old bookmark files. Getting them back means scrolling or grepping. The information is there; the organization is not.

### Solution

A local-first web app: paste or drop text, get every URL out with whatever context the source carries (when it was sent, by whom, the sentence around it), grouped by domain, searchable, sortable, exportable. No account, no upload of your text to anyone.

### Target users

- **Primary:** individuals who send links to themselves (WhatsApp, Telegram, Signal, Slack DMs, notes) and want them back as a usable list.
- **Secondary:** anyone with a text blob that contains links: a group chat archive, a research doc, a newsletter archive, an old bookmarks file.

### Jobs to be done

1. "I have this export / document. Show me every link in it, fast."
2. "Find the thing I saved about X months ago."
3. "Get these links out of here and into my bookmarks / Raindrop / a markdown file."
4. "Tell me what I actually hoard: which sites, how many, when."
5. "Show me everything about recipes, including the ones I saved from Twitter."

### Non-goals (for now)

- Not a bookmark manager you save into daily (Phase 3+ may add a PWA share target).
- Not a read-it-later reader.
- No accounts, sync or server-side storage in the MVP.
- No page fetching in the MVP build. Link previews need a server (see §6.8 for why), so they are designed now, given their data table and UI slots in the MVP, and shipped as milestone M7, after tags (M6), behind an opt-in setting.

---

## 2. Product principles

1. **Local-first, private by default.** Text never leaves the browser in the MVP. Later features that send data out are opt-in and send the minimum, stated before sending: link previews send URLs only; AI tagging sends link metadata and, unless turned off, up to 200 characters of message text around each link. Never the whole text, never sender names.
2. **Any text in.** If it has URLs, we extract them. Structured sources add metadata; plain text still works.
3. **Fast on big inputs.** A 10 MB chat export is normal. Parse in a worker, show progress, virtualize lists.
4. **Lossless in, useful out.** Keep the raw input so extraction can be re-run. Keep the original URL and show a cleaned one.
5. **Get out easily.** Every view can be copied or exported in a format other tools accept.

---

## 3. Sources (adapters)

An **adapter** turns raw input into a list of `Message`s (a unit of text with optional timestamp, sender and position). Everything downstream (URL extraction, grouping, search) is adapter-agnostic.

| Adapter | Detects | Metadata provided | Phase |
|---|---|---|---|
| `plaintext` | Fallback for anything | line number, surrounding line as context | **MVP** |
| `whatsapp` | ≥ 60 % of the first 50 non-empty lines match a WhatsApp timestamp prefix | timestamp, sender, multi-line messages, system-message filtering | **MVP** |
| `zip` | `.zip` (`PK` header) with a `.txt` inside: every iOS WhatsApp export (`WhatsApp Chat - <name>.zip` holding `_chat.txt`, even "Without Media") and Android "with media" exports. Unzipped in the worker; the `.txt` goes to the inner adapter | as per inner adapter; the zip name gives the chat name | **MVP** |
| `markdown` | `.md` extension, or `[text](url)` / `<url>` / reference links present (until then, Markdown goes through `plaintext`) | link text as title, image vs link | Phase 1.5 |
| `netscape` (browser bookmark exports) | `<!DOCTYPE NETSCAPE-Bookmark-file-1>` (until then, through `plaintext`) | anchor text as title, `ADD_DATE` as timestamp, folder path as `folder` | Phase 1.5 |
| `html` | any other HTML document (until then, HTML goes through `plaintext`) | anchor text as title | Phase 1.5 |
| `telegram-json` | `result.json` with `messages[]` and `text_entities` | timestamp, sender, chat name | Phase 1.5 |
| `slack-json`, `discord`, `eml/mbox`, `csv/tsv`, `apple-notes`, `pocket/raindrop` exports | — | — | Phase 2+ |

Rules:

- Detection is a score, not a boolean. When the score is low, the import dialog shows the detected adapter and lets the user override it (§6.1); otherwise the override is offered later as a re-extract (§6.4).
- Adapters are pure TypeScript with no DOM or React dependency, so they run in a Web Worker and under Vitest's Node environment. The bookmarks and HTML adapters therefore use a small attribute tokenizer, not `DOMParser`.
- Each adapter has a `version`. Sources record the adapter version used; when an adapter's version bumps, the app offers "Re-extract" from the stored raw input.
- Chat adapters (WhatsApp now, Telegram later) give every message a **key**: a hash of its timestamp truncated to the minute (Android exports carry no seconds, iOS ones do), sender, NFC-normalized text, and a counter for identical messages in the same minute. Link ids derive from it (§5), so a newer export of the same chat merges into the existing source instead of duplicating it (§6.1).

### WhatsApp format notes (the hard adapter)

Exports differ by platform and device locale. iOS always delivers a zip (`zip` adapter above; confirm the "Without Media" case against a real export when building the fixture). WhatsApp's help centre gives the export limit as the latest 40,000 messages (10,000 with media), so a newer export of a long chat can lack its oldest messages; updates therefore merge rather than replace (§6.1). All of these must parse:

```
25/05/2023, 19:48 - Cris: https://example.com            Android, en-GB
5/25/23, 7:48 PM - Cris: https://example.com             Android, en-US (U+202F narrow NBSP before PM is common)
[25/05/2023, 19:48:32] Cris: https://example.com         iOS (lines often start with U+200E LRM)
[5/25/23, 7:48:32 PM] Cris: https://example.com           iOS, en-US
25.05.23, 19:48 - Cris: https://example.com               de-DE
2023-05-25, 19:48 - Cris: https://example.com             some locales use ISO dates
25/05/2023, 19:48 - Messages and calls are end-to-end encrypted. ...   system message (no sender colon)
25/05/2023, 19:48 - Cris: <Media omitted>                 attachment placeholder
25/05/2023, 19:48 - Cris: IMG-20230529-WA0005.jpg (file attached)
AI tools apps in one place sorted by category             continuation line (no timestamp) -> belongs to previous message
```

Parsing rules:

- Header regex (named groups): optional `‎`, optional `[`, date `\d{1,4}[./-]\d{1,2}[./-]\d{2,4}`, optional `,`, whitespace (incl. ` `), time `\d{1,2}:\d{2}(:\d{2})?` with an optional day-period token before or after it (any short run of letters, dots and spaces: `PM`, `p. m.`, `a.m.`, `오후`, `下午`; new locales arrive as fixture lines), optional `]`, then either ` - ` (Android) or a space (iOS), then the remainder.
- Remainder splits on the **first** `: ` into sender and message, but only when the candidate sender is in the chat's **sender set**: names that appear as the prefix of at least two headers (collected in the scan pass, §6.1) and don't match a known system-message pattern. Anything else is a system message (kept, flagged `isSystem`, excluded from link extraction unless it contains a URL). This keeps system messages that contain `: ` (`Cris changed the subject to "Links: misc"`) out of the sender list.
- **Day/month inference:** scan all date tokens in the file. Any first field > 12 → DMY. Any second field > 12 → MDY. Four-digit first field → YMD. Ambiguous → the default from Settings (initialised from `navigator.language`: `en-US` → MDY, most others DMY), with an override in the import dialog. Record the decision on the `Source`. This needs every date in the file, so it runs in the scan pass, before the parse starts (§6.1, §8.2).
- Two-digit years → 20xx.
- Lines that don't match the header are appended to the previous message (`\n`-joined).
- Strip BOM, normalize CRLF, tolerate a trailing partial line.

---

## 4. Extraction pipeline

```
raw text ──▶ detect ──▶ adapter.parse ──▶ Message[]
                                            │
                                            ▼
                          for each message: extractUrls(text)
                                            │
                          repair ▶ validate ▶ canonicalize ▶ urlKey ▶ classify ▶ domain ▶ context
                                            │
                                            ▼
                                          Link[] ──▶ dedupe groups ──▶ Dexie ──▶ UI
```

All of this runs inside a Web Worker (`lib/workers/extract.worker.ts`) and posts progress (`{ phase, done, total }`) back to the UI. Zip input is unwrapped in the worker before detection (§3).

### 4.1 Find candidates

A hand-written regex, chosen in the M1 spike (21 Oct 2026). `linkify-it` 5.0.2, with schemeless matching off, passed 47 of the 65 cases in `urls-edge-cases.txt`. It finds no `www.` links unless bare domains are switched on too, keeps U+200E (which iOS exports insert) and CJK punctuation inside URLs, misses emphasis marks and `Checkhttps://` glued to a word, and rejects `[::1]`. Fixing that would take as many rules as the regex. The regex with the repair rules below passed all 65, found the same 4,644 links as `linkify-it` in the owner's export, and ran about 3× faster.

```
/(?:https?:\/\/|(?<![\p{L}\p{N}.-])www\.)[^\s<>"`\p{Cf}\p{Extended_Pictographic}、。」）]+/giu
```

Emoji (`\p{Extended_Pictographic}`) end a match too: real URLs practically never contain them, and `https://…😂` is a common way to type in a chat. The lookbehind needs Safari 16.4, the browser floor already (§10).

There is no `\b` before the scheme, so a URL glued to the word before it (`Checkhttps://…`) is still found; `www.` needs a lookbehind instead, so `awww.` and `foo.www.` don't match. The excluded set adds `\p{Cf}`, the Unicode format characters: zero-width spaces and joiners, bidi marks and the BOM. WhatsApp inserts U+200E, which `\s` does not match, so without this it ends up inside URLs. It also adds full-width CJK punctuation (`、` `。` `」` `）`). `\p{…}` needs the `u` flag. `'` is deliberately not excluded: it is legal in paths and shows up in Wikipedia titles and slugs (`/wiki/Schindler's_List`); a trailing one is trimmed by repair (§4.2).

The Markdown adapter (Phase 1.5) adds `[text](url)`, `<url>`, `![alt](src)` and reference definitions; the bookmarks and HTML adapters (Phase 1.5) add `href`/`src` attributes. Until then the generic pattern still finds those URLs, and repair drops the `)` of `[text](url)`. Structural matches report their spans, and the generic regex runs only over the text outside those spans, so no URL is counted twice. Bare domains without a scheme (`example.com/foo`) are **not** extracted by default. An "aggressive" toggle can enable a stricter bare-domain pattern later; false positives are worse than misses here.

### 4.2 Repair

- Trim trailing `.,;:!?'">…` and closing `)]}` when unbalanced against the URL's own openers (so `https://en.wikipedia.org/wiki/Foo_(bar)` survives, `(see https://x.com/a)` loses the `)`). Repeat until nothing changes (`https://example.com/a).` loses both).
- Strip trailing `*` / `_` / `~` (markdown and WhatsApp emphasis, WhatsApp strikethrough) only as many times as the same mark sits right before the URL (`**https://x/**` loses two). Tokens can end in `_` (two YouTube `si` values in the owner's export did), so an unopened mark stays.
- Prepend `https://` to `www.` matches.

### 4.3 Validate

- `new URL(candidate)` must succeed and the protocol must be `http:` or `https:`. `mailto:`, `tel:`, `whatsapp://`, `intent://` are counted in stats as "skipped, non-web" but not stored.
- Hosts must have at least two non-empty labels or be `localhost` / an IP. Reject `https://.` style garbage.
- Reject template placeholders (`${…}`, `{{…}}`): code pasted into a chat (`` `https://api.example.com/users/${id}` ``) is not a link. The owner's export had 3.

### 4.4 Canonicalize (for display cleanup and dedupe)

Store three forms: `url` (as found, repaired), `canonicalUrl` (cleaned, for display and export) and `urlKey` (the identity used for dedupe and by every per-URL table).

`canonicalUrl`:

- lowercase scheme and host; drop default port; drop userinfo
- keep `#fragment` (anchors and Google Docs `#slide=` links matter when the link is opened or exported)
- remove tracking parameters by the configured rules (Appendix B). A rule names a parameter (prefix wildcards allowed: `utm_*`) and optionally the hosts it applies to (`t` only on twitter.com / x.com), the hosts it is exempt on (`ref` everywhere except code hosts, where it names a branch), or a pattern its value must match (`s` with two digits, everywhere)
- strip by filtering the raw query string (`url.search` split on `&`), never through `URLSearchParams`: deleting one key makes it re-serialize every remaining parameter (`?q=a,b&utm_source=x` → `?q=a%2Cb`, `%20` → `+`), which changes the displayed URL and occasionally what the server receives
- remove an empty `?`

`urlKey` = `canonicalUrl`, then:

- rewrite known mirror hosts to one form where the same path is the same page (`x.com`, `mobile.twitter.com` → `twitter.com`; `youtu.be/<id>` → `youtube.com/watch?v=<id>`; full list in Appendix B)
- use `https` and drop a leading `www.`: `http://www.example.com/a` and `https://example.com/a` are one page in practice
- drop the fragment, except hash routes (`#/…`, `#!…`), which address different pages of a single-page app
- drop a trailing `/` on the path; sort query params (displayed URLs keep the original order; `URLSearchParams.sort()` is fine here, because `urlKey` is never shown)

Annotations, enrichments and classifications are all keyed by `urlKey`, so `…/x` and `…/x/`, or one tweet on x.com and on twitter.com, share one star, one tag set and one preview.

**Canonicalizer versioning.** The canonicalizer has a `version`, like adapters. When it changes (a code update; from Phase 1.5 also the user saving a new tracking-param list in Settings), the app recomputes `canonicalUrl` and `urlKey` for every stored link, then moves the per-URL rows (annotations, enrichments, classifications) by following the links: each old key maps to the set of new keys its links now produce.

- **Merge** (several old keys → one new key): annotations merge (union of `tags` and `rejectedTags`, newest `updatedAt` wins for other fields); enrichments and classifications keep the newest row.
- **Split** (one old key → several new keys, e.g. a parameter is no longer stripped): the row is copied to each new key.
- **Orphans** (rows with no links left, because their source was deleted): re-keyed from their own `url`, an as-found URL stored on every per-URL row when it is written (§5). Without it they would keep a stale key and never reattach.

The version last applied is stored in the `meta` row (§5).

### 4.5 Domain

Use the public suffix list (`tldts`) to get the **registrable domain**: `m.youtube.com`, `www.youtube.com` → `youtube.com`; `foo.github.io` stays `foo.github.io`. Keep `host` separately. Apply a small alias map so obviously-same services group together: `youtu.be → youtube.com`, `x.com`, `mobile.twitter.com` → `twitter.com`, `t.co` flagged as shortener. Aliases are display grouping only; `host` is untouched. The subset of aliases that are true mirrors (same path, same page) is also applied to `urlKey` (§4.4).

### 4.6 Classify (cheap, URL-only heuristics)

`kind: 'video' | 'social' | 'code' | 'image' | 'document' | 'audio' | 'other'` from host and path patterns (Appendix B). Used as a filter facet and an icon. Link previews (M7) upgrade it from `og:type`.

### 4.7 Shorteners

Hosts in a known list (`t.co`, `bit.ly`, `tinyurl.com`, `goo.gl`, `lnkd.in`, `share.google`, `search.app`, `youtu.be` excluded), and share links that redirect the same way (`reddit.com/r/<sub>/s/<id>`, `facebook.com/share/…`), get `isShortened: true` and a facet (Appendix B). Share links matter: in the owner's export, 17 % of all links were Reddit `/s/` links, and 20 % of all links were flagged in total. None of them can be deduped against the page they point to, or given a title derived from the URL, until they are resolved. The preview service (M7) follows redirects, so a fetched preview's `finalUrl` resolves a shortener without waiting for the Phase 2 resolver; whether to re-key a link on it is an M7 decision. Resolution (following the redirect) needs a server and is Phase 2, opt-in.

### 4.8 Context

- `context`: up to 200 characters of the message around the URL; the drawer highlights the URL inside it.
- `nearby`: in a chat with yourself, the note about a link is usually a separate message sent just before or after it. When a message is little more than its URL(s) (under about 20 characters of other text), `nearby` takes the previous and next messages from the same sender within 5 minutes, up to 200 characters, skipping neighbours that are themselves little more than a URL. In the owner's export 89 % of link messages were bare links, so without that rule most `nearby` text would just be other URLs. The drawer shows it under the context; search and AI tagging use both (§6.9).

---

## 5. Data model

Times are epoch milliseconds (`number`), not `Date`, so records survive JSON export and structured clone unchanged.

```ts
export type SourceKind = 'plaintext' | 'whatsapp' | 'markdown' | 'netscape' | 'html' | 'telegram-json';
// zip is a container, not a kind: an iOS export becomes a 'whatsapp' source

export interface Source {     // no status field: imports are one transaction, so a stored source is complete (§8.2)
  id: string;                 // crypto.randomUUID()
  name: string;               // chat name, file name or "Pasted text, 1 Sep 2026 14:02"; editable
  kind: SourceKind;
  adapterVersion: number;
  importedAt: number;         // first import
  updatedAt: number;          // last import, update or re-extract (§6.1)
  stats: SourceStats;
  options: { dateOrder?: 'DMY' | 'MDY' | 'YMD' };   // adapter options chosen at import
}

export interface SourcePart {   // one per imported file: a chat updated twice has three
  id: string;
  sourceId: string;
  fileName?: string;
  importedAt: number;
  byteSize: number;           // decoded text, before compression
  contentHash: string;        // SHA-256 of the decoded text; warns on re-import of the same file
  raw: Blob;                  // gzipped (CompressionStream) decoded text, kept for re-extraction
}

export interface SourceStats {
  messages: number;
  links: number;
  uniqueLinks: number;
  domains: number;
  skippedNonWeb: number;
  earliest?: number;
  latest?: number;
}

export interface Message {            // in-worker intermediate; not persisted in MVP
  index: number;
  key?: string;                       // chat adapters only (§3)
  lineStart: number;
  text: string;
  timestamp?: number;
  sender?: string;
  isSystem?: boolean;
}

export type LinkKind = 'video' | 'social' | 'code' | 'image' | 'document' | 'audio' | 'other';

export interface Link {
  id: string;                 // stable hash of (sourceId, message key, occurrence in message) for chat sources, so updates
                              // merge (§6.1); of (sourceId, messageIndex, occurrence) for others. Backup merges are idempotent
  sourceId: string;
  messageKey?: string;        // chat sources; compared when a newer export of the chat arrives (§6.1)
  url: string;                // as found, after repair
  canonicalUrl: string;       // cleaned, for display and export (§4.4)
  urlKey: string;             // identity for dedupe and every per-URL table (§4.4)
  host: string;               // m.youtube.com
  domain: string;             // youtube.com (registrable, alias-mapped)
  path: string;
  title?: string;             // markdown link text, bookmark / HTML anchor text
  folder?: string;            // bookmark folder path, e.g. "Bookmarks bar › Recipes"
  context?: string;           // ≤ 200 chars of the message around the URL (§4.8)
  nearby?: string;            // ≤ 200 chars from adjacent same-sender messages (§4.8)
  timestamp?: number;         // from source when available
  sender?: string;
  kind: LinkKind;
  isShortened: boolean;
  position: { line: number; column: number; messageIndex: number };
}

// No Collection type in the MVP: the Sources facet narrows the library, and saved searches
// (Phase 3) give named views. v1's SavedSession has no direct successor.

export interface Annotation {   // keyed by urlKey so it survives re-imports and applies to duplicates
  urlKey: string;
  url: string;                // an as-found URL with this key; re-keys the row once its links are gone (§4.4)
  starred?: boolean;
  tags?: string[];            // Tag ids
  status?: 'unread' | 'read' | 'archived';   // Phase 3
  note?: string;              // Phase 3
  rejectedTags?: string[];    // Tag ids the user rejected as AI suggestions; never re-suggested
  updatedAt: number;
}

export interface Tag {          // the vocabulary (§6.9)
  id: string;                 // immutable; annotations and classifications reference this
  slug: string;               // 'recipes'; unique, editable
  name: string;               // 'Recipes'
  aliases: string[];          // ['recipe', 'cooking']
  description?: string;       // shown to the model and in the Tag manager
  color?: string;
  origin: 'user' | 'ai';
  createdAt: number;
  updatedAt: number;
}

export interface Classification {  // AI suggestions, kept apart from the user's own tags
  urlKey: string;
  url: string;                // as on Annotation (§4.4)
  tags: Array<{ tagId: string; confidence: number }>;
  tagIds: string[];           // flattened for the multi-entry index
  proposedTags?: string[];    // new-tag proposals, normalized
  summary?: string;           // single-link "Suggest tags" runs only; the bulk pass skips it
  inputHash: string;          // hash of what was sent; re-run only when it changes
  model: string;
  promptVersion: number;
  classifiedAt: number;
}

export interface Enrichment {    // link preview; keyed by urlKey so every duplicate shares one
  urlKey: string;
  url: string;                // as on Annotation (§4.4)
  fetchedAt: number;
  status: 'ok' | 'no-metadata' | 'dead' | 'blocked' | 'error';
  httpStatus?: number;
  finalUrl?: string;          // after redirects
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;             // URL only; bytes are never stored
  imageWidth?: number;
  imageHeight?: number;
  favicon?: string;
  ogType?: string;            // 'article', 'video.other', …
  publishedAt?: number;
  provider: 'oembed' | 'og' | 'twitter' | 'html' | 'derived';
}

export interface TrackingParam {   // rules in Appendix B
  param: string;              // exact name, or a prefix wildcard: 'utm_*'
  hosts?: string[];           // only on these registrable domains ('t' → twitter.com, x.com)
  exceptHosts?: string[];     // everywhere except these ('ref' → not on github.com, where it names a branch)
  value?: string;             // a regex the value must match ('s' with two digits, everywhere; Appendix B)
}

export interface Settings {
  key: 'settings';
  theme: 'system' | 'light' | 'dark';
  defaultDateOrder: 'DMY' | 'MDY';     // initialised from navigator.language
  trackingParams: TrackingParam[];     // the built-in rules (Appendix B); editable from Phase 1.5, where saving re-keys links (§4.4)
  showCanonicalUrls: boolean;
  dedupeByDefault: boolean;
  previews: 'off' | 'icons' | 'full';   // §6.8 tiers; default 'off'
  autoFetchPreviews: boolean;           // default false
  ai: { mode: 'off' | 'own-key'; model: string; includeContext: boolean; rememberKey: boolean };   // §6.9; 'hosted' is Phase 3
}

export interface Meta {          // stored in the settings table
  key: 'meta';
  canonicalizerVersion: number; // last version applied to stored links (§4.4)
}
```

### Dexie schema (v1)

```ts
db.version(1).stores({
  sources:         'id, importedAt',
  sourceParts:     'id, sourceId, contentHash',   // raw input, kept apart so live queries on sources stay small
  links:           'id, sourceId, urlKey',   // filtering is in memory (below); each extra index slows every import
  annotations:     'urlKey, starred, *tags',
  enrichments:     'urlKey, fetchedAt',
  tags:            'id, &slug',
  classifications: 'urlKey, promptVersion, *tagIds',
  settings:        'key',                     // the 'settings' and 'meta' rows
});
```

Querying strategy: Dexie is the durable store; browsing runs in memory. On load, and again whenever an import reports `done`, the worker reads the links table and posts one lean row per link to the UI: `id`, `urlKey`, `sourceId`, `domain`, `timestamp`, `kind`, `sender` and a lowercased search string (URL, title, folder, context, nearby, sender). The read happens in the worker because IndexedDB always returns whole records: building lean rows on the main thread would mean deserializing every full `Link` there first, hundreds of milliseconds at 50 k links, against the 50 ms budget (§8.6). The Sources facet filters the rows in memory; the drawer and exports read full rows by id. For the same reason the links table is not behind `useLiveQuery`. Small tables (sources, annotations, tags, settings) do use live queries. Search stays under 100 ms without an index; revisit with MiniSearch past ~100 k links.

---

## 6. MVP features

### 6.1 Import

- Drop zone (whole page accepts drops), file picker (multi-file), paste area, and a "Paste from clipboard" button.
- Accepts `.txt`, `.zip` (WhatsApp exports, unzipped in the worker, §3), `.md`, `.markdown`, `.html`, `.htm`, and any `text/*`; unknown extensions are tried as plain text. Until the Phase 1.5 adapters land, Markdown and HTML (bookmark exports included) go through plain text, which still finds every URL but not link titles or bookmark folders. Files up to 100 MB; warn above 25 MB.
- Two passes in the worker. **Scan** (fast, whole file): unzip if needed, decode, hash, detect the adapter, and for WhatsApp collect every date token, the sender set (§3) and the keys of messages that contain URLs. **Parse**: parse, extract, save.
- Import dialog, shown between the passes only when the scan needs a decision: a low detection score, an ambiguous day/month order, a file already imported, or a likely update of an existing chat (below). Otherwise the parse starts straight away; a wrong guess is fixed afterwards with re-extract (§6.4), since the raw input is kept. Every occurrence is stored; duplicates are collapsed in the view (§6.2), not at import.
- Progress bar with phase labels (Reading → Scanning → Parsing → Extracting → Saving) and cancel. Cancelling, closing the tab or running out of quota leaves no partial source (§8.2).
- Duplicate-file detection by content hash against every stored part, reported by the scan: "You imported this file on 12 Aug. Re-import anyway?"
- **Updating a chat.** People re-export the same chat every few months, and a newer export of a long chat can lack its oldest messages (WhatsApp's export limit, §3). So a new export merges into the existing source instead of becoming a second source or replacing the first. The scan compares its message keys with the `messageKey`s stored on each chat source of the same adapter (computed with that source's day/month order); a source that shares at least half of the smaller set (tune with the update fixtures) is offered: "This looks like a newer export of 'Chat with Me'. Add the new messages to it?", with **Import as a new source** as the alternative. The update adds the file as a new part, keeps the source's day/month order, adds only links whose ids are new (§5) and refreshes the stats. For other sources, the same prompt appears when the file name matches an existing source and offers **Replace**; annotations survive it, since they are keyed by `urlKey`.
- Result summary: links found (new links, for an update), unique, domains, date range, non-web URLs skipped.
- A "Try with sample data" button on the empty state, using a bundled anonymized WhatsApp fixture.

### 6.2 Browse

- **List view** (default): virtualized rows with favicon placeholder, title or URL, domain chip, kind icon, timestamp, sender, source. Click opens a details drawer; ⌘/Ctrl-click opens the link.
- **Grouped view** (Phase 1.5): collapsible domain sections with counts, sorted by count / name / most recent. "Expand all / collapse all". Until then the domain chip, the Domains facet and the "most frequent domain" sort do the grouping.
- **Compact view** (Phase 1.5): one URL per line, for eyeballing and select-all-copy.
- **Card view** (M7, with link previews): a responsive grid of preview cards (image, title, domain, date). A card without a fetched preview shows a domain-tinted placeholder with the derived title; fetched previews fill it in (§6.8). It waits for M7 because before previews exist it is mostly placeholders.
- **Duplicates toggle**: collapse duplicates by `urlKey`, show `×3` badge; expanding shows every occurrence with its own timestamp and context.
- **Details drawer**: full URL, canonical URL with "what was stripped", context with the URL highlighted, nearby messages (§4.8), message metadata, source name and line number (or bookmark folder, from Phase 1.5), copy buttons, star; from M6 a tag editor with autocomplete, and from M8 AI suggestions (§6.9).

### 6.3 Search, filter, sort

- Search box filters on URL, title, bookmark folder, context, nearby messages and sender; case-insensitive; debounced; results count shown. (M3)
- Field prefixes (M6, built together with the tag syntax; until then the facets cover the same ground): `site:twitter`, `domain:youtube.com`, `sender:Cris`, `kind:video`, `after:2023-05`, `before:2024`, `is:starred`, `is:short`, `source:"chat with me"`, `tag:recipes`, `-tag:recipes`, `is:untagged`.
- Plain-word interpretation (M6): words are matched against tags (with aliases), site names, titles, context, senders and URLs; every word must match something, and stop words (`from`, `on`, `about`, `the`, `my`, `links`) are ignored. So `recipes from twitter` means `tag:recipes site:twitter`. Site names resolve through the domain alias map plus short names (`twitter`, `x`, `youtube`, `yt`, `github`, `gh`, `reddit`, `insta`). The search box shows its interpretation as removable chips, so a wrong guess is visible and fixable.
- Facet sidebar with counts: domains (top 20 + "more"), kinds, senders, sources, year/month. Multi-select within a facet, AND across facets.
- Sort: newest, oldest, domain A–Z, most frequent domain, recently imported. Links without timestamps sort last within date sorts.
- Search, sort, view and active filters live in the URL query string, so a view can be bookmarked and the back button works.

### 6.4 Library and persistence

- Everything persists automatically in IndexedDB. Reloading the page brings back the last view (it lives in the URL, §6.3).
- The library is every imported source. The Sources facet narrows it to one or several; named views ("Me chat + Research") arrive as saved searches in Phase 3. There are no collections in the MVP.
- Sources can be renamed and deleted. Deleting a source removes its links; annotations stay (keyed by `urlKey`) and reattach if the URL is imported again.
- "Re-extract" a source with the current adapter version, or with a different adapter or day/month order (the override for imports that skipped the dialog, §6.1). Re-extract runs over every stored part of the source in one transaction.
- Raw input is stored gzipped with the built-in `CompressionStream`; chat text compresses several-fold, which matters under Safari's storage limits (§15).
- Storage meter in settings (`navigator.storage.estimate()`), a `navigator.storage.persist()` request after the first import (§15), and "Delete everything" with confirmation.

### 6.5 Export

- Formats: JSON (full backup including annotations, zod-validated on import), CSV, Markdown list (`- [title](url) — date`), plain text one URL per line. Netscape bookmarks HTML (folders per domain, importable into Chrome/Firefox/Safari/Raindrop) follows in Phase 1.5 with the bookmarks adapter.
- Escaping: CSV cells that start with `=`, `+`, `-`, `@`, tab or carriage return get a leading `'`, so spreadsheets don't run them as formulas. The Markdown export escapes `[` and `]` in titles and `(` and `)` in URLs. The Netscape export (Phase 1.5) HTML-escapes titles and URLs.
- Scope: current filtered view, selection, or the whole library. Deduped or all occurrences.
- Clipboard: copy URLs from the current view or selection.
- Import backup JSON (merge, not replace, by IDs, which are stable, so importing the same backup twice changes nothing; annotations merge by `urlKey`, newest wins). It stays in the MVP: it is the restore path for the Safari storage risk (§15).

### 6.6 Stats

- Header strip: links, unique links, domains, date range, sources.
- Stats panel: top 10 domains bar list, links per month bars, by kind, by sender. All computed from the current filter, so they double as a "what did I save in 2023" answer.

### 6.7 Settings

Theme, default day/month order (initialised from the browser language), editable tracking-param list (Phase 1.5; saving it re-keys existing links, §4.4), canonical-vs-original display, dedupe default, link-preview tier (§6.8), AI (§6.9), danger zone.

### 6.8 Link previews

What WhatsApp, iMessage and Slack show under a pasted link is a **link preview** (Slack calls it "unfurling"). It is almost never a screenshot. It is the page's own self-description, read from tags in the HTML `<head>`:

- **Open Graph** — `og:title`, `og:description`, `og:image`, `og:site_name`, `og:type`. Originally Facebook's; nearly every site sets it. The "little screenshot" is the site's chosen `og:image`.
- **Twitter Cards** — `twitter:title`, `twitter:description`, `twitter:image`. Fallback when OG is missing.
- **oEmbed** — a JSON endpoint some providers expose (YouTube, Vimeo, Twitter/X, Spotify, SoundCloud, Flickr) with title, author, thumbnail and an embed snippet. Best source when available.
- **Plain HTML** — `<title>`, `<meta name="description">`, `<link rel="icon">`.

WhatsApp downloads the page on the sender's phone and sends the preview along with the message; Slack and Facebook download it from their servers. Either way, something has to fetch the page.

**Why this app can't do it purely in the browser.** JavaScript on one site cannot read the response from another site unless that site opts in with CORS headers, and practically no site does for its HTML. So the fetch must run on a server we control: a Next.js route handler that downloads the page, reads the head and returns a small JSON (§8.8). It is the first feature that breaks "nothing leaves the browser", so it is tiered and opt-in.

| Tier | What you get | What leaves the browser | Needs | Ships |
|---|---|---|---|---|
| 0 | Kind icon, domain, link text as title, and a readable title derived from the URL slug (`/blog/how-to-ship-fast` → "How to ship fast") | Nothing | Nothing | MVP (M3) |
| 1 | Favicons from a favicon service; video thumbnails built from the ID for YouTube (`i.ytimg.com/vi/<id>/hqdefault.jpg`). Vimeo thumbnail URLs don't derive from the video ID, so Vimeo thumbnails come with Tier 2 (oEmbed) | Domain names to a third-party favicon service (named in the settings copy), video IDs to YouTube, as plain `<img>` loads; no fetch needed | Nothing | M7 |
| 2 | Full preview: title, description, image, site name, type, final URL, from oEmbed / OG / Twitter / HTML | The URL to **our** preview service; our server fetches the page, so the site sees our server, not the user | Route handler + CDN cache | M7 |
| 3 | Real screenshots (headless browser or a screenshot API), dead-link status, Wayback fallback, shortener resolution | The URL | Heavier server work or a paid API | Phase 2+ |

UX:

- **Settings → Link previews**: `Off` (default), `Favicons and thumbnails only`, `Full previews`. One sentence per tier says what is sent where. `Fetch previews automatically after import` is a separate toggle, default off.
- **Details drawer → Preview block**. Previews off: a `Fetch preview` button with the note "Sends this URL to LinkVault's preview service, nothing else". Previews on: image, title, description, site name, `Refresh`. States: loading skeleton; "No preview available" (falls back to Tier 0); "Page not found" badge; "Site blocks previews".
- **List rows**: favicon at left (Tier 1); the fetched title replaces the raw URL text; kind upgrades from `og:type` (`video.other` → video).
- **Card view** ships here (§6.2). Cards fill in as previews arrive.
- **Bulk**: toolbar action `Fetch previews for these 312 links` on the current view, with progress, pause, concurrency 4 and per-host politeness; skips anything fetched in the last 30 days.
- **Exports** use fetched titles when present (Markdown, Netscape). The JSON backup includes enrichments.

Data: one `Enrichment` row per `urlKey` (all duplicates share it); image URLs only, never bytes; refresh after 30 days or on demand.

**What to expect for social links.** The links people send themselves most are social posts, and those preview worst. Instagram's oEmbed needs a Meta app token; Facebook and LinkedIn usually refuse unknown bots; X's oEmbed endpoint has been unreliable and often refuses datacenter IPs. Expect many `blocked` results there. The UI labels them "Site blocks previews" and falls back to Tier 0 instead of retrying.

### 6.9 Categories and tags

The goal: a tweet that happens to be a recipe turns up for "recipes", and for "recipes from twitter", without anyone tagging it by hand. That takes three layers, each depending on the one before: tags as a first-class object, search that understands tags and site names, and AI that fills the tags in. The first two work with no AI at all; the third is the reason the first two exist.

**Layer 1 — Tags without AI (M6)**

- A `Tag` vocabulary: immutable id, slug, display name, aliases, optional description and colour, origin (user or AI). A size threshold decides whether a tag is pinned as a **category** in the facet sidebar (≥ 1 % of links or ≥ 5 links) or stays in the long tail. "Categories that appear a lot" are just tags that crossed the line.
- Tags on links live on `Annotation.tags` as tag ids, keyed by `urlKey`, so tagging one occurrence tags every duplicate and survives re-imports. Bookmark folders (from the bookmarks adapter) can be turned into tags in one action.
- Tag editor in the drawer with autocomplete; tag chips on rows; a Tags facet with counts; a Tag manager to rename, merge, alias, colour and delete. Renaming (name or slug) edits one `Tag` row, because annotations store the immutable id. Merging rewrites the annotations that reference the merged tag (found through the `*tags` index) and adds its slug as an alias.
- Normalization: lowercase, trim, hyphenate, alias lookup. No automatic singularization, which mangles `news`, `series`, `analysis` and `css`. Instead the Tag manager suggests merging near-duplicates such as `recipe` / `recipes`, and an accepted merge adds an alias.

**Layer 2 — Search that understands tags and sites (M6, §6.3)**

`recipes from twitter` becomes `tag:recipes site:twitter`, and the search box shows that interpretation as chips.

**Layer 3 — AI-assisted tagging (M8)**

Two passes, both opt-in, both reviewable.

*Discovery: "what is in here?"* Sample up to 400 links: half in proportion to the library, half stratified by domain so one site cannot drown out the rest. Send compact rows (site, title, description, up to 200 characters of message text around the link, §4.8). Ask for 8–25 categories, each with a name, a one-line description, aliases and example rows. The model is not asked for shares, since the stratified half would skew them; the proposal shows a rough share computed from the proportional half, and real counts once tagging runs. The user accepts, renames, merges or drops each category. Accepted categories enter the vocabulary with origin `ai`.

*Tagging: apply the vocabulary.* Links go in batches of about 40 against the vocabulary (with a few accepted examples per tag). Structured output per link: a short row id, up to 3 tag ids with a confidence, and an optional new-tag proposal when nothing fits. No summary in the bulk pass, because it adds output tokens (the expensive side); the single-link "Suggest tags" run in the drawer adds a one-line summary. Results are stored as `Classification` rows, separate from the user's own tags:

- AI tags render as dashed chips with a small "AI" mark. Accepting promotes a tag to the user's tags; rejecting records it in `rejectedTags` so it never comes back on a re-run.
- Confidence below a threshold goes to a **review queue**: one link per screen with preview and context visible, `y` accept, `n` reject, `e` edit. The threshold starts at 0.6 and is then set from the eval set (§8.9), because model-reported confidence is poorly calibrated.
- New-tag proposals are normalized and surfaced as candidates once 5 links share one.
- Re-runs only touch rows whose input changed or whose `promptVersion` is older, so improving the prompt never re-bills everything.

*What the model gets to see.* No signal, no tag. A bare social URL with no preview and no surrounding text is marked "needs preview" rather than guessed, and the Organize flow fetches previews first (M7 is a hard dependency). For Twitter/X the tweet text comes through Twitter's oEmbed endpoint inside the preview service. That endpoint is patchy (§6.8); when it fails and there is no context or nearby text, the tweet cannot be categorized and the UI says so instead of inventing a tag.

**The Organize flow** (a four-step wizard from the toolbar)

1. Fetch previews for the *n* links that lack one.
2. Discover categories: proposal, then review.
3. Tag *n* links, with a cost and time estimate shown before starting. Each result is saved as it arrives, so the run can be paused, and reopening the wizard after closing the tab picks up where it stopped (§8.9).
4. Review the *m* low-confidence results.

Per link, "Suggest tags" in the drawer runs the tagging pass for that one link.

**Settings → AI**

- `Off` (default) or `My own key`: the user's Anthropic key; requests go from the browser straight to Anthropic and our server is not involved. The official TypeScript SDK exposes a `dangerouslyAllowBrowser` option for exactly this case; confirm CORS behaviour at implementation. The key is held for the session only unless "Remember on this device", which stores it unencrypted in IndexedDB and says so. Any script injection on the site could read a stored key, and once previews widen `img-src` (M7) the CSP cannot stop it being sent out (§8.7), so the copy promises nothing more and recommends a key from a workspace with a spend limit.
- `Hosted` (LinkVault's own key through `app/api/classify`) is Phase 3. Without accounts there is no user to put a daily cap on: a per-IP cap is easy to get around, and the route would be a free model proxy on our key.
- What is sent per link is listed on the settings page, and again in the Organize wizard before its first request: site, title, description, canonical URL path without the query string, up to 200 characters of message text around the link (its own message and nearby ones, §4.8), and the tag vocabulary. Never the whole chat, never sender names. `Include chat context` (default on) can be turned off to send preview metadata only.

---

## 7. UX

### Layout (desktop)

```
┌────────────────────────────────────────────────────────────────────────┐
│ LinkVault                                     [Import]  [Export ▾]  ⚙  │
├──────────────┬──────────────────────────────────────┬──────────────────┤
│ FACETS       │ 🔍 search…       Sort ▾  View ▾  ⧉Dedupe│ DETAILS         │
│ Domains      │ 1,247 links · 934 unique · 112 domains│ (opens on click) │
│  youtube 312 │──────────────────────────────────────│ https://…        │
│  twitter 201 │ ▶ youtube.com (312)                  │ Cleaned: …       │
│  github  87  │   ◦ How to …   youtube.com  25 May 23│ Context: “…”     │
│ Kinds        │   ◦ https://youtu.be/…      26 May 23│ Sent by Cris     │
│ Senders      │ ▶ twitter.com (201)                  │ Source: me.txt:41│
│ Sources      │ ▶ github.com (87)                    │ [Copy] [Open] ☆  │
│ Dates        │ …                                    │                  │
└──────────────┴──────────────────────────────────────┴──────────────────┘
```

- **Empty state**: one big drop target, paste box, "Try sample", three lines on privacy ("nothing leaves your browser").
- **Preview block and card view** (§6.8): the drawer's preview block and, from M8, the Organize wizard are the only places where a network action is offered, and each says what will be sent before it is sent.
- **Mobile**: single column; facets in a bottom sheet; details as a full-screen sheet; sticky search.
- **Keyboard**: `/` focus search, `j`/`k` move, `o` or Enter open, `c` copy, `s` star, `t` tag, `Esc` close drawer. ⌘K command palette is a nice-to-have.
- **Dark mode**: follows system, manual override in settings; Tailwind v4 `@theme` tokens, already partially wired in `app/globals.css`.
- **Accessibility**: WCAG 2.1 AA. Progress announced via `aria-live`; drawer is a proper dialog with focus trap; lists are keyboard navigable; visible focus rings; no colour-only meaning.
- **Copy**: plain, honest, no marketing voice. Errors say what happened and what to do ("Couldn't find a chat in `WhatsApp Chat - Me.zip`: there's no `.txt` inside. Export the chat again and drop the new file").

---

## 8. Technical architecture

### 8.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16.3**, App Router, Turbopack (default) | Already scaffolded; typed route helpers (`LayoutProps`, `PageProps`); route handlers for the preview service (M7) |
| React | **19.2** with **React Compiler** (`reactCompiler: true`, `babel-plugin-react-compiler`) | Auto-memoization; no hand-written `useMemo` / `useCallback` in app code |
| Language | TypeScript 5, `strict`, `noUncheckedIndexedAccess` | Parser code is index-heavy; catch off-by-ones at compile time |
| Styling | **Tailwind CSS v4** (CSS-first config in `globals.css`) | Already scaffolded |
| UI primitives | shadcn/ui-style copied components (Dialog, Drawer/Sheet, DropdownMenu, Command, Tooltip) | Accessible primitives without owning them as a dependency surface; everything else hand-rolled |
| Icons | `lucide-react` | |
| Storage | **Dexie** + `dexie-react-hooks` | IndexedDB with migrations, indexes and a live-query hook. Raw input gzipped with the built-in `CompressionStream` |
| Domain parsing | `tldts` | Public suffix list, small |
| URL finding | Hand-written regex + repair (§4.1–4.2) | `linkify-it` was tried in the M1 spike and passed 47 of 65 edge cases |
| Lists | `@tanstack/react-virtual` | Virtualized list (and the grouped list in Phase 1.5). `useVirtualizer` returns a mutable instance that React Compiler memoization is known to trip over; verify early in M3 and opt the list components out with `'use no memo'` if needed |
| URL state | `nuqs` | Typed query-string state for search / sort / filters |
| Validation | `zod` | Backup import and settings |
| Zip | `fflate` | Small, works in a worker. In the MVP, because every iOS WhatsApp export is a zip |
| Server state (M7) | Upstash Redis (Vercel Marketplace) + `@upstash/ratelimit` | Rate limits and per-host concurrency need state shared across serverless instances |
| Outbound fetch (M7) | `undici` `Agent` with a custom `connect.lookup` | Address checks at connect time, so DNS rebinding can't slip past the SSRF guard (§8.8) |
| Unit tests | **Vitest** + `@testing-library/react` + `fake-indexeddb`, fixture corpus in `tests/fixtures/` | Parsers are the product; golden tests per adapter; Dexie repos tested without a browser |
| E2E | Playwright, one happy path (import sample → search → export) | |
| Lint / format | ESLint 9 flat config (scaffolded) + Prettier with the Tailwind plugin | |
| Package manager | pnpm 10 | Scaffolded |
| Hosting | Vercel (default `output`) | Static-export would block the M7 route handlers; the MVP itself makes no server calls |

Not used, on purpose: a global state library (React state + Dexie live queries are enough), a date library (`Intl.DateTimeFormat`), CSS-in-JS, `cacheComponents` / `use cache` (the preview cache is the CDN, §8.8).

### 8.2 Runtime architecture

- `app/page.tsx` is a Server Component shell (metadata, layout) and stays statically prerendered. It renders `components/library/WorkspaceLoader.tsx`, a small `'use client'` component that loads the workspace with `next/dynamic(() => import('./Workspace'), { ssr: false })`. Next.js 16 rejects `ssr: false` inside a Server Component, hence the loader. The workspace depends on IndexedDB and a worker, so it never renders on the server.
- Extraction runs in a **module Web Worker** created with `new Worker(new URL('./extract.worker.ts', import.meta.url))`. Messages: `{ type: 'scan', file | text }` → `{ type: 'scanned', detection, dateOrder, dateOrderAmbiguous, contentHash, duplicateOf?, updateCandidate? }`; then `{ type: 'start', adapter, options, updateOf? }`, `{ type: 'progress', phase, done, total }`, `{ type: 'done', sourceId, stats }`, `{ type: 'error' }`, `{ type: 'cancel' }`. Library reads: `{ type: 'load' }` → `{ type: 'rows', rows }` (§5). The worker writes to Dexie directly, so large results never cross the thread boundary.
- **Imports are atomic.** The worker parses and extracts the whole input in memory first, then writes the source, its part and its links in one Dexie `rw` transaction, in chunks of 1 000 links with a progress message after each. IndexedDB commits all of it or none: cancelling calls `transaction.abort()`, and a closed or crashed tab or a quota error rolls back on its own. No source is ever half-written, so there is no `importing` status, no lock and no cleanup on startup. On failure the dialog shows the error with **Try again**, since the file is still at hand. An update (§6.1) works the same way: one transaction adds the new part, puts the links (ids are stable, so links already stored are rewritten unchanged) and refreshes the stats; a re-extract deletes and rewrites the source's links in one transaction. Check the 100 MB case on Safari in M2; if one transaction is too slow there, fall back to batched writes under a pending source.
- The UI gets lean rows from the worker on load and after each `done` (§5, querying strategy). Small tables use `useLiveQuery`; the links table does not.
- Dexie `versionchange`: when another tab opens a newer schema version, this tab closes its connection and asks the user to reload, so the upgrade isn't blocked.
- No network requests in the MVP build. The first network feature, link previews (§6.8, §8.8), ships in M7 behind an opt-in setting. `next/font` fonts are self-hosted at build time.

### 8.3 Next.js 16 conventions to follow

Read `node_modules/next/dist/docs/` before writing code (see `AGENTS.md`). Relevant for this app:

- Request-time APIs (`params`, `searchParams`, `cookies()`, `headers()`) are async; only matters for the route handlers (M7).
- `next/dynamic` with `ssr: false` works only inside a Client Component (`01-app/02-guides/lazy-loading.md`); see the loader in §8.2.
- `cacheComponents` / `use cache` are not used (§8.8). Turning them on changes rendering for the whole app (Partial Prerendering by default).
- `middleware.ts` is now `proxy.ts` (not needed in MVP).
- Use the generated `PageProps<'/'>` / `LayoutProps<'/'>` helpers, as the scaffold already does.
- `next lint` is gone; `pnpm lint` runs ESLint directly (already wired).
- `experimental.useOffline` + `useOffline()` exist for an offline banner; consider when the PWA lands in Phase 3.

### 8.4 File structure

```
app/
  layout.tsx                 root layout, fonts, theme
  page.tsx                   server shell → <WorkspaceLoader /> (client) → <Workspace /> (ssr:false)
  globals.css                Tailwind v4 theme tokens
  manifest.ts                Phase 3 (PWA)
  api/preview/route.ts       M7: preview service (§8.8); resolve/ and screenshot/ later
  api/classify/route.ts      Phase 3: hosted AI mode (§8.9), once accounts exist
components/
  ui/                        shadcn-style primitives
  import/                    DropZone, PasteBox, ImportDialog, ImportProgress
  library/                   WorkspaceLoader (client; loads Workspace with ssr:false), Workspace, Toolbar, SearchBox, FacetSidebar, LinkList, LinkRow,
                             DomainGroups, CompactList, CardGrid, PreviewCard, DetailsDrawer, StatsPanel, EmptyState
  export/                    ExportDialog
  settings/                  SettingsDialog
  organize/                  OrganizeWizard, CategoryProposal, ReviewQueue, TagManager, TagEditor
lib/
  extract/                   PURE: no React, no DOM. Runs in worker and in Vitest (node env)
    adapters/                plaintext.ts, whatsapp.ts, zip.ts, markdown.ts / netscape.ts / html.ts (Phase 1.5), index.ts (registry + detect + scan)
    url/                     find.ts, repair.ts, validate.ts, extract.ts (find → repair → validate), canonicalize.ts, key.ts (urlKey + mirrors), domain.ts, classify.ts, shorteners.ts
    context.ts               context and nearby (§4.8)
    keys.ts                  message keys and link ids (§3, §5)
    pipeline.ts              detect → parse → extract → Link[]
    types.ts
  db/
    types.ts                 persisted records (§5); Link and Message stay in extract/types.ts
    schema.ts                Dexie instance + versions
    repos/                   sources.ts (+ parts, chat updates), links.ts, annotations.ts, settings.ts (+ meta)
    rekey.ts                 canonicalizer-version migration: merges, splits, orphans (§4.4)
    backup.ts                export/import JSON with zod
  export/                    csv.ts, markdown.ts, netscape.ts, plain.ts
  preview/                   derive-title.ts (Tier 0), icons.ts (Tier 1), client.ts (calls /api/preview, queue, 30-day refresh)
                             server/: guard.ts (SSRF checks), fetch-head.ts, parse-meta.ts, oembed.ts (provider list), ratelimit.ts (Redis)
  tags/                      normalize.ts, vocabulary.ts, merge.ts
  ai/                        models.ts (model IDs and per-model thinking / fallback settings, one place), client.ts (own-key; hosted in Phase 3),
                             prompts/ (discovery.ts, tagging.ts; versioned), schema.ts (zod → JSON schema), run.ts (resumable tagging), cost.ts (estimates)
  query/                     filter.ts (search syntax), sort.ts, facets.ts, stats.ts
  workers/
    extract.worker.ts        imports, updates and library reads (§5, §8.2)
    protocol.ts              message types; handle.ts routes them (testable without a Worker)
    client.ts                typed wrapper around postMessage
hooks/
  useImport.ts, useLibrary.ts, useKeyboard.ts, useSettings.ts
tests/
  fixtures/                  whatsapp-android-gb.txt, whatsapp-android-us.txt, whatsapp-ios.txt, whatsapp-ios.zip,
                             whatsapp-de.txt, whatsapp-update-older.txt + whatsapp-update-newer.txt (overlapping exports),
                             plaintext.txt, urls-edge-cases.txt; markdown.md and bookmarks.html in Phase 1.5
  e2e/                       import-search-export.spec.ts
  eval/                      tags-labeled.json (≈150 hand-tagged links, anonymized), recorded model responses
docs/
  PRD.md                     this document
```

### 8.5 Testing strategy

- **Golden tests** per adapter: fixture in → expected `Message[]` / `Link[]` JSON out. Adding a new locale or bug report means adding a fixture line and its expectation.
- **URL edge-case table** (`urls-edge-cases.txt`): one candidate per line with the expected extraction, or `∅`. This is the regression suite for the regex and repair rules.
- Component tests for the import dialog, search syntax and export formatting.
- One Playwright E2E using the sample fixture.
- Dexie repos (import atomicity and cancel, chat updates, re-key with merges, splits and orphans, backup merge) under Vitest with `fake-indexeddb`.
- Fixtures and the eval set are anonymized before they are committed (names, phone numbers, private URLs). The raw exports they came from stay out of git.
- CI: `pnpm lint && pnpm typecheck && pnpm test` on every push; `pnpm build` on main.

### 8.6 Performance budgets

| Scenario | Target |
|---|---|
| 10 MB / 150 k-line WhatsApp export, M-series laptop | parsed and saved in < 3 s; main thread never blocked > 50 ms |
| 50 k links in the library | search keystroke → results in < 100 ms; scroll at 60 fps |
| First load, main route | < 200 kB gzipped JS before the workspace chunk; workspace lazy-loaded |
| Lighthouse | ≥ 95 performance and accessibility on the empty state |

### 8.7 Privacy and security

- No analytics, no third-party scripts, no remote fonts in the MVP.
- Rendering a URL as a link: always `rel="noopener noreferrer"` and `target="_blank"`; never render `javascript:` (validation already rejects it).
- Context snippets are rendered as text, never HTML; no `dangerouslySetInnerHTML` anywhere.
- Hosts are displayed in Unicode only when every label is in a single script, as browsers do; mixed-script hosts (a Cyrillic `а` in `аpple.com`) are shown in punycode.
- Exports escape formula and markup characters (§6.5).
- Link previews (M7) are opt-in per action, send only URLs to our route handler, and show exactly what will be sent.
- **Content Security Policy from M0**, as a static header from `headers()` in `next.config.ts`. The bundled guide (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`) offers three routes. Nonces force every page into dynamic rendering (no static shell, no CDN caching), so they are not used. `experimental.sri` only adds `integrity` attributes to external scripts, and those do not authorize the inline `<script>` tags in which the App Router streams its payload, so `script-src` needs `'unsafe-inline'`. Checked in M0 (21 Oct 2026, Next.js 16.3.4): with `experimental.sri` and `script-src 'self'`, the 5 external scripts got `integrity` attributes, but the page's 2 inline scripts were blocked and hydration failed (React error #412). `'unsafe-inline'` stays; re-check if a Next.js upgrade changes how the payload is delivered. Styles need `'unsafe-inline'` too: Radix-based dialogs inject a `<style>` tag for scroll locking. Development adds `'unsafe-eval'`.
- The CSP is defense in depth (`connect-src`, `object-src`, `base-uri`, `form-action`, `frame-ancestors`). It does not protect a stored API key: from M7, `img-src https:` lets injected script send data out through an image URL. The protection is having no injection point (the rules above).
- The header is fixed per deploy, so it cannot widen when one user turns a setting on. It grows by milestone instead:

| From | Directives |
|---|---|
| M0 | `default-src 'self'; script-src 'self' 'unsafe-inline'` (see above); `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob:`; `font-src 'self'`; `worker-src 'self' blob:`; `connect-src 'self'`; `object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| M7 | `img-src` adds `https:` (favicons, video thumbnails and preview images come from arbitrary hosts; this also opens the image-URL exfiltration path above) |
| M8 | `connect-src` adds `https://api.anthropic.com` (own-key mode) |

### 8.8 Preview service (M7)

`GET /api/preview?url=…` in `app/api/preview/route.ts`. It is the only server code in the app until Phase 2 (Tier 3 routes) and Phase 3 (hosted AI).

1. **Guard.** Accept http/https only; canonicalize; reject IP-literal hosts in blocked ranges. Check the resolved address at connect time, not before: `fetch` runs through an `undici` `Agent` whose `connect.lookup` rejects loopback, private, link-local, CGNAT, multicast, unspecified and metadata addresses (IPv4 `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `224/4`; IPv6 `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, and IPv4-mapped `::ffff:0:0/96` checked as IPv4). Resolving first and fetching second would let the DNS answer change in between (DNS rebinding). `redirect: 'manual'`; every hop goes through the same guard; at most 3 redirects. Without this the endpoint is an open proxy into wherever it is hosted.
2. **Fetch.** 8 s timeout; `Accept: text/html`; an honest User-Agent (`LinkVaultBot/1.0 (+https://<site>/bot)`); read at most 512 KB and stop at `</head>`; never execute scripts.
3. **Parse.** Small head tokenizer (or `htmlparser2`). Precedence: oEmbed for known providers → `og:*` → `twitter:*` → `<title>` / `<meta name="description">`. Resolve relative image and icon URLs against the final URL. Keep `og:type`, `og:site_name`, `article:published_time`.
4. **Respond.** `{ url, finalUrl, status, httpStatus, title, description, image, siteName, ogType, favicon, publishedAt, fetchedAt }`; on failure `status` is `dead` (404/410), `blocked` (403/429 or bot challenge), or `error`.
5. **Cache.** Successful responses carry `Cache-Control: public, s-maxage=604800, stale-while-revalidate=86400` (`dead`: one day; `blocked` / `error`: one hour), so Vercel's CDN answers repeat requests for the same URL across users without running the function. The client always sends the canonical URL, so equal links share one entry. `use cache` is not used: it needs `cacheComponents: true`, which changes rendering for the whole app, and its default in-memory store does not persist across serverless invocations (bundled `use-cache.md`, "Runtime caching considerations"). The browser's `enrichments` table is the primary cache regardless.
6. **Limits and logging.** Per-IP rate limit and per-host concurrency of 2, both held in Upstash Redis, since serverless instances share no memory; CDN hits skip both. A denylist of hosts that object. Our code logs no URLs, but the platform's request logs may record each call's full URL, query string included; the settings copy says so. If that becomes unacceptable, switch to `POST` with a Redis-backed cache: URLs leave the access log, and CDN caching goes.
7. **Images.** The browser loads `og:image` straight from the site with `<img loading="lazy" referrerpolicy="no-referrer">`; `next/image` is not used because hosts are arbitrary. An optional `/api/image` proxy (size-capped) can come later for users who want the site to see nothing at all.
8. **Third-party alternative.** Microlink, iframely or Peekalink do all of this as a paid API. Fine as a fallback or to skip the work; the trade is sending every URL to a third party and a per-request cost. Recommended default: own route handler.

### 8.9 Classification service (M8)

M8 ships own-key mode only: `lib/ai/client.ts` calls the Anthropic API from the browser with the user's key, and our server is not involved. Hosted mode (our key behind `app/api/classify/route.ts`) waits for Phase 3, when accounts give it a user to cap (§6.9); the client keeps a transport seam so it can slot in later. Prompts live in `lib/ai/prompts/` and are versioned. Load the `claude-api` skill before implementing, and verify every model ID, parameter name and price in this section against it. They were checked against it for v2.4 (October 2026), but models and prices move, so check again at M8.

- **Model.** Model IDs live in one constant (`lib/ai/models.ts`), never in prose or scattered through calls, next to each model's thinking and fallback settings. Tagging defaults to the cheapest model that clears the eval bar (precision and recall per tag, below); at October 2026 prices that is likely Claude Haiku 5.5 (`claude-haiku-5-5`). Discovery, one call per run, uses Claude Opus 5.5 (`claude-opus-5-5`) with effort set explicitly to `high`, since Opus 5.5 defaults to `medium`. Tagging keeps thinking to a minimum, because thinking tokens bill as output and three labels per link don't need it, but the setting differs per model: Haiku 5.5 accepts `thinking: {type: "disabled"}` at effort `high` or below; Sonnet 5.5 rejects `disabled` and takes `{type: "between_tools"}`; Opus 5.5 cannot turn thinking off, so it runs at effort `low`. Users can pick another model in Settings. Always check `stop_reason` before reading content. Refusal fallbacks (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta) are set on models that support them (Opus 5.5, Sonnet 5.5); Haiku 5.5 has no server-side fallback, so a refused request leaves its links unclassified and the wizard says so.
- **Structured output.** A JSON schema through `output_config.format` (the SDK's `parse` helper), generated from the same zod schema the app validates with. No free-text parsing.
- **Prompt caching.** The stable part first (rules, output schema, the vocabulary sorted by slug, a few examples per tag) under `cache_control`; the volatile rows after it. Any byte change in the prefix invalidates the cache, so the vocabulary is serialized deterministically. Verify with `usage.cache_read_input_tokens` in development. A small vocabulary can fall below the model's minimum cacheable prefix length, in which case nothing is cached.
- **Bulk.** Synchronous requests of about 40 links each, a few in flight at once. Each `Classification` is saved as its response arrives, so closing the tab loses only the requests in flight, and reopening the wizard resumes: rows whose `inputHash` and `promptVersion` are current are skipped. The Message Batches API (asynchronous, half price) is not used: at Haiku 5.5 prices it would save about $0.12 per 5,000 links, which does not pay for a job table and resumable polling.
- **Estimate first.** `count_tokens` on a sample gives the number shown in the wizard.
- **Evaluation.** `tests/eval/tags-labeled.json`: about 150 links from the owner's own export, hand-tagged and anonymized before commit. A Vitest test scores precision and recall per tag against recorded responses (no network, so CI stays free); `pnpm eval:tags` runs live on demand. Every prompt change bumps `promptVersion` and re-runs the eval. The same run picks the default tagging model and the review-queue threshold (§6.9). Starting bar: precision ≥ 0.85 and recall ≥ 0.70, averaged across tags (precision first, since a wrong tag costs more than a missing one); revisit after the first eval run.
- **Key handling.** Session-only by default; "Remember on this device" stores it unencrypted in IndexedDB (§6.9), where injected script could read it and, from M7, send it out despite the CSP (§8.7). The settings copy recommends a key from a workspace with a spend limit, which also caps cost surprises.

Rough cost to tag 5,000 links, at about 180 input and 60 output tokens per link (row id, up to 3 tag ids with confidences, no summary, minimal thinking; any thinking that still happens bills as output on top). List prices per million input/output tokens, checked October 2026: Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 (Haiku's price holds for prompts up to 100 k tokens, far above a 40-link request). Prompt caching on the vocabulary prefix lowers the input side further. Recompute with `count_tokens` and current prices at M8.

| Model | Synchronous | Batches API (not used; for reference) |
|---|---|---|
| Claude Opus 5.5 | ≈ $9.60 | ≈ $4.80 |
| Claude Sonnet 5.5 | ≈ $4.80 | ≈ $2.40 |
| Claude Haiku 5.5 | ≈ $0.24 | ≈ $0.12 |

Later, in Phase 4: a small embedding model running in the browser (transformers.js, tens of MB) for "similar links", clustering and semantic search with nothing leaving the device; the language model then only names clusters from a handful of titles each, which is cheaper and sends less. And natural-language search ("things about cooking I saved last winter") translated by one small call into the query grammar (`tag:cooking after:2025-12 before:2026-03`) and shown as chips, so the interpretation is visible.

---

## 9. Edge cases and rules

| Case | Rule |
|---|---|
| Empty input / no URLs | Friendly empty result with the counts that *were* found (messages, non-web URLs) |
| iOS export (`.zip` with `_chat.txt`) | Unzipped in the worker; the zip name gives the chat name |
| Zip with no `.txt` inside | Error that says what to do (§7, Copy) |
| BOM, CRLF, mixed line endings | Normalize before adapters |
| Non-UTF-8 file | Decode with `TextDecoder('utf-8', { fatal: false })`; if replacement chars > 1 %, try `windows-1252`, warn |
| iOS `U+200E`, US `U+202F` | Stripped / accepted by the header regex; zero-width and bidi characters end a URL match (§4.1) |
| Sender names containing `:` in group chats | Split on the **first** `: ` only |
| System messages containing `: ` (`changed the subject to "Links: misc"`) | Not a sender unless the name is in the chat's sender set (§3) |
| Message with no sender (system message) | Keep, flag `isSystem`, exclude from stats' sender facet |
| `<Media omitted>`, `(file attached)`, `This message was deleted`, `You deleted this message` | Parsed as normal messages; contain no URLs; do not count as "links" |
| Chat with yourself: one sender, and the notice `Messages to yourself are end-to-end encrypted…` | The notice is a system message; the single sender still forms the sender set (§3) |
| Blank lines inside a message (a link, an empty line, then an emoji) | Continuation lines, empty ones included, belong to the message |
| URL glued to the word before it (`Checkhttps://…`) | Found (§4.1) |
| Template placeholder in a URL (`${id}`, `{{slug}}`) | Not a link (§4.3) |
| Token ending in `_` (`?si=Ab12_cd34_`) | Kept; only an emphasis mark that also opens the URL is stripped (§4.2) |
| Multi-line message containing a URL on line 3 | Position records the actual line |
| URL wrapped in `<>`, `()`, `[]`, `""`, trailing `.`/`,` | Repair rules §4.2 |
| Wikipedia-style balanced parentheses | Kept |
| Apostrophe inside a path (`/wiki/Schindler's_List`) | Kept; only a trailing `'` is trimmed (§4.1) |
| `www.` without scheme | `https://` prepended |
| Uppercase scheme / host | Canonical lowercases; original preserved |
| IDN / punycode hosts | Kept as `URL` normalizes them (punycode); Unicode shown only for single-script hosts (§8.7) |
| IP hosts, `localhost`, ports, `user:pass@` | Allowed; userinfo removed from canonical URL |
| Very long URLs (> 2 k chars) | Kept; row truncates with ellipsis in the middle |
| Same URL many times | All occurrences stored; dedupe toggle collapses by `urlKey` |
| Same URL differing only in tracking params, trailing `/` or fragment | Same `urlKey` → collapse together; drawer shows the variants |
| Same page on a mirror host (`x.com` / `twitter.com`, `youtu.be` / `youtube.com`) | Same `urlKey` (§4.4, Appendix B) |
| Hash-routed apps (`https://app.example/#/inbox`) | Hash route kept in both `canonicalUrl` and `urlKey` |
| Non-web schemes (`mailto:`, `tel:`, `whatsapp://`) | Counted as skipped, not stored |
| URL split across two lines | Not joined; accepted loss |
| 100 MB file | Warn, proceed; the scan pass reads the whole file once (hash, detection, date order, sender set, message keys), then the parse pass works through it in chunks by line and the save is one transaction (§8.2) |
| Import cancelled, tab closed or crashed mid-import | No partial source: the save is one IndexedDB transaction, aborted or rolled back (§8.2) |
| Re-import of identical file | Content-hash warning against every stored part; user can proceed |
| Newer export of a chat already imported | Offered as an update; only messages with new keys add links (§6.1) |
| Newer export missing the oldest messages (WhatsApp's export limit) | Nothing stored is lost: updates merge, never replace (§6.1) |
| Timestamps missing (plain text) | Links have no timestamp; date sorts put them last; date facet shows "no date" |
| Ambiguous day/month | Inference §3; override in import dialog; stored on the source |
| Storage quota exceeded | The transaction rolls back (§8.2); catch `QuotaExceededError`, show the storage meter and what to delete |
| Canonicalizer updated, or (Phase 1.5) tracking-param list edited | Links re-keyed; annotations, previews and classifications follow through merges and splits, and rows whose links are gone are re-keyed from their own `url` (§4.4) |

---

## 10. Non-functional requirements

- No network needed while the app is open (MVP). Reloading the page offline needs a service worker, which arrives with the PWA in Phase 3.
- Browser support as per Next.js 16: Chrome / Edge / Firefox 111+, Safari 16.4+.
- Responsive from 360 px to ultrawide.
- All user-visible dates via `Intl.DateTimeFormat` in the user's locale; time zone: browser local (WhatsApp exports carry no zone).
- English UI only in the MVP; strings kept in one module so i18n is a later mechanical change.

---

## 11. Acceptance criteria

A milestone is done when every box in its list is ticked. Every post-MVP milestone also keeps the MVP's Quality items true: CI passes, new UI is keyboard-operable and passes the accessibility checks, and the §8.6 budgets still hold. The post-MVP lists are drafts; revise the next milestone's list at the gate (§12), once real use has shown what matters.

### MVP (M0–M5)

Import
- [ ] Paste text, drop a file, or pick multiple files; each becomes a source with the correct detected adapter. The import dialog appears only when a decision is needed.
- [ ] WhatsApp Android (en-GB, en-US) and iOS exports, the iOS `.zip` dropped as is, parse with correct timestamps, senders and multi-line messages (fixture tests pass).
- [ ] Plain text yields URL with line number and context; Markdown pasted as plain text yields clean URLs (no trailing `)`).
- [ ] A 10 MB export imports with visible progress and the UI stays responsive.
- [ ] Re-importing the same file warns.
- [ ] A newer export of an imported chat is offered as an update and adds only the new links; links from messages missing in the newer export stay.
- [ ] Cancelling an import, or closing the tab during one, leaves no partial source.

Extraction
- [ ] All cases in `urls-edge-cases.txt` pass.
- [ ] Original URL, canonical URL and `urlKey` stored; tracking params are stripped per their host rules, and the rest of the query keeps its original encoding; `urlKey` groups tracking-param, trailing-slash and mirror-host variants.
- [ ] Domain grouping uses the registrable domain and the alias map.
- [ ] A canonicalizer version bump re-keys stored links, and stars survive it, including stars on URLs whose source was deleted.

Browse
- [ ] Virtualized list view; dedupe toggle with occurrence counts.
- [ ] Search across URL, title, context, nearby text and sender; facets filter with counts.
- [ ] Sort by newest, oldest, domain, frequency.
- [ ] Details drawer shows context with the URL highlighted, nearby messages, metadata, source and line, copy actions, star.
- [ ] View state is in the URL; reload restores it.

Persist / export
- [ ] Data survives reload; sources can be renamed, and deleted with their links.
- [ ] Export to JSON, CSV, Markdown and plain text for view / selection / library; CSV cells starting with `=`, `+`, `-` or `@` are escaped.
- [ ] Backup JSON round-trips (export → delete everything → import → identical counts), and importing the same backup twice changes nothing.

Quality
- [ ] Keyboard-only operation of the main flows; screen reader announces progress and results.
- [ ] Lighthouse ≥ 95 performance and accessibility on the empty state; dark mode has no unreadable contrast.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass in CI.

### Gate

- [ ] The deployed MVP has been used for at least two weeks on real exports, including at least one chat update (§6.1).
- [ ] A short note in `docs/` records what was missing or annoying, whether stars got used (a stand-in for whether tags will be), and how many links have no title and no context or nearby text beyond the URL (the share M7 previews would have to fix).
- [ ] The order of P1.5 and M6–M8 is set in §12 and in §14 ("Order after the MVP"), and the next milestone's list below is revised.

### P1.5 Breadth

Import
- [ ] A Markdown file yields link text as title and tells images from links; no URL is counted twice (§4.1).
- [ ] Bookmark exports from Chrome, Firefox and Safari yield title, `ADD_DATE` timestamp and folder path (`Bookmarks bar › Recipes`); one fixture per browser.
- [ ] A saved HTML page yields its absolute links with anchor text as titles; relative `href`s are counted as skipped, since the page's address is unknown.
- [ ] A Telegram `result.json` yields timestamp, sender and chat name per link, including URLs hidden behind link text (`text_link` entities); a newer export of the same chat merges as in §6.1.
- [ ] Sources imported as plain text before these adapters existed are offered a re-extract with the newly detected adapter; their stars survive it.

Browse
- [ ] Grouped view: collapsible domain sections with counts, sorted by count, name or most recent, with expand and collapse all; scrolls at 60 fps with 50 k links.
- [ ] Compact view: one URL per line; select-all-copy gives exactly the URLs in view.
- [ ] The chosen view is in the URL and survives a reload; the drawer shows the bookmark folder for bookmark links.

Export and settings
- [ ] The Netscape export (folders per domain) imports into Chrome, Firefox, Safari and Raindrop with titles intact; a title containing `<script>` imports as plain text.
- [ ] Adding a tracking-param rule merges `urlKey`s and removing one splits them (§4.4); stars survive both. Invalid rules are rejected with a message, and "Reset to defaults" restores Appendix B.

### M6 Tags and smarter search

Tags
- [ ] Tagging a link in the drawer (autocomplete over tag names and aliases; `t` opens the editor) tags every duplicate with the same `urlKey`, and the tag survives deleting and re-importing the source.
- [ ] Tag chips on rows; a Tags facet with counts; tags on ≥ 1 % of links or ≥ 5 links are pinned as categories.
- [ ] Tag manager: renaming a tag's name or slug edits one row and every link shows the new name; merging moves its links to the target and adds its slug as an alias; deleting asks first and removes it from every link; colours apply everywhere.
- [ ] Normalization: `Recipes`, ` recipes ` and `RECIPES` become one tag; `news`, `series` and `css` are not singularized; `recipe` / `recipes` appears as a merge suggestion, and accepting it adds an alias.
- [ ] Bookmark folders become tags in one action (once P1.5 has landed).
- [ ] Tags survive a canonicalizer re-key (merged as a union) and a backup round-trip.

Search
- [ ] Every field prefix in §6.3 works, alone and combined (AND), including `-tag:` and `is:untagged`; dates accept `2023`, `2023-05` and `2023-05-25`.
- [ ] `recipes from twitter` is read as `tag:recipes site:twitter` and shown as chips; removing a chip updates the results; a word that matches no tag or site falls back to text search; stop words are ignored.
- [ ] Short site names resolve (`yt`, `gh`, `x`, `insta`, `reddit`).
- [ ] A query-parser table test (query → interpretation) covers every example in §6.3 and §6.9.
- [ ] Searches with tag filters stay under 100 ms at 50 k links, and the app still makes no network requests.

### M7 Link previews

Privacy
- [ ] With previews Off (the default), import, browse and export make no network requests beyond the app's own files (checked in devtools).
- [ ] Each tier's settings copy says what is sent and where, including that the platform's request logs may record preview URLs; the drawer's **Fetch preview** says it before sending.

Tier 1
- [ ] Rows show favicons from the named favicon service; YouTube links show thumbnails built from the video id, without calling our service.

Preview service (`/api/preview`)
- [ ] Returns title, description, image, site name, type and final URL for a fixture set: an Open Graph page, a Twitter-card-only page, a page with only `<title>` and `<meta name="description">`, and oEmbed providers (YouTube, Vimeo, Spotify).
- [ ] The guard refuses `localhost`, `127.0.0.1`, `10.0.0.1`, `169.254.169.254`, `[::1]`, `[::ffff:127.0.0.1]`, a hostname that resolves to a private address, a redirect to any of those, a fourth redirect, and non-http(s) schemes. A test resolver that answers public, then private, is refused at connect time.
- [ ] Stops at 8 s, or at 512 KB or `</head>`; sends the `LinkVaultBot` User-Agent; never runs page scripts.
- [ ] 404/410 return `dead`, 403/429 or a bot challenge return `blocked`, other failures return `error`, each with the cache lifetime in §8.8; a repeat request for the same canonical URL is a CDN hit.
- [ ] A burst from one IP gets 429s; no more than 2 requests to one host run at once; our code logs no URLs.

Client
- [ ] The drawer preview block shows every state in §6.8 (loading, preview, no preview, page not found, site blocks previews) and **Refresh**.
- [ ] Rows show fetched titles; `og:type` upgrades `kind`; the card view fills in as previews arrive and stays virtualized.
- [ ] Bulk fetch on the current view shows progress, pauses, runs 4 at a time with per-host politeness, skips anything fetched in the last 30 days, and after a reload resumes by skipping what it already has.
- [ ] Duplicates share one preview; previews survive a re-key; images load lazily with `referrerpolicy="no-referrer"`.
- [ ] The Markdown export (and the Netscape export, once P1.5 has landed) uses fetched titles; the JSON backup includes previews.
- [ ] The CSP adds `img-src https:` and nothing else.

### M8 AI categorization

Settings and privacy
- [ ] With AI Off (the default), nothing is sent to `api.anthropic.com`; with a key set, requests go from the browser to Anthropic and none reach our server.
- [ ] The key is kept for the session unless "Remember on this device" is on; the copy says it is stored unencrypted and recommends a spend-limited key; clearing it works.
- [ ] A test on the request builder confirms what is sent per link: site, title, description, path without query, up to 200 characters of message text, and the vocabulary; never sender names. With "Include chat context" off, no message text. The same list appears in Settings and in the wizard before the first request.

Organize flow
- [ ] Step 1 fetches previews for links that lack one; links still without signal are marked "needs preview" and are not sent.
- [ ] Discovery samples at most 400 links (half proportional, half stratified by domain) and proposes 8–25 categories, each with a description, aliases, examples and a rough share; each can be accepted, renamed, merged or dropped.
- [ ] Before tagging, the wizard shows a cost and time estimate from `count_tokens`; on a 500-link run the actual cost is within 25 % of it.
- [ ] Tagging sends about 40 links per request, validates every response against the zod schema and checks `stop_reason`; a refused request leaves its links unclassified and the wizard reports them.
- [ ] Closing the tab mid-run and reopening the wizard resumes the run; rows with a current `inputHash` and `promptVersion` are never re-sent.
- [ ] From the second request of a run, `usage.cache_read_input_tokens` is above zero (when the vocabulary prefix clears the model's minimum cacheable length).

Results
- [ ] AI tags show as dashed chips marked "AI"; accepting makes them the user's own; rejecting stores them in `rejectedTags`, and a re-run never suggests them again.
- [ ] Results below the threshold go to the review queue (`y` / `n` / `e`, with preview and context visible).
- [ ] A new-tag proposal appears as a candidate once 5 links share it.
- [ ] "Suggest tags" in the drawer tags one link and adds a one-line summary.

Eval
- [ ] `tests/eval/tags-labeled.json` holds about 150 anonymized, hand-tagged links; a Vitest test scores precision and recall per tag against recorded responses with no network; `pnpm eval:tags` runs it live.
- [ ] The default tagging model is the cheapest that clears the eval bar (§8.9), and the review-queue threshold comes from the same run; both are recorded in `lib/ai/models.ts`.
- [ ] Model IDs, prices and parameters were re-checked against the `claude-api` skill at the start of M8.
- [ ] The CSP adds `https://api.anthropic.com` to `connect-src` and nothing else.

---

## 12. Milestones and implementation order

| # | Milestone | Scope | Size |
|---|---|---|---|
| M0 | Foundations | React Compiler on, `strict` TS options, `typecheck` and `test` scripts, Vitest + RTL + `fake-indexeddb`, Prettier, static CSP header (§8.7, with one SRI check against a production build), Dexie schema + repos + `versionchange` handling, worker scaffold with typed client, fixtures folder, CI workflow | S |
| M1 | Extraction core | `linkify-it` spike against the edge-case table (§4.1), then `lib/extract`: plaintext, WhatsApp and zip adapters, detection and the scan pass (date order, sender set, message keys), URL find/repair/validate/canonicalize/`urlKey`/domain/classify, context and nearby, golden tests, edge-case table | M |
| M2 | Import flow | Drop zone, paste, scan with the import dialog only when a decision is needed (adapter, day/month, duplicate, update), worker wiring with progress and cancel, single-transaction imports, updating a chat by message key, result summary, sample data, hash-dedupe of files | M |
| M3 | Browse | Workspace layout behind the client loader (§8.2), lean rows from the worker, virtualized list view, Tier-0 derived titles, plain search, facets, sort, dedupe toggle, details drawer with an empty preview slot, URL-synced state, keyboard nav | M |
| M4 | Persist and export | Source rename/delete, re-extract (with adapter and day/month override), canonicalizer re-key (merges, splits, orphans), annotations (star), JSON / CSV / Markdown / plain exports with escaping, backup import, gzipped raw parts, settings, storage meter and `persist()` request, delete flows | M |
| M5 | Polish and ship | Empty states, mobile layout, dark mode pass, a11y audit, Lighthouse, Playwright E2E, README, deploy to Vercel | M |
| Gate | Use it | Use M0–M5 on real exports for a couple of weeks. Then order Phase 1.5 and M6–M8 from what that shows (do you need the other sources and views? do you actually tag? which links lack signal?) | — |
| P1.5 | Breadth | Markdown and Netscape bookmarks adapters, generic HTML adapter, Telegram JSON; grouped and compact views; Netscape HTML export; editable tracking-param list (saving re-keys, §4.4) | M |
| M6 | Tags and smarter search | Tag vocabulary with immutable ids, tags on annotations, tag chips, drawer tag editor with autocomplete, Tags facet with category pinning, Tag manager (rename, merge with alias, merge suggestions, delete), bookmark folders → tags (once the Phase 1.5 bookmarks adapter exists), the full search grammar: field prefixes, `tag:` / `site:`, plain-word matching and interpretation chips (§6.3, §6.9 layers 1–2). No server needed | M |
| M7 | Link previews | §6.8 Tiers 1 and 2: settings tier, favicons and video thumbnails, `/api/preview` with connect-time guard, CDN cache and Redis rate limits (§8.8), drawer preview block, row titles, card view, bulk fetch with progress, exports use titles, CSP `img-src` widened | M |
| M8 | AI categorization | Settings → AI with own-key mode, discovery pass with proposal review, tagging pass (synchronous, resumable by `inputHash`), per-model thinking settings, review queue with eval-calibrated threshold, Organize wizard with estimates, "Suggest tags" per link, labeled eval set and recorded-response tests, model default chosen by the eval, CSP `connect-src` widened (§6.9 layer 3, §8.9) | L |
Each milestone, and the gate, is done when its list in §11 is ticked. Phase 1.5 is the default next step after the gate and the easiest to reorder: nothing in M6–M8 depends on it except turning bookmark folders into tags. Tags (M6) come before previews (M7): they are client-only and show whether tagging gets used before any server infrastructure is built. Only M8 depends on M7.

Build order inside the codebase: `lib/extract/types.ts` → `url/*` with tests (after the `linkify-it` spike) → `adapters/plaintext` → `adapters/whatsapp` with fixtures → `adapters/zip` → `keys.ts` → `pipeline.ts` → `db/schema.ts` → worker → import UI (with chat updates) → browse UI → export.

---

## 13. Roadmap after the MVP

**Phase 2 — Beyond previews (opt-in, builds on §8.8)**
- Link previews themselves are M7 (§6.8). Phase 2 adds the Tier-3 items: shortener resolution (`HEAD` follow) through `app/api/resolve/route.ts`, dead-link sweep with a Wayback Machine fallback link, real content-type from response headers.
- Optional real screenshots through a headless browser or a screenshot API, stored as size-capped thumbnails; off by default because of cost.
- Optional `/api/image` proxy so preview images never load from the original site.

**Phase 3 — Everyday use**
- PWA: manifest, service worker, installable; **Web Share Target** so "share to LinkVault" from any app on Android / desktop Chrome saves a link directly. This closes the loop on the original "send links to myself" habit. It also enables offline reloads (§10), and a home-screen install escapes Safari's storage cap (§15); pull it forward if Safari users lose data.
- Status (unread / read / archived), notes, saved searches. Saved searches are the named views that Collections used to be; add collections only if saved searches don't cover it. Tags themselves moved up to M6.
- Hosted AI mode (§8.9), once sync gives users an identity: per-account daily cap held in Redis, request size cap, no payload logging, key only on the server.
- Optional cloud sync (Supabase) as an explicit opt-in with end-to-end encryption of the payload; the app stays fully functional without it.
- Browser extension: save current tab, import browser history / bookmarks directly.

**Phase 4 — Intelligence**
- Categorization is M8 (§6.9, §8.9). Phase 4 adds natural-language search translated into the query grammar, per-link summaries surfaced in the drawer, and vision on preview images (a food photo is a strong recipe signal). (When implementing, load the `claude-api` skill rather than working from memory.)
- Weekly digest of neglected links; "this week last year"; duplicates and near-duplicates (same article syndicated).
- Local embeddings in the browser for "similar links", clustering and semantic search with nothing leaving the device; the model only names clusters.

Longer list of ideas (imports from Pocket / Raindrop / browser bookmarks, RSS out, webhooks, shared boards, reader mode, highlights) stays in v1's appendix as a backlog; none of it changes the MVP architecture.

---

## 14. Open decisions

Each has a recommended default; building proceeds on the default unless changed.

| Decision | Options | Recommended default |
|---|---|---|
| Product name | LinkVault / linkthing / other | **LinkVault** as product name; repo stays `linkthing` |
| Hosting target | Vercel with server features / pure static export | **Vercel, default output** (keeps M7 possible; MVP still makes no server calls) |
| UI primitives | shadcn/ui-style copies / hand-rolled everything / a full component library | **shadcn-style copies** for the 5–6 accessible primitives only |
| MVP adapters | plaintext + WhatsApp only / + Markdown / + Netscape bookmarks / + generic HTML | **plaintext + WhatsApp, including iOS zip exports**; Markdown, Netscape bookmarks and generic HTML in Phase 1.5 |
| Re-exports of a chat | new source / replace / merge | **Merge** into the existing source by message key (§6.1); WhatsApp's export limit rules out replacing |
| Import dialog | always / only when a decision is needed | **Only when needed**; re-extract fixes a wrong guess |
| Import atomicity | pending source + lock + startup cleanup / one transaction | **One IndexedDB transaction** (§8.2); batched writes only if Safari can't handle 100 MB that way |
| URL finder | hand-written regex / `linkify-it` | **Hand-written regex**: decided in the M1 spike (65/65 edge cases against 47/65, §4.1) |
| MVP views and search | list + grouped + compact with field prefixes / list with facets | **List view with facets**; grouped and compact in Phase 1.5, the full search grammar in M6 |
| Bare domains without scheme | extract / ignore / toggle | **Ignore by default**, toggle later |
| Tracking-param stripping | on / off / per-domain | **On, with per-host rules**; built-in list in the MVP, editable in Phase 1.5; original always kept |
| URL identity | `url` / `canonicalUrl` / a separate dedupe key | **`urlKey`** for dedupe and every per-URL table; canonicalizer versioned, with re-keying (§4.4); per-URL rows keep an as-found `url` so orphans can be re-keyed |
| Collections in the MVP | full collections / none (Sources facet) | **None**; the Sources facet narrows the library, saved searches (Phase 3) give named views |
| Annotations in MVP | none / star only / star + tags | **Star only**; tags in M6, status and notes in Phase 3 |
| Search index | in-memory filter / MiniSearch from day one | **In-memory** over lean rows; MiniSearch when > 100 k links |
| CSP | nonces / `'unsafe-inline'` / SRI | **`'unsafe-inline'`** in a static header: nonces force dynamic rendering, and SRI does not cover the App Router's inline scripts (confirmed in M0: hydration fails without `'unsafe-inline'`) |
| Order after the MVP | previews → tags → AI / tags → previews → AI | **Phase 1.5 → tags (M6) → previews (M7) → AI (M8)**, set at the gate of real use |
| Preview fetcher | own route handler / third-party API (Microlink, iframely) | **Own route handler** (§8.8); no per-request cost, URLs stay with us |
| Preview timing | M7 after the MVP / inside the MVP | **M7**; the MVP keeps its zero-network promise, and the schema and UI slots are already in place |
| Preview cache | `use cache` / CDN `Cache-Control` / Redis | **CDN `Cache-Control`** on the GET response; the browser's table is the primary cache |
| Preview request | GET (CDN-cacheable; URL can appear in platform request logs) / POST + Redis cache | **GET**, disclosed in the settings copy |
| Preview images | load from the site directly / proxy through our server | **Direct** with `no-referrer`; proxy as a later setting |
| AI modes | hosted only / own key only / both | **Own key only in M8**, default Off; hosted in Phase 3, once accounts give it a user to cap |
| Taxonomy | fixed list / fully emergent / hybrid | **Hybrid**: AI-proposed categories reviewed by the user, plus free tags, with a size threshold deciding what counts as a category |
| Classification model | top tier / cheapest that passes the eval | **Cheapest model that clears the eval** for tagging; most capable model for discovery; selectable in Settings |
| Data sent for tagging | metadata only / metadata + chat context | **Metadata + up to 200 chars of message text** (own and nearby messages), with a toggle to drop it |
| Bulk transport | synchronous / Batches API | **Synchronous**, resumable by `inputHash`; Batches would save about $0.12 per 5,000 links on Haiku 5.5 (§8.9) |

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| WhatsApp export formats keep drifting across app versions and locales | Fixture-driven adapter; "report a parsing problem" affordance that copies the first 20 lines (user-redacted) into an issue template; adapter versioning + re-extract |
| iOS exports are zips, so a `.txt`-only importer fails every iPhone user | Zip adapter in the MVP (§3) |
| People re-export the same chat every few months; duplicates pile up, and WhatsApp's export limit drops the oldest messages from newer exports | Updating a chat merges by message key (§6.1); nothing already stored is replaced |
| Regex URL extraction has a long tail of false positives / negatives | Edge-case table as the contract; conservative defaults; never silently drop, always count skipped |
| Safari deletes script-writable storage, IndexedDB included, for a site not visited within 7 days of Safari use (home-screen web apps are exempt). For a local-first app this is the biggest data-loss risk | `navigator.storage.persist()` after the first import (verify what it buys on Safari); raw input gzipped; storage meter; backup export prompt after big imports, with backup import as the restore path; the installable PWA (Phase 3, pulled forward if needed) |
| Changing the canonicalizer or tracking-param list orphans stars, tags and previews | Everything per-URL is keyed by `urlKey`; the canonicalizer is versioned and a change re-keys stored data, including splits and rows whose links are gone (§4.4) |
| Large inputs freeze the tab | Worker + two-pass scan/parse + batch writes; cancel button; atomic imports (§8.2) |
| Preview service abused as an open proxy (SSRF) or as a scraper | Guard step in §8.8: scheme checks, address checks at connect time on every hop, redirect cap, size and time caps, Redis-backed rate limit, honest User-Agent |
| Social links, the ones people send themselves most, preview poorly (Instagram needs a token; X, Facebook and LinkedIn often block). The owner's export: 46 % of links on X/Twitter, 17 % Reddit share links, 8 % Instagram, and 89 % of link messages with no text beside the link | Expected and labelled "Site blocks previews"; Tier 0 fallback; context and nearby text still feed tagging; the UI says "needs preview" instead of guessing |
| Tag sprawl (hundreds of near-duplicate tags) | Normalization and aliases, merge suggestions, category threshold, new-tag proposals held as candidates until 5 links share them |
| Wrong or over-broad AI tags | Confidence gating with an eval-calibrated threshold, review queue, rejected-tag memory, the labeled eval set on every prompt change |
| Cost surprises | Estimate before every run; own-key mode means the user's own spend limits apply; cheapest-passing model by default (Haiku 5.5 tags 5,000 links for about $0.24); re-runs limited to changed rows |
| AI features erode the privacy story | Off by default; own-key only, so our server is not in the loop; exact data sent listed in Settings and again in the wizard |
| Hosted AI mode becomes a free model proxy on our key | Not shipped until accounts exist (Phase 3) |
| Scope creep from the (long) backlog | The MVP list in §6 and criteria in §11 are the contract; everything else is a phase; the post-M5 gate decides what comes next |

---

## Appendix A — Sample inputs

WhatsApp (Android, en-GB), the original sample:

```
25/05/2023, 19:48 - Cris: https://twitter.com/JussiKemppainen/status/1661482544892882946?t=trOwVVd-Chr91pimPwrc7A&s=08
25/05/2023, 22:54 - Cris: https://youtube.com/shorts/XbcpYQGXu2I?feature=share
28/05/2023, 00:28 - Cris: Salt, pepper, garlic powder, aromat
29/05/2023, 16:18 - Cris: IMG-20230529-WA0005.jpg (file attached)
AI tools apps in one place sorted by category
30/05/2023, 00:36 - Cris: https://react.gg/?twclid=2-3oef9v2rpf5gpybctnr5tbf4c&s=08
```

Expected links (after canonicalization):

| url (as found) | canonicalUrl | domain | kind | timestamp | sender |
|---|---|---|---|---|---|
| `https://twitter.com/JussiKemppainen/status/1661482544892882946?t=…&s=08` | `https://twitter.com/JussiKemppainen/status/1661482544892882946` | twitter.com | social | 2023-05-25 19:48 | Cris |
| `https://youtube.com/shorts/XbcpYQGXu2I?feature=share` | `https://youtube.com/shorts/XbcpYQGXu2I` | youtube.com | video | 2023-05-25 22:54 | Cris |
| `https://react.gg/?twclid=…&s=08` | `https://react.gg/` | react.gg | other | 2023-05-30 00:36 | Cris |

On Twitter/X any `s` is stripped. Elsewhere only a two-digit `s` is (Appendix B): the owner's export had 55 such values on GitHub and other sites, the same shape as X's share codes, while a WordPress search (`?s=oak+shelf`) keeps its words.

Markdown:

```
Reading list:
- [React docs](https://react.dev/learn) — start here
- <https://vitest.dev>
- See also www.example.com/guide.
```

Plain text:

```
Meeting notes 2024-01-10
Deck: https://docs.google.com/presentation/d/abc123/edit#slide=id.p (needs access)
Repo (https://github.com/org/repo).
```

## Appendix B — Reference lists (initial)

Tracking params, as `TrackingParam` rules (§5):

- Everywhere: `utm_* fbclid gclid gclsrc dclid gbraid wbraid msclkid igshid igsh mc_cid mc_eid mkt_tok rdt_cid twclid ttclid ref_src ref_url _ga _gl yclid vero_id oly_anon_id oly_enc_id`.
- `ref`: everywhere except github.com, gitlab.com and bitbucket.org, where it names a branch or tag.
- `t`: only on twitter.com / x.com. (`t` on YouTube is a timestamp and stays.)
- `s`: any value on twitter.com / x.com; elsewhere only when the value is two digits (`value: '^\\d{2}$'`), the share code that travels with links shared from X. A WordPress search (`?s=oak+shelf`) keeps its words.
- `feature`: only on youtube.com / youtu.be. `si`: only on youtube.com / youtu.be and open.spotify.com.

Mirrors (same page; rewritten in `urlKey`, §4.4): `x.com, mobile.twitter.com, fxtwitter.com, vxtwitter.com → twitter.com`; a tweet at `/<user>/status/<id>` or `/i/status/<id>` → `twitter.com/i/status/<id>` (X ignores the username, and the owner's export had both forms); `youtu.be/<id>` and `youtube.com/shorts/<id>` → `youtube.com/watch?v=<id>`; `m.youtube.com, www.youtube.com → youtube.com`; `old.reddit.com, np.reddit.com, www.reddit.com → reddit.com`; `m.facebook.com, fb.com → facebook.com`; `<lang>.m.wikipedia.org → <lang>.wikipedia.org`.

Domain aliases (display grouping, §4.5): every mirror above, plus `music.youtube.com → youtube.com` and `redd.it → reddit.com` (Reddit's video and image hosts, `v.redd.it` and `i.redd.it`).

Shorteners: `t.co bit.ly tinyurl.com goo.gl maps.app.goo.gl g.co share.google search.app lnkd.in ow.ly buff.ly is.gd rebrand.ly cutt.ly amzn.to amzn.eu fb.me`. Share-link paths: `reddit.com/r/<sub>/s/<id>`, `facebook.com/share/…`.

Kind heuristics: `video` = youtube, vimeo, twitch, tiktok, loom, v.redd.it, or `.mp4/.webm`; `social` = twitter/x, instagram, threads, bsky.app, mastodon-ish `/@user/`, reddit, facebook, linkedin posts; `code` = github, gitlab, codesandbox, stackblitz, npmjs, crates.io, pypi; `image` = `.png .jpg .jpeg .gif .webp .svg`, imgur; `document` = `.pdf .docx .pptx`, docs.google.com, notion.site; `audio` = spotify, soundcloud, podcasts.apple.com, `.mp3`; else `other`.

## Appendix C — Starter prompt for implementation sessions

```
# LinkVault — implementation session

Read docs/PRD.md first; it is the contract. Then read the Next.js 16 docs in
node_modules/next/dist/docs/ for anything you touch (AGENTS.md explains why).

Stack: Next.js 16.3 App Router (Turbopack, React Compiler on), React 19.2, TypeScript strict,
Tailwind v4, Dexie (IndexedDB), Web Worker for extraction, fflate for zip, Vitest + fixtures, pnpm.

Rules:
- lib/extract is pure TypeScript: no React, no DOM, must run in a worker and in Vitest's node env.
- Every adapter and every URL rule gets a fixture/expectation before or with the code.
- No network calls in the MVP. Text never leaves the browser.
- Times are epoch ms numbers. Source ids are crypto.randomUUID(); link ids are stable hashes (§5).
- Per-URL data (annotations, enrichments, classifications) is keyed by urlKey (§4.4), never by url or canonicalUrl;
  each row also stores an as-found url so it can be re-keyed.
- Imports, chat updates and re-extracts are one IndexedDB transaction each (§8.2).
- Strip tracking params from the raw query string, never through URLSearchParams (§4.4).
- Follow the file structure in PRD §8.4 and the build order in §12.
- AI work (M8): load the claude-api skill first. Own-key mode only; model IDs and per-model thinking settings in
  lib/ai/models.ts, defaults chosen by the eval; structured outputs, prompt caching on the vocabulary prefix,
  synchronous requests resumable by inputHash; prompts are versioned in lib/ai/prompts and scored by tests/eval.

Current milestone: <M0 | M1 | …>. Start with the first unchecked item in that milestone,
keep changes small, and run pnpm lint && pnpm typecheck && pnpm test before reporting back.
```

---

## Document history

| Date | Change |
|---|---|
| Sept 2026 | v1: initial PRD from planning session (WhatsApp-only) |
| 1 Sept 2026 | v2: generalized to any text source via adapters; URL canonicalization and domain grouping specified; Dexie + worker architecture; stack updated to Next.js 16.3 / React 19.2 / Tailwind v4; testing, performance, privacy, milestones and open decisions added |
| 1 Sept 2026 | v2.1: link previews specified (§6.8 tiers and UX, §8.8 preview service, `Enrichment` model, card view, milestone M6, decisions and risks) |
| 2 Sept 2026 | v2.2: categories and tags specified (§6.9 three layers, Organize flow, Settings → AI; §8.9 classification service; `Tag`, `Classification` and job models; search grammar with `tag:` / `site:` and plain-word matching; milestones M7 and M8; decisions and risks) |
| 28 Sept 2026 | v2.3: review fixes. CSP via SRI in a static header that grows per milestone; client loader for `ssr: false`; preview cache moved to CDN headers and rate limits to Redis; connect-time SSRF checks; one `urlKey` for all per-URL data, with canonicalizer versioning and per-host tracking-param rules; atomic imports, stable link ids, immutable tag ids, lean in-memory rows, trimmed indexes; two-pass import; `nearby` context; Netscape bookmarks in the MVP; Collections dropped from the MVP; tags renumbered to M6 and previews to M7, with a post-MVP gate; own-key-only AI in M8, hosted mode moved to Phase 3; model default chosen by eval, cost table re-estimated; export escaping, IDN display, Safari storage risk; contradictions between sections resolved |
| 21 Oct 2026 | v2.4: second review. iOS zip exports in the MVP; updating a chat from a newer export, merged by message key (WhatsApp's export limit rules out replacing); MVP trimmed to plaintext + WhatsApp with a list view and facets, moving the Markdown and Netscape adapters, grouped and compact views, Netscape export and the editable tracking-param list to Phase 1.5 and the field prefixes to M6 (backup import stays as the Safari restore path); single-transaction imports replace the `importing` status and Web Lock; raw input gzipped in a `sourceParts` table; re-keying handles splits and orphans through an as-found `url` on per-URL rows; tracking params stripped from the raw query string; `'` allowed inside URLs, `~` trimmed, `linkify-it` spike in M1; lean rows built in the worker; import dialog only when needed; CSP on `'unsafe-inline'` and no longer presented as protecting a stored key; AI prices and per-model thinking settings updated, Batches API and the `jobs` table dropped; Appendix A `s=08` contradiction fixed |
| 21 Oct 2026 | v2.5: acceptance criteria for the gate, P1.5 and M6–M8 (§11); a starting eval bar for AI tagging (§8.9); Vimeo thumbnails moved from Tier 1 to Tier 2, since they can't be built from the video ID (§6.8) |
| 21 Oct 2026 | v2.6: rules from the owner's first export (Android en-GB, 4,644 links) and the M1 spike. Hand-written regex chosen over `linkify-it` (65/65 against 47/65 edge cases); no `\b` before the scheme; emphasis marks stripped only when they also open the URL; template placeholders rejected. Two-digit `s` stripped everywhere (Appendix A's `react.gg` expectation restored), `si` on Spotify, more global tracking params; tweets keyed by id, Shorts folded into `watch?v=`; Google, Amazon and Reddit/Facebook share links flagged as shorteners; `nearby` skips bare-link neighbours; new edge cases in §9; `TrackingParam.value` |
| 21 Oct 2026 | v2.7: `urlKey` also folds `http`/`https` and `www.`; `redd.it` grouped under reddit.com; share links (20 % of the owner's links) noted as resolvable through M7 previews' `finalUrl` (§4.7) |
