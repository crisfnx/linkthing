import type { Message } from "./types";
import type { FoundUrl } from "./url/extract";

// Context and nearby text (PRD §4.8).
const MAX_LENGTH = 200;
// Less other text than this, and a message is "little more than its URL(s)".
const NOTE_LENGTH = 20;
const NEARBY_WINDOW = 5 * 60_000;

// Messages that carry nothing to read: media and deletion placeholders.
const PLACEHOLDER =
  /^\u{200E}?(?:<Media omitted>|<Medien ausgeschlossen>|This message was deleted|You deleted this message|Diese Nachricht wurde gelöscht\.?|(?:image|video|audio|sticker|GIF|document|Contact card) omitted|<attached: [^>]+>)$/u;

// The message's text with its links taken out.
export function textBesideLinks(text: string, found: FoundUrl[]): string {
  let rest = text;
  for (const { index, length } of [...found].reverse()) {
    rest = rest.slice(0, index) + rest.slice(index + length);
  }
  return rest.replace(/\s+/g, " ").trim();
}

export function isLittleMoreThanLinks(rest: string, found: FoundUrl[]) {
  return found.length > 0 && rest.length < NOTE_LENGTH;
}

// Up to 200 characters around the link, cut with "…" when the message is
// longer. Undefined when the link alone fills the space.
export function contextAround(
  text: string,
  index: number,
  length: number,
): string | undefined {
  if (text.length <= MAX_LENGTH) return text;
  // The link plus a "…" on each side must fit.
  if (length > MAX_LENGTH - 2) return undefined;

  // A 200-character window centred on the link, pushed back inside the text.
  let start = Math.max(0, index - Math.floor((MAX_LENGTH - length) / 2));
  let end = Math.min(text.length, start + MAX_LENGTH);
  start = Math.max(0, end - MAX_LENGTH);
  // Each "…" takes the place of the character at its edge.
  if (start > 0) start++;
  if (end < text.length) end--;
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export interface MessageNote {
  rest: string; // text beside the links
  found: FoundUrl[];
}

function canBeNearby(message: Message, note: MessageNote): boolean {
  return (
    !message.isSystem &&
    note.rest !== "" &&
    !PLACEHOLDER.test(message.text.trim()) &&
    !isLittleMoreThanLinks(note.rest, note.found)
  );
}

function nearest(
  messages: Message[],
  notes: MessageNote[],
  from: number,
  step: 1 | -1,
): string | undefined {
  const origin = messages[from];
  if (origin?.timestamp === undefined || origin.sender === undefined) {
    return undefined;
  }
  for (let i = from + step; i >= 0 && i < messages.length; i += step) {
    const message = messages[i];
    const note = notes[i];
    if (message?.timestamp === undefined || note === undefined)
      return undefined;
    if (Math.abs(message.timestamp - origin.timestamp) > NEARBY_WINDOW) {
      return undefined;
    }
    if (message.sender === origin.sender && canBeNearby(message, note)) {
      return message.text;
    }
  }
  return undefined;
}

const truncate = (text: string, length: number) =>
  text.length <= length ? text : `${text.slice(0, length - 1)}…`;

// In a chat with yourself the note about a link is often a separate message
// sent just before or after it. For a message that is little more than its
// links: the nearest real message from the same sender within 5 minutes on
// each side, skipping other senders, placeholders and other bare links. Up to
// 200 characters, the two sides on separate lines.
export function nearbyText(
  messages: Message[],
  notes: MessageNote[],
  index: number,
): string | undefined {
  const sides = [
    nearest(messages, notes, index, -1),
    nearest(messages, notes, index, 1),
  ].filter((side) => side !== undefined);
  if (sides.length === 0) return undefined;

  const [first = "", second] = sides;
  if (second === undefined) return truncate(first, MAX_LENGTH);
  // Each side gets half the room (less the line break), or more when the other
  // side needs less.
  const room = MAX_LENGTH - 1;
  const firstRoom = Math.max(Math.floor(room / 2), room - second.length);
  const shortFirst = truncate(first, firstRoom);
  return `${shortFirst}\n${truncate(second, room - shortFirst.length)}`;
}
