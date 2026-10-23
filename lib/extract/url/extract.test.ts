import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { extractUrls } from "./extract";
import { countNonWebLinks } from "./find";

// tests/fixtures/urls-edge-cases.txt: `<input> ⇒ <expected URLs | ∅>`, with
// \u{XXXX} standing for invisible characters.
const unescape = (text: string) =>
  text.replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, hex: string) =>
    String.fromCodePoint(Number.parseInt(hex, 16)),
  );

const table = readFileSync(
  new URL("../../../tests/fixtures/urls-edge-cases.txt", import.meta.url),
  "utf8",
);

const cases = table
  .split("\n")
  .filter((line) => line.trim() !== "" && !line.startsWith("#"))
  .map((line) => {
    const [input, expected, extra] = line.split(" ⇒ ");
    if (input === undefined || expected === undefined || extra !== undefined) {
      throw new Error(`Malformed edge case: ${line}`);
    }
    const urls = expected.trim() === "∅" ? [] : expected.trim().split(" ");
    return { input: unescape(input), urls };
  });

describe("urls-edge-cases.txt", () => {
  test.each(cases)("$input", ({ input, urls }) => {
    expect(extractUrls(input).map((found) => found.url)).toEqual(urls);
  });
});

describe("extractUrls positions", () => {
  test("point at the repaired match in the text", () => {
    const text = "See https://example.com/a. Also www.example.com/b)";
    const spans = extractUrls(text).map(({ index, length }) =>
      text.slice(index, index + length),
    );
    expect(spans).toEqual(["https://example.com/a", "www.example.com/b"]);
  });

  test("cover the escaped text, so highlighting matches what's on screen", () => {
    const slash = String.fromCharCode(92) + "/";
    const escaped = `https:${slash}${slash}example.com${slash}a`;
    const text = `{"url": "${escaped}"}`;
    const [found] = extractUrls(text);
    expect(found?.url).toBe("https://example.com/a");
    expect(
      text.slice(found?.index, (found?.index ?? 0) + (found?.length ?? 0)),
    ).toBe(escaped);
  });
});

describe("bare domains", () => {
  test("are flagged; links with a scheme or www. are not", () => {
    const found = extractUrls(
      "try codesandbox.io, www.example.com and https://x.com/a",
    );
    expect(found.map(({ url, bare }) => [url, bare])).toEqual([
      ["https://codesandbox.io", true],
      ["https://www.example.com", false],
      ["https://x.com/a", false],
    ]);
  });

  test("can be turned off", () => {
    const text = "try codesandbox.io or github.com/org/repo";
    expect(extractUrls(text, { bareDomains: false })).toEqual([]);
  });
  // Settings → "Find bare domains" off (§4.1, §11): across the whole table,
  // exactly the bare ones go, and every other URL is still found.
  test.each(cases)(
    "off, the table's bare ones go and only they: $input",
    ({ input }) => {
      const on = extractUrls(input);
      const off = extractUrls(input, { bareDomains: false });
      expect(off.map((found) => found.url)).toEqual(
        on.filter((found) => !found.bare).map((found) => found.url),
      );
      expect(off.some((found) => found.bare)).toBe(false);
    },
  );
});

describe("countNonWebLinks", () => {
  test("counts mailto, tel, whatsapp and intent links", () => {
    const text =
      "mailto:someone@example.com, tel:+441632960123, whatsapp://send?text=hi, intent://scan#Intent;end";
    expect(countNonWebLinks(text)).toBe(4);
  });

  test("ignores words that only look like a scheme", () => {
    expect(countNonWebLinks("Hotel: Ibis. Tel: 01632 960123")).toBe(0);
  });
});
