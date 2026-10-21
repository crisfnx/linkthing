export interface DecodedText {
  text: string;
  encoding: "utf-8" | "windows-1252"; // windows-1252 means the import warns
}

// More replacement characters than this means the file wasn't UTF-8 (§9).
const MAX_REPLACEMENT_SHARE = 0.01;

// Bytes from a dropped or picked file. TextDecoder drops a UTF-8 BOM itself.
export function decodeText(bytes: Uint8Array): DecodedText {
  const text = new TextDecoder("utf-8").decode(bytes);
  const replacements = text.split("\uFFFD").length - 1;
  if (replacements > text.length * MAX_REPLACEMENT_SHARE) {
    return {
      text: new TextDecoder("windows-1252").decode(bytes),
      encoding: "windows-1252",
    };
  }
  return { text, encoding: "utf-8" };
}

// Every input, decoded or pasted, goes through this before an adapter sees it:
// no BOM, and `\n` line endings only.
export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}
