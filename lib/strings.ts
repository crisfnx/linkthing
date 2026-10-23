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
const sizeIn = (unit: string, digits: number) =>
  new Intl.NumberFormat(undefined, {
    style: "unit",
    unit,
    maximumFractionDigits: digits,
  });
const SIZES = [
  { below: 1e6, per: 1e3, format: sizeIn("kilobyte", 0) },
  { below: 1e9, per: 1e6, format: sizeIn("megabyte", 0) },
  { below: 1e10, per: 1e9, format: sizeIn("gigabyte", 1) },
  { below: 1e12, per: 1e9, format: sizeIn("gigabyte", 0) },
  { below: Infinity, per: 1e12, format: sizeIn("terabyte", 1) },
];
// Storage as people read it: 840 kB, 41 MB, 1.2 GB, 300 GB, 1.2 TB.
function size(bytes: number): string {
  const { per, format } = SIZES.find(({ below }) => bytes < below)!;
  return format.format(bytes / per);
}

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
  reextracting: (name: string, remaining = 0) =>
    remaining === 0
      ? `Re-extracting “${name}”`
      : `Re-extracting “${name}” (${count(remaining, "more source")} after this)`,
  reextractFailed: (name: string) =>
    `Something went wrong re-extracting “${name}”, and it was left as it was.`,
  progressLabel: "Import progress",
  phaseStatus: (phase: ImportPhase) => `${PHASES[phase]}…`,
  largeInput: (bytes: number) =>
    `That's ${mb(bytes)}, so importing it may take a few minutes.`,
  cancel: "Cancel",

  summaryHeading: "Imported",
  linksFound: (n: number) => count(n, "link") + " found",
  newLinksAdded: (n: number) => `${count(n, "new link")} added to this chat`,
  replacedLinks: (n: number) =>
    `Replaced with the new file: ${count(n, "link")} found`,
  reextractedLinks: (n: number) => `Read again: ${count(n, "link")} found`,
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
    "is-backup": (label: string) =>
      `${label} is a LinkVault backup, so it wasn't imported. To bring back what it holds, use Restore from a backup, in Settings or on the first screen.`,
    "invalid-backup": () => "That backup couldn't be restored.",
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
    replace: (sourceName: string) =>
      `You already have a source called “${sourceName}”.`,
    replaceIt: "Replace it with this file (stars stay)",
    replaceSource: (sourceName: string) => `Replace “${sourceName}”`,
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
  starredOnly: "Starred",
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
    reextract: "Re-extract",
    readAs: "Read it as",
    datesAre: "Dates are written",
    order: (order: "DMY" | "MDY" | "YMD") =>
      ({
        DMY: "Day first (31/12/2026)",
        MDY: "Month first (12/31/2026)",
        YMD: "Year first (2026-12-31)",
      })[order],
    onlyAsChat:
      "Updated from several exports, so it can only be read as a chat.",
    newerReader: "read by an older version: re-extract to use the current one",
    reextractNote:
      "Its links are read again from the text it keeps. Stars stay.",
    deleting: (name: string) => `Deleting “${name}”…`,
    deleted: (name: string, links: number) =>
      `Deleted “${name}” and ${count(links, "link")}.`,
    deleteFailed: (name: string) =>
      `Couldn't delete “${name}”, so nothing was removed. Try again.`,
  },

  // Selecting links in the list (§6.5): x, or a row's checkbox.
  selection: {
    select: (title: string) => `Select ${title}`,
    start: "Select",
    prompt: "Choose links to copy or export.",
    selected: (n: number) => `${count(n, "link")} selected`,
    copy: "Copy URLs",
    export: "Export",
    clear: "Clear",
    done: "Done",
    label: "Selected links",
  },

  // Exports (§6.5).
  exports: {
    button: "Export",
    title: "Export links",
    which: "Which links",
    scopes: {
      view: (n: number) => `This view (${count(n, "link")})`,
      selection: (n: number) => `Selected (${count(n, "link")})`,
      library: (n: number) => `Whole library (${count(n, "link")})`,
    },
    duplicates: "Links shared more than once",
    once: "Once each",
    everyTime: "Every time they were shared",
    format: "Format",
    formats: {
      csv: "CSV, for spreadsheets, with the message and sender",
      markdown: "Markdown, a list of links for notes",
      text: "Plain text, one URL per line",
      json: "JSON, for other apps and scripts",
    } satisfies Record<"csv" | "markdown" | "text" | "json", string>,
    download: "Download",
    copy: "Copy URLs",
    cancel: "Cancel",
    preparing: "Preparing the file…",
    exported: (n: number) => `Exported ${count(n, "link")}.`,
    copied: (n: number) => `Copied ${count(n, "URL")}.`,
    nothing: "No links to export.",
    copyFailed: "Couldn't copy: the browser didn't allow it.",
    failed: "Couldn't export the links. Try again.",
  },

  // Backups (§6.5).
  backup: {
    heading: "Backups",
    note: "A backup is one file with your sources, their original text, links and stars. Restoring one adds what's missing and never deletes anything.",
    download: "Download a backup",
    preparing: "Preparing the backup…",
    saved: (name: string, sources: number, links: number) =>
      `Saved ${name}: ${count(sources, "source")} and ${count(links, "link")}.`,
    failed: "Couldn't make the backup. Try again.",
    restore: "Restore from a backup…",
    checking: "Checking the backup…",
    restoring: (done: number, total: number) =>
      `Restoring ${number.format(done)} of ${count(total, "link")}…`,
    restored: (sources: number, links: number, stars: number) =>
      `Restored ${count(sources, "source")} and ${count(links, "link")}${
        stars > 0 ? `, with ${count(stars, "star")}` : ""
      }.`,
    alreadyHere: (n: number) =>
      n === 1
        ? "1 source in the backup was already here."
        : `${number.format(n)} sources in the backup were already here.`,
    nothingNew: (n: number) =>
      n === 0
        ? "Nothing to restore: the backup is empty."
        : n === 1
          ? "Nothing to restore: the source in this backup is already here."
          : `Nothing to restore: all ${count(n, "source")} in this backup are already here.`,
    restoreFailed:
      "Couldn't restore the backup, so nothing was changed. Try again.",
    cancelled: "Restore cancelled. Nothing from it was saved.",
    cancel: "Cancel",
    nudge:
      "Your library lives only in this browser. A backup keeps it safe if the browser ever clears it.",
  },

  // Settings (§6.7).
  settings: {
    button: "Settings",
    title: "Settings",
    appearance: "Appearance",
    theme: "Theme",
    themes: {
      system: "Match the system",
      light: "Light",
      dark: "Dark",
    } satisfies Record<"system" | "light" | "dark", string>,
    importing: "Importing",
    dateOrder: "When a chat's dates could be read either way, suggest",
    order: (order: "DMY" | "MDY") =>
      ({
        DMY: "Day first (31/12/2026)",
        MDY: "Month first (12/31/2026)",
      })[order],
    bareDomains: "Find bare domains",
    bareNote: (links: number) =>
      `Links written without https:// or www., like example.com/page. ${
        links === 1
          ? "1 link in your library was"
          : `${count(links, "link")} in your library were`
      } found this way.`,
    bareOff: (links: number, sources: number) =>
      `Turn it off? This removes the ${count(links, "link")} found without https:// and reads ${count(sources, "source")} again. Stars stay.`,
    bareOn: (sources: number) =>
      `Turn it on? This reads ${
        sources === 1 ? "your source" : `all ${count(sources, "source")}`
      } again to find them.`,
    turnOff: "Turn off",
    turnOn: "Turn on",
    cancel: "Cancel",
    waitForImport: "Wait for the import to finish first.",
    list: "List",
    dedupe: "Collapse duplicates when the library opens",
    storage: "Storage",
    // True while nothing is sent anywhere (§2). Previews (M7) and AI tagging
    // (M8) send data once turned on: this has to say so then.
    local:
      "Your library stays on this device: it's kept in this browser and never uploaded anywhere.",
    // Usage is what the library takes now; quota is the browser's ceiling
    // for this site, a share of the disk that differs by browser.
    using: (usage: number, quota: number) =>
      `LinkVault is using ${size(usage)} so far. That grows with each import, and this browser lets it use up to about ${size(quota)}.`,
    usageUnknown: "This browser doesn't say how much storage LinkVault uses.",
    kept: "Your browser has agreed to keep your library until you delete it.",
    notKept:
      "Your browser may clear your library when space runs low, and Safari after 7 days without a visit.",
    askToKeep: "Ask the browser to keep it",
    refused:
      "The browser said no. Chrome decides from how much the site is used, so it may agree later.",
    deleteEverything: "Delete everything",
    deleteNote:
      "Removes every source, link and star from this browser. Settings stay.",
    confirmDelete: (sources: number, links: number, stars: number) =>
      `Delete ${count(sources, "source")}, ${count(links, "link")} and ${count(stars, "star")}? This can't be undone.`,
    deleting: "Deleting everything…",
    deleteFailed:
      "Couldn't delete everything, so nothing was removed. Try again.",
    keep: "Keep it",
    close: "Close",
  },

  upgradeNeeded:
    "LinkVault was updated in another tab. Reload this page to keep going.",
  reload: "Reload",
};
