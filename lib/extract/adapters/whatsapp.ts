import { messageKey } from "@/lib/extract/keys";
import type {
  Adapter,
  AdapterOptions,
  DateOrder,
  Message,
} from "@/lib/extract/types";

// One header line (PRD §3): an optional U+200E and "[", a date in any order
// with . / or - between the fields (Korean exports add spaces and a final
// dot), a time with an optional day period before or after it (PM, p. m.,
// 오후, 下午), then " - " (Android) or "] " (iOS) and the rest.
const PERIOD = String.raw`[\p{L}.](?:[\p{L}. ]{0,5}[\p{L}.])?`;
const HEADER = new RegExp(
  String.raw`^[\u{200E}\u{200F}]?\[?(?<date>(?<a>\d{1,4})[./-] ?(?<b>\d{1,2})[./-] ?(?<c>\d{2,4}))\.?,?\s+` +
    String.raw`(?:(?<before>${PERIOD})\s?)?(?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<second>\d{2}))?` +
    String.raw`(?:\s?(?<after>${PERIOD}))?(?:\] | - )(?<rest>.*)$`,
  "u",
);
type Header = Record<string, string | undefined>;

const PM = new Set(["pm", "오후", "下午", "午後"]);
const AM = new Set(["am", "오전", "上午", "午前"]);

// A "sender" that is really the start of a system message containing ": ",
// such as `Sam changed the subject to "Links: misc"`.
const SYSTEM_PREFIX =
  /changed the (?:subject|group name|group description)|created group|changed this group's/i;
const QUOTE = /["“”„«»]/;

// iPhone exports put system messages under the chat's name, with the text
// marked by U+200E.
const IOS_SYSTEM_TEXT =
  /^\u{200E}(?:Messages (?:and calls|to yourself) are end-to-end encrypted|You (?:were added|created group|joined|left)|Your security code|.+ (?:created group|added|removed|left|changed|joined using|pinned a message))/u;

// Appended to edited messages. Stripped so an edit doesn't change the key.
const EDITED = /\s*\u{200E}?<This message was edited>$/u;

// How sure we are: the share of the first 50 non-empty lines that are headers.
const DETECT_LINES = 50;

export interface WhatsAppScan {
  // Undefined when every date fits both DMY and MDY (or they conflict): the
  // import dialog asks, defaulting to the setting from navigator.language.
  dateOrder?: DateOrder;
  // Prefixes seen before ": " that are people, not system messages.
  senders: Set<string>;
  // When the order is ambiguous: the last date as written ("11/06/2024"), so
  // the dialog can show both readings. People know roughly when they
  // exported, so the last date is the one that settles it.
  lastDate?: { written: string; a: number; b: number; c: number };
}

// The scan pass (PRD §3, §6.1): needs every date in the file to infer the
// order, so it reads the whole text before the parse.
export function scanWhatsApp(text: string): WhatsAppScan {
  let dayFirst = false;
  let monthFirst = false;
  let yearFirst = false;
  const prefixes = new Map<string, number>();
  let last: Header | undefined;

  for (const line of text.split("\n")) {
    const header: Header | undefined = HEADER.exec(line)?.groups;
    if (!header) continue;
    last = header;
    const { a = "", b = "", rest = "" } = header;
    if (a.length === 4) yearFirst = true;
    else {
      if (Number(a) > 12) dayFirst = true;
      if (Number(b) > 12) monthFirst = true;
    }
    const colon = rest.indexOf(": ");
    if (colon > 0) {
      const prefix = rest.slice(0, colon);
      prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
    }
  }

  const dateOrder: DateOrder | undefined = yearFirst
    ? "YMD"
    : dayFirst !== monthFirst
      ? dayFirst
        ? "DMY"
        : "MDY"
      : undefined;

  // A sender appears at least twice, or once without quotes (a system message
  // with ": " in it quotes a subject or name); never as a known system prefix.
  const senders = new Set<string>();
  for (const [prefix, count] of prefixes) {
    if (SYSTEM_PREFIX.test(prefix)) continue;
    if (count >= 2 || !QUOTE.test(prefix)) senders.add(prefix);
  }

  const scan: WhatsAppScan = { dateOrder, senders };
  if (!dateOrder && last) {
    const { date = "", a, b, c } = last;
    scan.lastDate = { written: date, a: Number(a), b: Number(b), c: Number(c) };
  }
  return scan;
}

const pad = (n: number) => String(n).padStart(2, "0");

function to24Hour(hour: number, period: string | undefined): number {
  const normalized = period?.toLowerCase().replace(/[.\s]/g, "");
  if (normalized && PM.has(normalized)) return (hour % 12) + 12;
  if (normalized && AM.has(normalized)) return hour % 12;
  return hour;
}

// The wall-clock minute (for keys) and the epoch time in the browser's zone,
// since exports carry no zone (§10).
function toTime(header: Header, order: DateOrder) {
  const a = Number(header.a);
  const b = Number(header.b);
  const c = Number(header.c);
  const [day, month, rawYear] =
    order === "YMD" ? [c, b, a] : order === "MDY" ? [b, a, c] : [a, b, c];
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const hour = to24Hour(Number(header.hour), header.before ?? header.after);
  const minute = Number(header.minute);
  const second = Number(header.second ?? 0);

  const date = new Date(year, month - 1, day, hour, minute, second);
  const valid =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute;

  return {
    minuteKey: `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`,
    timestamp: valid ? date.getTime() : undefined,
  };
}

interface Draft {
  lineStart: number;
  minuteKey: string;
  timestamp?: number;
  sender?: string;
  isSystem?: boolean;
  lines: string[];
}

function startMessage(
  header: Header,
  lineStart: number,
  order: DateOrder,
  senders: Set<string>,
): Draft {
  const { minuteKey, timestamp } = toTime(header, order);
  const rest = header.rest ?? "";
  const colon = rest.indexOf(": ");
  const prefix = colon > 0 ? rest.slice(0, colon) : undefined;

  if (prefix !== undefined && senders.has(prefix)) {
    return {
      lineStart,
      minuteKey,
      timestamp,
      sender: prefix,
      lines: [rest.slice(colon + 2)],
    };
  }
  return { lineStart, minuteKey, timestamp, isSystem: true, lines: [rest] };
}

function finish(
  draft: Draft,
  index: number,
  seen: Map<string, number>,
): Message {
  const text = draft.lines.join("\n").replace(EDITED, "").trimEnd();
  const isSystem =
    draft.isSystem === true ||
    (draft.sender !== undefined && IOS_SYSTEM_TEXT.test(text));
  const sender = isSystem ? undefined : draft.sender;

  const identity = [draft.minuteKey, sender, text.normalize("NFC")].join("\n");
  const occurrence = seen.get(identity) ?? 0;
  seen.set(identity, occurrence + 1);

  const message: Message = {
    index,
    key: messageKey(draft.minuteKey, sender, text, occurrence),
    lineStart: draft.lineStart,
    text,
  };
  if (draft.timestamp !== undefined) message.timestamp = draft.timestamp;
  if (sender !== undefined) message.sender = sender;
  if (isSystem) message.isSystem = true;
  return message;
}

function firstNonEmptyLines(text: string, count: number): string[] {
  const lines: string[] = [];
  let start = 0;
  while (lines.length < count && start < text.length) {
    const end = text.indexOf("\n", start);
    const line = text.slice(start, end === -1 ? undefined : end);
    if (line.trim() !== "") lines.push(line);
    if (end === -1) break;
    start = end + 1;
  }
  return lines;
}

export const whatsapp: Adapter = {
  kind: "whatsapp",
  version: 1,

  detect({ text }) {
    const lines = firstNonEmptyLines(text, DETECT_LINES);
    if (lines.length === 0) return 0;
    return lines.filter((line) => HEADER.test(line)).length / lines.length;
  },

  // Lines that aren't headers belong to the message before them. Lines before
  // the first header (a cut-off export) become a message of their own, so no
  // link is lost.
  parse({ text }, options: AdapterOptions = {}) {
    const scan = scanWhatsApp(text);
    const order = options.dateOrder ?? scan.dateOrder ?? "DMY";
    const drafts: Draft[] = [];

    text.split("\n").forEach((line, i) => {
      const header: Header | undefined = HEADER.exec(line)?.groups;
      if (header) {
        drafts.push(startMessage(header, i + 1, order, scan.senders));
        return;
      }
      const last = drafts.at(-1);
      if (last) last.lines.push(line);
      else if (line.trim() !== "") {
        drafts.push({ lineStart: i + 1, minuteKey: "", lines: [line] });
      }
    });

    const seen = new Map<string, number>();
    return drafts.map((draft, index) => finish(draft, index, seen));
  },
};
