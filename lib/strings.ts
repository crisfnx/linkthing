// Every string the UI shows (PRD §10): English only in the MVP, kept in one
// place so translating later is a mechanical change. Numbers and dates use
// the browser's locale.
import type { Source } from "@/lib/db/types";
import type { ImportPhase } from "@/lib/import/options";
import type { WorkerErrorCode } from "@/lib/workers/protocol";

const number = new Intl.NumberFormat();
const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const longDay = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });

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

  phases: PHASES,
  importing: (label: string, remaining: number) =>
    remaining === 0
      ? `Importing ${label}`
      : `Importing ${label} (${count(remaining, "more file")} after this)`,
  progressLabel: "Import progress",
  phaseStatus: (phase: ImportPhase) => `${PHASES[phase]}…`,
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
    "quota-exceeded": () =>
      "Your browser's storage for this site is full, so nothing was saved. Free up space and try again.",
    cancelled: () => CANCELLED,
    unexpected: (label: string) =>
      `Something went wrong importing ${label}, and nothing was saved.`,
  } satisfies Record<WorkerErrorCode, (label: string) => string>,
  tryAgain: "Try again",

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

  sourcesHeading: "Your sources",
  sourceKind: (kind: Source["kind"]) => KINDS[kind],
  sourceLinks: (links: number) => count(links, "link"),
  sourceImported: (at: number) => `imported ${day.format(at)}`,

  upgradeNeeded:
    "LinkVault was updated in another tab. Reload this page to keep going.",
  reload: "Reload",
};
