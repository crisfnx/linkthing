import { describe, expect, test } from "vitest";
import { toUrlKey } from "./key";

// Each group lists canonical URLs that must share one urlKey.
describe.each([
  {
    name: "one tweet, every way it gets shared",
    key: "https://twitter.com/i/status/1637000000000000002",
    urls: [
      "https://twitter.com/exampledev/status/1637000000000000002",
      "https://x.com/i/status/1637000000000000002",
      "https://mobile.twitter.com/exampledev/status/1637000000000000002",
      "https://fxtwitter.com/i/web/status/1637000000000000002",
      "https://x.com/exampledev/status/1637000000000000002/photo/1",
    ],
  },
  {
    name: "one YouTube video",
    key: "https://youtube.com/watch?v=AbCdEfGhIjK",
    urls: [
      "https://www.youtube.com/watch?v=AbCdEfGhIjK",
      "https://m.youtube.com/watch?v=AbCdEfGhIjK",
      "https://youtu.be/AbCdEfGhIjK",
      "https://youtube.com/shorts/AbCdEfGhIjK",
    ],
  },
  {
    name: "one Reddit post",
    key: "https://reddit.com/r/webdev/comments/1abcdef/title",
    urls: [
      "https://www.reddit.com/r/webdev/comments/1abcdef/title/",
      "https://old.reddit.com/r/webdev/comments/1abcdef/title/",
      "https://np.reddit.com/r/webdev/comments/1abcdef/title",
    ],
  },
  {
    name: "www, http and trailing slashes",
    key: "https://example.com/a",
    urls: [
      "https://example.com/a",
      "https://example.com/a/",
      "https://www.example.com/a",
      "http://example.com/a",
      "https://example.com/a#section",
    ],
  },
  {
    name: "parameter order and space encoding",
    key: "https://example.com/search?a=1&q=a+b",
    urls: [
      "https://example.com/search?q=a+b&a=1",
      "https://example.com/search?a=1&q=a%20b",
    ],
  },
])("$name", ({ key, urls }) => {
  test.each(urls)("%s", (url) => {
    expect(toUrlKey(url)).toBe(key);
  });
});

test.each([
  [
    "https://youtu.be/AbCdEfGhIjK?t=42",
    "https://youtube.com/watch?t=42&v=AbCdEfGhIjK",
  ],
  ["https://m.facebook.com/groups/123/", "https://facebook.com/groups/123"],
  [
    "https://en.m.wikipedia.org/wiki/Foo_(bar)",
    "https://en.wikipedia.org/wiki/Foo_(bar)",
  ],
  ["https://twitter.com/exampledev", "https://twitter.com/exampledev"],
  ["https://example.com:8080/x", "https://example.com:8080/x"],
  // Hash routes address different pages of a single-page app, so they stay.
  ["https://app.example/#/inbox", "https://app.example#/inbox"],
  ["https://app.example/#!/settings", "https://app.example#!/settings"],
])("%s", (url, expected) => {
  expect(toUrlKey(url)).toBe(expected);
});
