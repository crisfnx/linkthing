import { unzipSync } from "fflate";
import { decodeText, normalizeText, type DecodedText } from "./text";

// Everything before an adapter sees the text (PRD §3, §6.1, §9): unzip,
// decode, normalize, and find the chat's name in the file name.
export interface PreparedInput {
  text: string;
  encoding: DecodedText["encoding"];
  fileName?: string; // the file the text came from; inside a zip, its .txt
  chatName?: string; // "WhatsApp Chat with Me.txt", "WhatsApp Chat - Me.zip"
}

export class InputError extends Error {
  constructor(readonly code: "zip-without-chat" | "unreadable-zip") {
    super(code);
    this.name = "InputError";
  }
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
const CHAT_FILE = /^WhatsApp Chat (?:with|-) (.+)\.(?:txt|zip)$/i;

export function isZip(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

export function chatNameFrom(fileName: string | undefined): string | undefined {
  return fileName ? CHAT_FILE.exec(fileName)?.[1] : undefined;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

// A chat export's text, not a macOS resource fork (__MACOSX/._chat.txt).
function isChatText(path: string): boolean {
  return (
    !path.startsWith("__MACOSX/") &&
    !baseName(path).startsWith("._") &&
    path.toLowerCase().endsWith(".txt")
  );
}

// iPhone exports are always zipped, with the chat in _chat.txt; Android
// exports with media zip a "WhatsApp Chat with … .txt". Media isn't inflated.
function unzipChat(bytes: Uint8Array): { bytes: Uint8Array; path: string } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => isChatText(file.name) });
  } catch {
    // Damaged or cut short, often by an interrupted download.
    throw new InputError("unreadable-zip");
  }
  const paths = Object.keys(files);
  const path = paths.find((p) => baseName(p) === "_chat.txt") ?? paths[0];
  const content = path === undefined ? undefined : files[path];
  if (path === undefined || content === undefined) {
    throw new InputError("zip-without-chat");
  }
  return { bytes: content, path };
}

export function prepareFile(
  bytes: Uint8Array,
  fileName?: string,
): PreparedInput {
  let inner = { bytes, path: fileName };
  if (isZip(bytes)) inner = unzipChat(bytes);

  const { text, encoding } = decodeText(inner.bytes);
  const prepared: PreparedInput = { text: normalizeText(text), encoding };
  if (inner.path !== undefined) prepared.fileName = baseName(inner.path);
  const chatName = chatNameFrom(fileName) ?? chatNameFrom(prepared.fileName);
  if (chatName !== undefined) prepared.chatName = chatName;
  return prepared;
}

export function preparePaste(text: string): PreparedInput {
  return { text: normalizeText(text), encoding: "utf-8" };
}
