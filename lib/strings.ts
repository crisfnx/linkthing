// Every string the UI shows (PRD §10): English only in the MVP, kept in one
// place so translating later is a mechanical change. Numbers and dates use
// the browser's locale.
import type { Source } from "@/lib/db/types";
import type { LinkKind } from "@/lib/extract/types";
import type { Sort } from "@/lib/query/view";
import { MAX_INPUT_BYTES } from "@/lib/import/limits";
import type { ImportPhase } from "@/lib/import/options";
import type { WorkerErrorCode } from "@/lib/workers/protocol";

const number = new Intl.NumberFormat();
const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const longDay = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });
const monthOnly = new Intl.DateTimeFormat(undefined, { month: "long" });
const dayAndTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "long",
  timeStyle: "short",
});
const megabytes = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 0,
});
const mb = (bytes: number) => megabytes.format(bytes / 1_000_000);

function count(n: number, one: string, many = `${one}s`): string {
  return `${number.format(n)} ${n === 1 ? one : many}`;
}

const PHASES: Record<ImportPhase, string> = {
  reading: "Reading",
  scanning: "Scanning",
  parsing: "Parsing",
  extracting: "Extracting",
  saving: "Saving",
};

const CANCELLED = "Import cancelled. Nothing from it was saved.";

const KINDS: Record<Source["kind"], string> = {
  whatsapp: "WhatsApp chat",
  plaintext: "Text",
  markdown: "Markdown",
  netscape: "Bookmarks",
  html: "Web page",
  "telegram-json": "Telegram chat",
};

// How the dialog offers each way of reading a file whose kind is unsure.
const READ_AS: Record<Source["kind"], string> = {
  whatsapp: "As a WhatsApp chat, with dates and senders",
  plaintext: "As plain text, line by line",
  markdown: "As Markdown, with link titles",
  netscape: "As browser bookmarks, with folders",
  html: "As a web page, with link titles",
  "telegram-json": "As a Telegram chat, with dates and senders",
};

export const strings = {
  appName: "LinkVault",
  tagline: "Drop in a chat export or any text, and get every link back.",
  privacy:
    "Nothing leaves your browser: your text is read and stored on this device only.",

  dropHere: "Drop to import",
  chooseFiles: "Choose files",
  filesHint: "WhatsApp exports (.txt or .zip) and any other text file",
  pasteLabel: "Or paste text",
  importText: "Import text",
  pasteFromClipboard: "Paste from clipboard",
  clipboardFailed:
    "Couldn't read the clipboard. Paste into the box above instead.",
  pastedText: "Pasted text",
  trySample: "Try with sample data",
  sampleHint: "A made-up group chat, to see what LinkVault does first",
  sampleFailed: "Couldn't load the sample data. Reload the page and try again.",

  phases: PHASES,
  importing: (label: string, remaining: number) =>
    remaining === 0
      ? `Importing ${label}`
      : `Importing ${label} (${count(remaining, "more file")} after this)`,
  progressLabel: "Import progress",
  phaseStatus: (phase: ImportPhase) => `${PHASES[phase]}…`,
  largeInput: (bytes: number) =>
    `That's ${mb(bytes)}, so importing it may take a few minutes.`,
  cancel: "Cancel",

  summaryHeading: "Imported",
  linksFound: (n: number) => count(n, "link") + " found",
  newLinksAdded: (n: number) => `${count(n, "new link")} added to this chat`,
  noLinks: (messages: number) =>
    `No links found in ${count(messages, "message")}.`,
  links: "Links",
  uniqueLinks: "Unique links",
  sites: "Sites",
  dates: "Dates",
  skippedNonWeb: "Skipped (email, phone and app links)",
  dateRange: (from: number, to: number) => day.formatRange(from, to),
  formatNumber: (n: number) => number.format(n),
  imported: (results: number) =>
    results === 0
      ? "Nothing was imported."
      : results === 1
        ? "Import finished."
        : `${results} imports finished.`,
  cancelled: CANCELLED,

  // Errors say what happened and what to do (§7, Copy).
  errors: {
    "zip-without-chat": (label: string) =>
      `Couldn't find a chat in ${label}: there's no .txt inside. Export the chat again and drop the new file.`,
    "unreadable-zip": (label: string) =>
      `Couldn't open ${label}: the zip file is damaged or incomplete. Download or export it again, then drop the new file.`,
    "too-large": (label: string) =>
      `Couldn't import ${label}: it's over ${mb(MAX_INPUT_BYTES)}, more than LinkVault can take at once. If it's a chat exported with media, export it again without media.`,
    "quota-exceeded": () =>
      "Your browser's storage for this site is full, so nothing was saved. Free up space and try again.",
    cancelled: () => CANCELLED,
    unexpected: (label: string) =>
      `Something went wrong importing ${label}, and nothing was saved.`,
  } satisfies Record<WorkerErrorCode, (label: string) => string>,
  tryAgain: "Try again",
  importButton: "Import",
  importPanel: "Import links",
  close: "Close",
  dismiss: "Dismiss",

  // The import dialog asks only what the scan couldn't settle (§6.1).
  dialog: {
    title: (label: string) => `Before importing ${label}`,
    duplicate: (at: number, sourceName: string) =>
      `You imported this file on ${day.format(at)}, as “${sourceName}”. Import it again?`,
    update: (sourceName: string) =>
      `This looks like a newer export of “${sourceName}”.`,
    addTo: (sourceName: string, newLinks: number) =>
      `Add its new messages to “${sourceName}” (${count(newLinks, "new link")})`,
    asNewSource: "Import it as a new source",
    kind: "Parts of this look like a chat export. How should it be read?",
    readAs: (kind: Source["kind"]) => READ_AS[kind],
    dateOrder: (written: string | undefined) =>
      written
        ? `How are dates written in this chat? Its last message is dated ${written}.`
        : "How are dates written in this chat?",
    dayFirst: (at: number | undefined) =>
      at === undefined ? "Day first" : `Day first: ${longDay.format(at)}`,
    monthFirst: (at: number | undefined) =>
      at === undefined ? "Month first" : `Month first: ${longDay.format(at)}`,
    import: "Import",
    importAgain: "Import again",
    addToSource: (sourceName: string) => `Add to “${sourceName}”`,
    skip: "Don't import",
  },

  // Search, filters and sort (§6.3).
  searchLabel: "Search links",
  sortLabel: "Sort",
  sorts: {
    newest: "Newest first",
    oldest: "Oldest first",
    site: "Site, A–Z",
    frequent: "Sites with most links",
    imported: "Latest import first",
  } satisfies Record<Sort, string>,
  dedupe: "Collapse duplicates",
  filters: "Filters",
  filtersOn: (n: number) => `Filters (${number.format(n)})`,
  filterGroups: {
    sites: "Sites",
    kinds: "Kinds",
    senders: "Senders",
    sources: "Sources",
    dates: "Dates",
  },
  clear: "Clear",
  clearAll: "Clear search and filters",
  showAllSites: (n: number) => `Show all ${count(n, "site")}`,
  showFewerSites: "Show fewer",
  noSender: "No sender",
  noDate: "No date",
  month: (yyyyMm: string) => {
    const [year, month] = yyyyMm.split("-").map(Number);
    return monthOnly.format(new Date(year!, month! - 1, 1));
  },
  showMonths: (year: string) => `Months of ${year}`,
  done: "Done",
  showing: (shown: number, of: number, unique: number) =>
    shown === of
      ? `${count(of, "link")}, ${number.format(unique)} unique`
      : `${number.format(shown)} of ${count(of, "link")}, ${number.format(unique)} unique`,
  noMatches: "No links match.",
  copies: (n: number) => `×${number.format(n)}`,
  copiesLabel: (n: number, open: boolean) =>
    open
      ? `Shared ${count(n, "time")}: hide the others`
      : `Shared ${count(n, "time")}: show all`,

  // The details drawer (§6.2).
  details: {
    label: (title: string) => `Details: ${title}`,
    close: "Close",
    open: "Open link",
    copy: "Copy link",
    star: "Star",
    starred: "Starred",
    tier0: (kind: string, site: string) => `${kind} on ${site}`,
    link: "Link",
    removed: (names: string[]) => `Tracking taken out: ${names.join(", ")}`,
    asFound: "As found",
    bare: "Found without https://, which was added.",
    shortened: "A short link: it forwards to another page.",
    message: "In the message",
    nearby: "Nearby",
    sentBy: "Sent by",
    date: "Date",
    source: "Source",
    sourceLine: (name: string, line: number) =>
      `${name}, line ${number.format(line)}`,
    kind: "Kind",
    keys: "o opens, c copies, s stars, Esc closes",
  },
  copied: "Link copied.",
  copyFailed: "Couldn't copy the link: the browser didn't allow it.",
  starredNotice: "Starred.",
  unstarredNotice: "Star removed.",

  libraryLoading: "Reading your library…",
  libraryHasNoLinks: "No links yet: what you imported had none.",
  linksLabel: "Links",
  kindNames: {
    video: "Video",
    social: "Social post",
    code: "Code",
    image: "Image",
    document: "Document",
    audio: "Audio",
    other: "Web page",
  } satisfies Record<LinkKind, string>,
  linkDate: (at: number) => day.format(at),
  linkDateAndTime: (at: number) => dayAndTime.format(at),
  libraryFailed: (message: string) =>
    `Couldn't read your library (${message}). Reload the page to try again.`,

  // Managing sources (§6.4).
  sources: {
    button: "Sources",
    title: (n: number) => `Sources (${number.format(n)})`,
    kind: (kind: Source["kind"]) => KINDS[kind],
    links: (links: number) => count(links, "link"),
    imported: (at: number) => `imported ${day.format(at)}`,
    updated: (at: number) => `updated ${day.format(at)}`,
    rename: "Rename",
    renameLabel: (name: string) => `New name for “${name}”`,
    save: "Save",
    cancel: "Cancel",
    nameEmpty: "A name can't be empty.",
    nameTooLong: (max: number) =>
      `A name can be at most ${number.format(max)} characters.`,
    delete: "Delete",
    confirmDelete: (name: string, links: number) =>
      `Delete “${name}” and its ${count(links, "link")}? Stars stay, for if you import these links again.`,
    keep: "Keep it",
    deleting: (name: string) => `Deleting “${name}”…`,
    deleted: (name: string, links: number) =>
      `Deleted “${name}” and ${count(links, "link")}.`,
    deleteFailed: (name: string) =>
      `Couldn't delete “${name}”, so nothing was removed. Try again.`,
  },

  upgradeNeeded:
    "LinkVault was updated in another tab. Reload this page to keep going.",
  reload: "Reload",
};
