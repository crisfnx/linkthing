import { describe, expect, test } from "vitest";
import { describeUrl } from "@/lib/extract/url/describe";
import { deriveTitle } from "./derive-title";
import { displayUrl } from "./display-url";

// As the import describes a link, so canonicalization and alias grouping
// apply: x.com is grouped as twitter.com, tracking params are gone.
const titleOf = (url: string, title?: string) =>
  deriveTitle({ ...describeUrl(url), title });

describe("the sites shared most", () => {
  test.each([
    // X / Twitter
    [
      "https://x.com/exampledev/status/1900000000000000001?s=20",
      "Post by @exampledev",
    ],
    [
      "https://twitter.com/exampledev/status/19/photo/1",
      "Photo by @exampledev",
    ],
    ["https://x.com/i/status/1637000000000000002", "Post on X"],
    ["https://x.com/exampledev", "@exampledev"],
    ["https://x.com/hashtag/nextjs", "#nextjs"],
    // YouTube
    ["https://www.youtube.com/watch?v=Ex4mpLeV1d0", "YouTube video"],
    ["https://youtu.be/Ex4mpLeV1d0?si=Zx9Yw8Vu7Ts6Rq5P", "YouTube video"],
    [
      "https://www.youtube.com/watch?v=AbCdEfGhIjK&t=95",
      "YouTube video at 1:35",
    ],
    ["https://youtu.be/AbCdEfGhIjK?t=1h2m3s", "YouTube video at 1:02:03"],
    ["https://youtube.com/shorts/AbCdEfGhIjK", "YouTube Short"],
    ["https://www.youtube.com/playlist?list=PLex4mple", "YouTube playlist"],
    ["https://www.youtube.com/@exampledev/videos", "@exampledev on YouTube"],
    [
      "https://www.youtube.com/results?search_query=fado+live",
      "Search: fado live",
    ],
    ["https://music.youtube.com/watch?v=Ex4mpLeSong1", "YouTube Music track"],
    // Instagram
    [
      "https://www.instagram.com/reel/Ex4mpLeReel01/?igsh=ZXhh",
      "Instagram reel",
    ],
    ["https://www.instagram.com/p/AbCdEfGhIjK/", "Instagram post"],
    ["https://www.instagram.com/examplebaker/", "@examplebaker on Instagram"],
    [
      "https://www.instagram.com/examplebaker/reel/AbCd/",
      "Reel by @examplebaker",
    ],
    [
      "https://www.instagram.com/stories/examplebaker/31/",
      "Story by @examplebaker",
    ],
    // Reddit
    [
      "https://www.reddit.com/r/cats/comments/1ex4mp1/this_is_my_cat_now/",
      "This is my cat now · r/cats",
    ],
    ["https://www.reddit.com/r/webdev/s/AbCdEfGh12", "Shared post in r/webdev"],
    ["https://www.reddit.com/r/webdev/comments/1abcdef/", "Post in r/webdev"],
    ["https://www.reddit.com/r/webdev/", "r/webdev"],
    ["https://www.reddit.com/user/exampledev", "u/exampledev"],
    ["https://v.redd.it/ex4mple", "Reddit video"],
    // TikTok
    [
      "https://www.tiktok.com/@exampleuser/video/7300000000000000001",
      "TikTok video by @exampleuser",
    ],
    ["https://www.tiktok.com/@exampleuser", "@exampleuser on TikTok"],
    ["https://vm.tiktok.com/ZMex4mple/", "TikTok video"],
    // GitHub
    ["https://github.com/dexie/Dexie.js", "dexie/Dexie.js"],
    [
      "https://github.com/vercel/next.js/issues/123",
      "vercel/next.js issue #123",
    ],
    [
      "https://github.com/vercel/next.js/pull/456",
      "vercel/next.js pull request #456",
    ],
    [
      "https://github.com/vercel/next.js/blob/canary/docs/README.md",
      "README.md in vercel/next.js",
    ],
    [
      "https://github.com/vercel/next.js/commit/0123456789abcdef",
      "vercel/next.js commit 0123456",
    ],
    [
      "https://github.com/vercel/next.js/releases/tag/v16.3.4",
      "vercel/next.js v16.3.4",
    ],
    ["https://github.com/vercel", "vercel on GitHub"],
    ["https://gist.github.com/exampledev/0123abcd", "Gist by exampledev"],
    // Wikipedia, mobile too, with percent-encoding decoded
    ["https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower", "Belém Tower"],
    ["https://en.m.wikipedia.org/wiki/Pastel_de_nata", "Pastel de nata"],
    // Others
    [
      "https://open.spotify.com/track/4ex4mpleTrackId0001?si=a1b2",
      "Spotify track",
    ],
    ["https://open.spotify.com/intl-de/album/4ex4mple", "Spotify album"],
    [
      "https://docs.google.com/presentation/d/abc123/edit#slide=id.p",
      "Google Slides",
    ],
    ["https://docs.google.com/spreadsheets/d/abc123/edit", "Google Sheet"],
    [
      "https://www.google.com/maps/place/Pena+Palace/@38.78,-9.39,17z",
      "Pena Palace",
    ],
    ["https://www.google.com/search?q=custard+tarts", "Search: custard tarts"],
    ["https://maps.app.goo.gl/Ex4mpleNata01", "Google Maps link"],
    ["https://photos.app.goo.gl/Ex4mpleAlbum2026", "Google Photos album"],
    ["https://www.facebook.com/share/r/1AbCdEfGhI/", "Facebook reel"],
    ["https://news.ycombinator.com/item?id=40000001", "Hacker News discussion"],
    [
      "https://www.linkedin.com/in/example-person/",
      "example-person on LinkedIn",
    ],
    [
      "https://www.amazon.co.uk/Rain-Jacket-Packable/dp/B0EX4MPLE1/",
      "Rain Jacket Packable",
    ],
    [
      "https://www.amazon.co.uk/dp/B0EX4MPLE1/ref=cm_sw_r_wa_api",
      "Amazon product",
    ],
  ])("%s → %s", (url, expected) => {
    expect(titleOf(url)).toBe(expected);
  });
});

describe("any other site: the URL's most readable segment", () => {
  test.each([
    ["https://example.com/blog/how-to-ship-fast", "How to ship fast"],
    [
      "https://www.theguardian.com/travel/2026/mar/10/lisbon-beyond-the-trams",
      "Lisbon beyond the trams",
    ],
    [
      "https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB",
      "Using IndexedDB",
    ],
    ["https://store.steampowered.com/app/123456/Example_Game/", "Example Game"],
    // ids are dropped, wherever they are in the slug
    [
      "https://www.goodreads.com/book/show/000001-example-novel",
      "Example novel",
    ],
    [
      "https://www.notion.so/example/Lisbon-packing-list-3f2a1b",
      "Lisbon packing list",
    ],
    ["https://dev.to/exampledev/caching-in-nextjs-2abc", "Caching in nextjs"],
    [
      "https://podcasts.apple.com/gb/podcast/example-travel-show/id1000000001",
      "Example travel show",
    ],
    // extensions and locale suffixes
    [
      "https://www.booking.com/hotel/pt/example-alfama-terrace.en-gb.html?aid=3",
      "Example alfama terrace",
    ],
    [
      "https://www.ipma.pt/en/otempo/prev.localidade.hora/",
      "Prev localidade hora",
    ],
    // past an id and a stray segment to the words
    [
      "https://www.decathlon.co.uk/p/example-rain-jacket/_/R-p-300001",
      "Example rain jacket",
    ],
    // a page about its query
    [
      "https://www.google.com/travel/flights?q=flights%20to%20lisbon",
      "Flights to lisbon",
    ],
    ["https://shop.example.com/search?q=oak+shelf", "Search: oak shelf"],
    // a single word is fine as the page itself
    ["https://example.com/recipes/shakshuka", "Shakshuka"],
  ])("%s → %s", (url, expected) => {
    expect(titleOf(url)).toBe(expected);
  });

  test.each([
    ["the site itself", "https://vitest.dev/"],
    ["only structure", "https://www.museudoazulejo.gov.pt/en-GB/default.aspx"],
    ["a section above an id", "https://www.airbnb.co.uk/rooms/000000001"],
    ["a code, not words", "https://example.com/AbCdEfGhIjKlMn"],
    ["a shortener", "https://bit.ly/ex4mpleCP"],
    [
      "a shortener with letters only",
      "https://share.google/AbCdEfGhIjKlMnOpQr",
    ],
  ])("nothing readable (%s): no title, so the URL shows", (_, url) => {
    expect(titleOf(url)).toBeUndefined();
  });
});

describe("the source's own link text", () => {
  test("wins over anything derived", () => {
    expect(titleOf("https://react.dev/learn", "  React docs ")).toBe(
      "React docs",
    );
  });

  test("is cut at 100 characters", () => {
    const title = titleOf("https://example.com/", "word ".repeat(40));
    expect(title).toHaveLength(100);
    expect(title?.endsWith("…")).toBe(true);
  });
});

test("a URL can't make its title or display read backwards", () => {
  // U+202E (right-to-left override) and U+200B (zero width space), escaped
  const url = "https://example.com/%E2%80%AEtxt.exe-%E2%80%8Breport";
  expect(titleOf(url)).toBe("Txt exe report");
  expect(displayUrl(describeUrl(url).canonicalUrl)).toBe(
    "example.com/txt.exe-report",
  );
});
