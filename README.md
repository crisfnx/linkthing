# LinkVault

**Drop in any text — chat exports, notes, logs — and get every link back, organized, searchable and yours.**

LinkVault (working name; the repo is `linkthing`) is a local-first web app for rescuing links from the places people dump them: a WhatsApp chat with yourself, a group chat, meeting notes, an old export. Paste or drop the text in, and every link comes back cleaned up, de-duplicated, grouped by site, and kept with whatever context the source carries: who sent it, when, and what was said around it.

Nothing leaves your browser. There's no account and no upload.

> **Status: early development.** Importing and browsing work: drop in a chat export or any text (or click **Try with sample data**), then search, filter, sort and open every link, all in your browser. Managing sources, stars and exports (M4) is next. The UI is deliberately plain until a design system is chosen.

---

## Why

Chats and notes make good "save for later" bins and bad libraries. The links are all in there, but finding the one you saved about something months ago means scrolling or grepping. LinkVault keeps the convenience of sending yourself a link and adds the part that's missing: getting it back.

## Principles

- **Local-first, private by default.** Your text is processed and stored in your browser (IndexedDB). Later features that need the network are opt-in, and say what they send before they send it.
- **Any text in.** If it has links, they come out. Known formats such as WhatsApp add dates and senders, and plain text still works.
- **Fast on big inputs.** A 10 MB chat export is normal. Parsing runs in a Web Worker, so the page never freezes.
- **Lossless in, useful out.** The original input is kept, so links can be re-extracted when the parser improves. Every link keeps both its original and its cleaned URL.
- **Easy to leave.** Everything can be exported in formats other tools understand.

## Features

### Built: the extraction engine

- **Reads WhatsApp exports** from Android and iPhone (`.zip` included) in many date and time formats: UK, US, German, ISO, 12- and 24-hour clocks, plus Korean, Chinese and Spanish times. Anything else is read as plain text.
- **Finds links in messy text.** Trailing punctuation, brackets, Markdown emphasis, invisible characters, links inside JSON or HTML (`https:\/\/…`, `&amp;`), and bare domains like `codesandbox.io`, which are labelled as such. It ignores look-alikes such as `console.log`, `next.js` and `design.md`.
- **Cleans them.** Strips tracking parameters (`utm_*`, `fbclid`, X's `s` and `t`, YouTube's `si`, Instagram's `igsh`, …) without touching the rest of the URL.
- **Spots duplicates.** The same tweet via `x.com`, `twitter.com` or `/i/status/`; the same video via `youtu.be`, `/shorts/` or `watch?v=`; `www.` or not, `http` or `https`.
- **Groups and labels.** Groups links by real site (`m.youtube.com` → `youtube.com`), sorts them into kinds (video, social, code, image, document, audio), and flags shorteners and share links.
- **Keeps context.** Each link keeps its sender, its time, the text around it, and, for a bare link, a note sent just before or after it.
- **Merges newer exports.** Re-exporting the same chat later adds only the new links, even when WhatsApp's export limit has cut off the oldest messages.

### Built: importing

- **Every way in.** Drop files anywhere on the page, pick several at once, paste text or read the clipboard. Or try a made-up sample chat first.
- **Asks only when it has to.** A file imported before, a newer export of a chat you have, a file that might or might not be a chat, or dates that read either way (`06/08/2022`: 6 August or 8 June?) open one short dialog. Everything else imports straight away.
- **Progress you can cancel.** Each phase is shown and announced to screen readers. Cancelling, or closing the tab, leaves nothing half-saved: each import is one database transaction.
- **A summary of what came out:** links, unique links, sites and dates, then the list of your sources.
- **Big files are fine.** A 10 MB export takes three to five seconds (Safari is the quicker), and the page stays responsive throughout. Files up to 100 MB are accepted, with a note above 25 MB that it will take a while.

### Built: browsing

- **Readable titles from the link alone.** "Post by @exampledev", "Shared post in r/webdev", "YouTube video at 1:35", "Lisbon beyond the trams": worked out from the URL, with nothing fetched. A link with nothing readable in it shows its URL.
- **A list that stays fast.** Only the rows on screen are drawn, so 50,000 links scroll and search as smoothly as 50.
- **Search that knows sites by every name.** Every word must match the URL, title, message, nearby messages or sender; capitals and accents don't matter, and `x.com` finds links shared as twitter.com.
- **Filters with counts** for sites, kinds, senders, sources and dates (by year and month), plus five sorts and a toggle that collapses duplicates into one row with a count.
- **Details for each link:** the cleaned URL and what tracking was taken out, the message with the link highlighted, nearby messages, sender, date, source and line; open, copy or star it.
- **The view lives in the address.** Bookmark a search, reload, or press Back to undo a filter.
- **Keyboard first:** `/` search, `j`/`k` move, Enter details, `o` open, `c` copy, `s` star, `Esc` close.

### Coming next: the app (MVP)

- Rename and delete sources, re-extract them, and a starred filter
- Export to a JSON backup, CSV, Markdown or a plain list, plus restore from backup
- Mobile layout, dark mode, keyboard navigation and accessibility

### Later, after real-world use

- More sources: Markdown, browser bookmark files, generic HTML, Telegram
- Tags and a search language that understands plain phrases, so `recipes from twitter` works
- Link previews (titles, images), opt-in, through LinkVault's own preview service
- AI-assisted categorization with your own Anthropic API key, opt-in and reviewable

## How it works

```
file or paste
  → unzip and decode
  → detect the source (WhatsApp, plain text, …)
  → parse into messages (time, sender, text)
  → find and repair URLs
  → clean, and compute a dedupe key
  → add context
  → links, saved in your browser
```

Extraction is pure TypeScript with no DOM or React (enforced by lint). It runs in a Web Worker in the app, and in Node for tests.

## Roadmap

| Milestone | What it delivers | Status |
|---|---|---|
| M0 · Foundations | Tooling, CI, security headers, database schema, worker scaffold | ✅ Done |
| M1 · Extraction engine | Everything under "Built" above | ✅ Done |
| M2 · Import | The first screen: drop a file, see progress and a summary | ✅ Done |
| M3 · Browse | The library: search, filters, details | ✅ Done |
| M4 · Persist & export | Manage sources, stars, exports, backups | Next |
| M5 · Polish & ship | Mobile, dark mode, accessibility; deployed | |
| Gate | Two weeks of real use before deciding what comes next | |
| Phase 1.5 · Breadth | More sources and views | |
| M6 · Tags | Tags and smarter search | |
| M7 · Previews | Opt-in link previews | |
| M8 · AI | Opt-in AI categorization | |

The full plan, with a "done when" checklist for every milestone, is in [`docs/PRD.md`](docs/PRD.md).

## Getting started

You'll need **Node 24** and **pnpm 10**.

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

Open the page and drop in a WhatsApp export (in WhatsApp: a chat's menu → Export chat → Without media), or click **Try with sample data**.

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build, and serve it |
| `pnpm test` | Run the test suite once (`pnpm test:watch` to keep it running) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Generate route types, then `tsc` |
| `pnpm format` / `pnpm format:check` | Prettier |

CI runs lint, typecheck, format check and tests on every push, and the build on `main`.

## Project layout

```
app/                Next.js App Router: one page, rendered in the browser
components/import/  The import screen: drop zone, form, progress, dialog, summary
components/library/ The library: list, search and filters, details drawer
hooks/              useImport (the import queue), useLibrary (the rows), useExtractClient (the worker)
lib/extract/        The extraction engine: pure TypeScript
  adapters/         Source formats: whatsapp, plaintext
  url/              Find, repair, decode, validate, clean, dedupe key, domain, kind
  input.ts          Unzip, decode, normalize
  pipeline.ts       Text in, links out
lib/import/         Scan and save passes, size limits, the sample
lib/library/        Lean rows for the list, built in the worker; the drawer's details
lib/query/          Search, filters, counts, sorts and duplicates; the view as a URL
lib/preview/        Readable titles and URLs from the link alone (Tier 0)
lib/db/             IndexedDB schema (Dexie)
lib/workers/        The extraction worker and its typed client
tests/fixtures/     Anonymized test inputs and the URL edge-case table
public/             The sample chat (made up)
docs/PRD.md         Product requirements: the full spec
```

## Testing

Tests use [Vitest](https://vitest.dev), in two projects: `unit` (Node, for the engine and the database) and `dom` (jsdom, for components).

- **`tests/fixtures/urls-edge-cases.txt` is the contract for finding URLs.** One case per line, `input ⇒ expected`. Adding a case is the way to report or fix an extraction bug.
- **Fixtures come from real exports, anonymized.** Names, numbers and private links are replaced, while the format is kept byte for byte. Raw exports go in `tests/fixtures/raw/`, which is git-ignored. See [`tests/fixtures/README.md`](tests/fixtures/README.md).
- **Formats not yet confirmed by a real export** (iPhone, German) are marked as such in their fixture files.

## Tech stack

[Next.js 16](https://nextjs.org) (App Router, Turbopack, React Compiler) · React 19 · TypeScript (strict) · Tailwind CSS v4 · [Dexie](https://dexie.org) (IndexedDB) · Web Workers · [tldts](https://github.com/remusao/tldts) · [fflate](https://github.com/101arrowz/fflate) · Vitest · pnpm · Vercel

## Documentation

- [`docs/PRD.md`](docs/PRD.md): what LinkVault is and will be. It covers scope, data model, the rules for every URL edge case, decisions, milestones and risks.
- [`AGENTS.md`](AGENTS.md): notes for coding agents working in this repo (this Next.js version differs from older ones).

No license has been chosen yet.
