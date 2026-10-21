import { describe, expect, test } from "vitest";
import { classify } from "./classify";
import { domainOf } from "./domain";
import { isShortened } from "./shorteners";

const parts = (url: string) => {
  const { hostname, pathname } = new URL(url);
  return [hostname, pathname] as const;
};

describe("domainOf", () => {
  test.each([
    ["m.youtube.com", "youtube.com"],
    ["www.bbc.co.uk", "bbc.co.uk"],
    ["foo.github.io", "foo.github.io"],
    ["open.spotify.com", "spotify.com"],
    ["x.com", "twitter.com"],
    ["youtu.be", "youtube.com"],
    ["v.redd.it", "reddit.com"],
    ["localhost", "localhost"],
    ["192.168.1.10", "192.168.1.10"],
  ])("%s → %s", (hostname, domain) => {
    expect(domainOf(hostname)).toBe(domain);
  });
});

describe("classify", () => {
  test.each([
    ["https://youtube.com/shorts/AbCdEfGhIjK", "video"],
    ["https://v.redd.it/abc123", "video"],
    ["https://cdn.example.com/clip.MP4", "video"],
    ["https://x.com/i/status/1", "social"],
    ["https://www.reddit.com/r/webdev/s/AbCdEfGh12", "social"],
    ["https://mastodon.social/@someone/112233445566", "social"],
    ["https://medium.com/@someone/a-post-about-css-1a2b3c", "other"],
    ["https://github.com/example-org/example-repo", "code"],
    ["https://github.com/org/repo/blob/main/logo.png", "code"],
    ["https://i.imgur.com/abc.jpg", "image"],
    ["https://example.com/photo.webp", "image"],
    ["https://docs.google.com/presentation/d/abc123/edit", "document"],
    ["https://team.notion.site/Roadmap-123", "document"],
    ["https://example.com/report.pdf", "document"],
    ["https://open.spotify.com/track/4Ab", "audio"],
    ["https://music.youtube.com/watch?v=AbC", "audio"],
    ["https://react.gg/", "other"],
  ])("%s → %s", (url, kind) => {
    expect(classify(...parts(url))).toBe(kind);
  });
});

describe("isShortened", () => {
  test.each([
    ["https://t.co/AbCdEf", true],
    ["https://share.google/AbCdEfGhIjKlMnOpQr", true],
    ["https://search.app/AbCdEfGhIjKlMn", true],
    ["https://amzn.eu/d/AbCdEfG", true],
    ["https://maps.app.goo.gl/AbCdEfGhIjKlMnOp7", true],
    ["https://www.reddit.com/r/webdev/s/AbCdEfGh12", true],
    ["https://www.reddit.com/u/someone/s/AbCdEfGh12", true],
    ["https://www.facebook.com/share/r/1AbCdEfGhI/", true],
    ["https://youtu.be/AbCdEfGhIjK", false],
    ["https://www.reddit.com/r/webdev/comments/1abcdef/title/", false],
    ["https://www.facebook.com/groups/123/", false],
  ])("%s → %s", (url, shortened) => {
    expect(isShortened(...parts(url))).toBe(shortened);
  });
});
