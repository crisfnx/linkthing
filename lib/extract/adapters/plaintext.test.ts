import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { normalizeText } from "@/lib/extract/text";
import { extractUrls } from "@/lib/extract/url/extract";
import { plaintext } from "./plaintext";

const text = normalizeText(
  readFileSync(
    new URL("../../../tests/fixtures/plaintext.txt", import.meta.url),
    "utf8",
  ),
);

test("every non-empty line is a message, numbered from 1", () => {
  expect(plaintext.parse({ text })).toEqual([
    { index: 0, lineStart: 1, text: "Meeting notes 2024-01-10" },
    {
      index: 1,
      lineStart: 2,
      text: "Deck: https://docs.google.com/presentation/d/abc123/edit#slide=id.p (needs access)",
    },
    { index: 2, lineStart: 3, text: "Repo (https://github.com/org/repo)." },
    { index: 3, lineStart: 5, text: "Reading list:" },
    {
      index: 4,
      lineStart: 6,
      text: "- [React docs](https://react.dev/learn) — start here",
    },
    { index: 5, lineStart: 7, text: "- <https://vitest.dev>" },
    { index: 6, lineStart: 8, text: "- See also www.example.com/guide." },
  ]);
});

test("Markdown read as plain text still gives clean links (Appendix A)", () => {
  const links = plaintext
    .parse({ text })
    .flatMap((message) =>
      extractUrls(message.text).map(({ url }) => [message.lineStart, url]),
    );
  expect(links).toEqual([
    [2, "https://docs.google.com/presentation/d/abc123/edit#slide=id.p"],
    [3, "https://github.com/org/repo"],
    [6, "https://react.dev/learn"],
    [7, "https://vitest.dev"],
    [8, "https://www.example.com/guide"],
  ]);
});

test("scores low, so any specific adapter wins", () => {
  expect(plaintext.detect({ text })).toBeLessThan(0.2);
});
