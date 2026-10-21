import { expect, test } from "vitest";
import { canonicalize } from "./canonicalize";

test.each([
  // The query that stays keeps its exact encoding (§4.4).
  [
    "https://shop.example.com/search?q=oak,shelf&colour=light%20brown&utm_source=newsletter&utm_medium=email",
    "https://shop.example.com/search?q=oak,shelf&colour=light%20brown",
  ],
  [
    "https://example.com/a?keep=1&fbclid=xyz&also=2#top",
    "https://example.com/a?keep=1&also=2#top",
  ],
  ["https://example.com/a?a=1&&b=2", "https://example.com/a?a=1&b=2"],

  // Scheme, host, port, userinfo, empty query.
  ["HTTPS://Example.COM:443/Path?x=1", "https://example.com/Path?x=1"],
  ["https://user:pass@example.com/secret", "https://example.com/secret"],
  ["https://example.com/page?", "https://example.com/page"],
  ["https://bücher.example/x", "https://xn--bcher-kva.example/x"],

  // Fragments are kept for display and export.
  [
    "https://docs.google.com/presentation/d/abc123/edit#slide=id.p",
    "https://docs.google.com/presentation/d/abc123/edit#slide=id.p",
  ],

  // X: `s` and `t` go, on every twitter.com / x.com host.
  [
    "https://x.com/exampledev/status/1?s=20&t=AbCdEfGhIjKlMnOpQrStUv",
    "https://x.com/exampledev/status/1",
  ],
  [
    "https://mobile.twitter.com/u/status/1?t=abc",
    "https://mobile.twitter.com/u/status/1",
  ],

  // Two-digit `s` goes everywhere; a WordPress search keeps its words.
  [
    "https://github.com/example-org/example-repo?s=09",
    "https://github.com/example-org/example-repo",
  ],
  [
    "https://blog.example.com/?s=oak+shelf",
    "https://blog.example.com/?s=oak+shelf",
  ],

  // YouTube: `si` and `feature` go, the `t` timestamp stays.
  [
    "https://www.youtube.com/watch?v=AbCdEfGhIjK&t=42s&si=ZyXwVuTsRqPoNmLk",
    "https://www.youtube.com/watch?v=AbCdEfGhIjK&t=42s",
  ],
  [
    "https://youtube.com/shorts/AbCdEfGhIjK?feature=share",
    "https://youtube.com/shorts/AbCdEfGhIjK",
  ],
  [
    "https://youtu.be/ZyXwVuTsRqP?si=Ab12_cd34efgh5_",
    "https://youtu.be/ZyXwVuTsRqP",
  ],

  // Spotify `si` goes; its `context` stays.
  [
    "https://open.spotify.com/track/4Ab?si=abcdef1234567890&context=spotify%3Aalbum%3A1Ab",
    "https://open.spotify.com/track/4Ab?context=spotify%3Aalbum%3A1Ab",
  ],

  // Instagram share ids, old and new.
  [
    "https://www.instagram.com/reel/AbCdEfGhIjK/?igsh=MWxhYmNkZWZnaGlqaw==",
    "https://www.instagram.com/reel/AbCdEfGhIjK/",
  ],
  [
    "https://www.instagram.com/reel/AbCdEfGhIjK/?utm_source=ig_web_copy_link&igshid=MDJmNzVkMjY=",
    "https://www.instagram.com/reel/AbCdEfGhIjK/",
  ],

  // `ref` is tracking, except on code hosts, where it names a branch.
  [
    "https://www.etsy.com/uk/listing/1234567890/handmade-oak-shelf?ref=share_v2_lx",
    "https://www.etsy.com/uk/listing/1234567890/handmade-oak-shelf",
  ],
  [
    "https://github.com/org/repo?ref=main",
    "https://github.com/org/repo?ref=main",
  ],

  // A value that can't be decoded is compared as written.
  [
    "https://example.com/?q=%E0%A4%A&utm_source=x",
    "https://example.com/?q=%E0%A4%A",
  ],
])("%s", (url, expected) => {
  expect(canonicalize(url)).toBe(expected);
});
