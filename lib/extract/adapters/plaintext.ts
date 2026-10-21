import type { Adapter, Message } from "@/lib/extract/types";

// The fallback (PRD §3): every non-empty line is a message, so a link's
// context is its own line. It reads anything, so it scores low and wins only
// when nothing more specific does.
export const plaintext: Adapter = {
  kind: "plaintext",
  version: 1,

  detect: () => 0.1,

  parse({ text }) {
    const messages: Message[] = [];
    text.split("\n").forEach((line, i) => {
      if (line.trim() === "") return;
      messages.push({ index: messages.length, lineStart: i + 1, text: line });
    });
    return messages;
  },
};
