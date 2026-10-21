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

const SEPARATOR = "\x1f";

// A chat message's identity across exports of the same chat (PRD §3): its
// wall-clock minute ("2023-05-25 19:48"; Android exports carry no seconds, and
// the importing device's time zone must not matter), sender, NFC-normalized
// text, and which of several identical messages in that minute it is.
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
