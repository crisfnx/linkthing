import { expect, test } from "vitest";
import { describeUrl } from "./describe";

// PRD Appendix A, "Expected links (after canonicalization)".
test.each([
  {
    url: "https://twitter.com/JussiKemppainen/status/1661482544892882946?t=trOwVVd-Chr91pimPwrc7A&s=08",
    canonicalUrl:
      "https://twitter.com/JussiKemppainen/status/1661482544892882946",
    urlKey: "https://twitter.com/i/status/1661482544892882946",
    domain: "twitter.com",
    kind: "social",
  },
  {
    url: "https://youtube.com/shorts/XbcpYQGXu2I?feature=share",
    canonicalUrl: "https://youtube.com/shorts/XbcpYQGXu2I",
    urlKey: "https://youtube.com/watch?v=XbcpYQGXu2I",
    domain: "youtube.com",
    kind: "video",
  },
  {
    url: "https://react.gg/?twclid=2-3oef9v2rpf5gpybctnr5tbf4c&s=08",
    canonicalUrl: "https://react.gg/",
    urlKey: "https://react.gg",
    domain: "react.gg",
    kind: "other",
  },
])("Appendix A: $url", ({ url, ...expected }) => {
  expect(describeUrl(url)).toMatchObject(expected);
});

test("keeps the real host and path next to the grouped domain", () => {
  expect(describeUrl("https://m.youtube.com/watch?v=AbCdEfGhIjK&si=x")).toEqual(
    {
      canonicalUrl: "https://m.youtube.com/watch?v=AbCdEfGhIjK",
      urlKey: "https://youtube.com/watch?v=AbCdEfGhIjK",
      host: "m.youtube.com",
      domain: "youtube.com",
      path: "/watch",
      kind: "video",
      isShortened: false,
    },
  );
});

test("accepts custom tracking rules", () => {
  expect(
    describeUrl("https://example.com/a?utm_source=x&keep=1", []).canonicalUrl,
  ).toBe("https://example.com/a?utm_source=x&keep=1");
});
