// cyrb53 by bryc (public domain): a fast 53-bit string hash. Ids only have to
// be unique within one library, so it needn't be cryptographic, and unlike
// crypto.subtle it is synchronous, which keeps the worker's parse loop simple.
export function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// A file's identity (PRD §5): the SHA-256 of its decoded text, in hex, so the
// same chat matches whether it arrives zipped or not. It runs once per file,
// so crypto.subtle being async costs nothing here.
export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

const SEPARATOR = "\x1f";

// A chat message's identity across exports of the same chat (PRD §3): its
// wall-clock minute ("2023-05-25 19:48"; Android exports carry no seconds, and
// the importing device's time zone must not matter), sender, NFC-normalized
// text, and which of several identical messages in that minute it is.
// A link's id (PRD §5): which message it is in and which link in that message.
// Chat messages are identified by their key, so a newer export of the chat
// yields the same ids and merges; other sources by their position ("#12").
export function linkId(
  sourceId: string,
  message: { key?: string; index: number },
  occurrence: number,
): string {
  const where = message.key ?? `#${message.index}`;
  return hash53([sourceId, where, occurrence].join(SEPARATOR));
}

export function messageKey(
  minute: string,
  sender: string | undefined,
  text: string,
  occurrence: number,
): string {
  return hash53(
    [minute, sender ?? "", text.normalize("NFC"), occurrence].join(SEPARATOR),
  );
}
