import { describe, expect, test } from "vitest";
import { contextAround, nearbyText, textBesideLinks } from "./context";
import type { Message } from "./types";
import { extractUrls } from "./url/extract";

describe("contextAround", () => {
  const url = "https://example.com/a";

  test("a short message is its own context", () => {
    const text = `Read this later ${url}`;
    expect(contextAround(text, 16, url.length)).toBe(text);
  });

  test("a long message is cut to 200 characters around the link", () => {
    const text = `${"a".repeat(150)} ${url} ${"b".repeat(150)}`;
    const context = contextAround(text, 151, url.length);
    expect(context).toHaveLength(200);
    expect(context).toContain(url);
    expect(context?.startsWith("…")).toBe(true);
    expect(context?.endsWith("…")).toBe(true);
  });

  test("a link near the start isn't preceded by …", () => {
    const text = `${url} ${"b".repeat(300)}`;
    const context = contextAround(text, 0, url.length);
    expect(context?.startsWith(url)).toBe(true);
    expect(context).toHaveLength(200);
  });

  test("a link that fills the space on its own gets none", () => {
    const long = `https://example.com/${"x".repeat(200)}`;
    expect(contextAround(`${long} and more`, 0, long.length)).toBeUndefined();
  });
});

test("textBesideLinks takes the links out", () => {
  const text = "See https://example.com/guide. Then www.example.com/api";
  expect(textBesideLinks(text, extractUrls(text))).toBe("See . Then");
});

describe("nearbyText", () => {
  const minute = 60_000;
  const message = (
    index: number,
    text: string,
    minutes: number,
    sender = "Cris",
  ): Message => ({
    index,
    lineStart: index + 1,
    text,
    sender,
    timestamp: minutes * minute,
  });
  const notesOf = (messages: Message[]) =>
    messages.map((m) => {
      const found = extractUrls(m.text);
      return { found, rest: textBesideLinks(m.text, found) };
    });

  test("both sides, each cut so the whole fits in 200 characters", () => {
    const messages = [
      message(0, `before ${"x".repeat(300)}`, 0),
      message(1, "https://example.com/a", 1),
      message(2, `after ${"y".repeat(300)}`, 2),
    ];
    const nearby = nearbyText(messages, notesOf(messages), 1);
    expect(nearby).toHaveLength(200);
    expect(nearby?.split("\n")).toHaveLength(2);
    expect(nearby?.startsWith("before")).toBe(true);
  });

  test("skips other senders, placeholders and bare links; stops after 5 minutes", () => {
    const messages = [
      message(0, "too early", 0),
      message(1, "the note", 4),
      message(2, "<Media omitted>", 5),
      message(3, "someone else", 6, "Sam"),
      message(4, "https://example.com/other", 7),
      message(5, "https://example.com/a", 8),
      message(6, "way later", 20),
    ];
    expect(nearbyText(messages, notesOf(messages), 5)).toBe("the note");
  });
});
