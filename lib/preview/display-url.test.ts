import { describe, expect, test } from "vitest";
import { displayUrl } from "./display-url";

describe("displayUrl", () => {
  test.each([
    ["https://www.theguardian.com/travel/", "theguardian.com/travel"],
    ["https://react.gg/", "react.gg"],
    ["http://old-site.example.org/page", "old-site.example.org/page"],
    [
      "https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower",
      "en.wikipedia.org/wiki/Belém_Tower",
    ],
    // reserved characters stay encoded, so the URL still reads as one
    ["https://example.com/a%2Fb?q=x%26y", "example.com/a%2Fb?q=x%26y"],
    // a malformed escape is shown as written
    ["https://example.com/100%", "example.com/100%"],
  ])("%s → %s", (url, expected) => {
    expect(displayUrl(url)).toBe(expected);
  });
});
