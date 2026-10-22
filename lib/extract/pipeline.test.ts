import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { detectAdapter } from "./adapters";
import { whatsapp } from "./adapters/whatsapp";
import { prepareFile } from "./input";
import { extractLinks, linkCounts, linkIdsFor } from "./pipeline";
import { normalizeText } from "./text";

const fixtureBytes = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url));
const fixture = (name: string) =>
  normalizeText(fixtureBytes(name).toString("utf8"));

const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s).getTime();

describe("whatsapp-android-gb.txt end to end", () => {
  const { links, stats } = extractLinks(
    fixture("whatsapp-android-gb.txt"),
    "source-1",
    "whatsapp",
  );
  const link = (url: string) => links.find((l) => l.url.includes(url));

  test("stats", () => {
    expect(stats).toEqual({
      messages: 37,
      links: 27,
      uniqueLinks: 24, // one tweet shared twice, one video three ways
      domains: 16,
      skippedNonWeb: 1, // the mailto:
      earliest: at(2022, 7, 13, 9, 15),
      latest: at(2026, 10, 21, 8, 15),
    });
  });

  test("a bare link: every stored field", () => {
    expect(link("1547000000000000001")).toEqual({
      id: expect.any(String),
      sourceId: "source-1",
      messageKey: expect.any(String),
      url: "https://twitter.com/exampledev/status/1547000000000000001?s=20&t=AbCdEfGhIjKlMnOpQrStUv",
      canonicalUrl: "https://twitter.com/exampledev/status/1547000000000000001",
      urlKey: "https://twitter.com/i/status/1547000000000000001",
      host: "twitter.com",
      domain: "twitter.com",
      path: "/exampledev/status/1547000000000000001",
      kind: "social",
      isShortened: false,
      timestamp: at(2022, 7, 13, 9, 15),
      sender: "Cris",
      position: { line: 5, column: 0, messageIndex: 4 },
    });
  });

  test("a link in a multi-line message: context, and its own line", () => {
    expect(link("maps.app.goo.gl")).toMatchObject({
      isShortened: true,
      context:
        "Example Gym Northfield\n01632 960123\nhttps://maps.app.goo.gl/AbCdEfGhIjKlMnOp7",
      position: { line: 8, column: 0, messageIndex: 5 },
    });
    expect(link("example.com/guide")?.position).toMatchObject({
      line: 26,
      column: 4,
    });
  });

  test("bare links get the note sent next to them", () => {
    expect(link("reel/ZyXwVuTsRqP")?.nearby).toBe(
      "Recipe for the weekend, double the garlic",
    );
    expect(link("example-repo")?.nearby).toBe(
      "Good write-up on caching https://dev.to/exampledev/caching-in-nextjs-2abc",
    );
    expect(link("example.dev/tools")?.nearby).toBe(
      "mail me at mailto:someone@example.com",
    );
    expect(link("1547000000000000001")?.nearby).toBeUndefined();
  });

  test("a link with its own text has context instead", () => {
    expect(link("dev.to")).toMatchObject({
      context:
        "Good write-up on caching https://dev.to/exampledev/caching-in-nextjs-2abc",
    });
    expect(link("dev.to")?.nearby).toBeUndefined();
  });

  test("ids: unique, the same on every run, different per source", () => {
    const ids = links.map((l) => l.id);
    expect(new Set(ids).size).toBe(27);
    const again = extractLinks(
      fixture("whatsapp-android-gb.txt"),
      "source-1",
      "whatsapp",
    );
    expect(again.links.map((l) => l.id)).toEqual(ids);
    const other = extractLinks(
      fixture("whatsapp-android-gb.txt"),
      "source-2",
      "whatsapp",
    );
    expect(other.links.some((l) => ids.includes(l.id))).toBe(false);
  });
});

describe("whatsapp-group-gb.txt end to end", () => {
  const text = fixture("whatsapp-group-gb.txt");

  test("links carry their sender; the bare domain is flagged", () => {
    const { links } = extractLinks(text, "group", "whatsapp");
    expect(links.map((l) => [l.domain, l.sender, l.isBare ?? false])).toEqual([
      ["youtube.com", "Alex", false],
      ["steampowered.com", "+44 7700 900123", false],
      ["example-shop.co.za", "Sam", false],
      ["liquipedia.net", "Riley", false],
      ["twitter.com", "Alex", false],
      ["codesandbox.io", "Sam", true],
    ]);
  });

  test("with bare domains off, the bare one is gone", () => {
    const { links } = extractLinks(text, "group", "whatsapp", {
      bareDomains: false,
    });
    expect(links.map((l) => l.domain)).not.toContain("codesandbox.io");
    expect(links).toHaveLength(5);
  });
});

test("plaintext.txt: positions from line numbers, ids from position", () => {
  const { links, stats } = extractLinks(
    fixture("plaintext.txt"),
    "notes",
    "plaintext",
  );
  expect(links.map((l) => l.position.line)).toEqual([2, 3, 6, 7, 8]);
  expect(links.every((l) => l.messageKey === undefined)).toBe(true);
  expect(stats.earliest).toBeUndefined();
});

test("an iPhone zip, from bytes to links", () => {
  const input = prepareFile(
    new Uint8Array(fixtureBytes("whatsapp-ios.zip")),
    "WhatsApp Chat - Weekend Crew.zip",
  );
  const { kind } = detectAdapter(input);
  expect(kind).toBe("whatsapp");
  const { links } = extractLinks(input.text, "ios", kind);
  expect(links.map((l) => [l.canonicalUrl, l.sender, l.timestamp])).toEqual([
    ["https://example.com/ios-one", "Sam", at(2023, 5, 25, 19, 48, 40)],
    ["https://example.com/ios-two", "Alex", at(2023, 5, 25, 19, 50, 12)],
    ["https://youtu.be/AbCdEfGhIjK", "Sam", at(2023, 5, 26, 8, 1)],
  ]);
});

describe("a newer export of the same chat (§6.1)", () => {
  const older = fixture("whatsapp-update-older.txt");
  const newer = fixture("whatsapp-update-newer.txt");

  test("shares message keys with the older one", () => {
    const keys = (text: string) =>
      new Set(whatsapp.parse({ text }).map((m) => m.key));
    const [a, b] = [keys(older), keys(newer)];
    const shared = [...a].filter((key) => b.has(key)).length;
    expect(shared).toBe(16);
    expect(shared / Math.min(a.size, b.size)).toBeGreaterThanOrEqual(0.5);
  });

  test("merging by id keeps old links, adds new ones, duplicates none", () => {
    const before = extractLinks(older, "chat", "whatsapp").links;
    const after = extractLinks(newer, "chat", "whatsapp").links;
    const beforeIds = new Set(before.map((l) => l.id));
    const overlap = after.filter((l) => beforeIds.has(l.id));
    expect([before.length, after.length, overlap.length]).toEqual([17, 26, 14]);

    const merged = new Map([...before, ...after].map((l) => [l.id, l]));
    expect(merged.size).toBe(29); // the original 27 and the 2 new links
    // The edited message kept its key, so its link wasn't duplicated.
    expect(
      [...merged.values()].filter((l) => l.url.includes("reel/ZyXwVuTsRqP")),
    ).toHaveLength(1);
  });
});

// The import scan relies on this to compare a file with a stored chat.
test.each([
  "whatsapp-android-gb.txt",
  "whatsapp-group-gb.txt",
  "whatsapp-update-newer.txt",
  "plaintext.txt",
])("linkCounts and linkIdsFor give the ids extractLinks gives: %s", (name) => {
  const text = fixture(name);
  const { kind } = detectAdapter({ text });
  const ids = extractLinks(text, "source-1", kind).links.map((l) => l.id);
  expect(linkIdsFor("source-1", linkCounts(text, kind))).toEqual(ids);
});

// A synthetic export shaped like a real one: mostly bare links, some notes,
// media, multi-line messages; one message a minute.
function syntheticExport(targetLength: number): string {
  const bodies = [
    "https://x.com/exampledev/status/{n}?s=20&t=AbCdEfGhIjKlMnOpQrStUv",
    "https://www.reddit.com/r/webdev/s/{n}",
    "https://youtube.com/shorts/{n}?si=AbCdEfGhIjKlMnOp",
    "https://www.instagram.com/reel/{n}/?igsh=MWxhYmNkZWZnaGlqaw==",
    "Recipe for the weekend, double the garlic",
    "<Media omitted>",
    "Good write-up on caching https://dev.to/exampledev/post-{n}",
    "Notes for later\nsecond line\nhttps://example.com/list/{n}",
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  const lines: string[] = [];
  let length = 0;
  for (let n = 0; length < targetLength; n++) {
    const d = new Date(Date.UTC(2020, 0, 1) + n * 60_000);
    const header = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} - Cris: `;
    const line =
      header + (bodies[n % bodies.length] ?? "").replace("{n}", String(n));
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}

test("a 10 MB export extracts in under 2 seconds (§8.6)", () => {
  const text = syntheticExport(10_000_000);
  const started = performance.now();
  const { stats } = extractLinks(text, "big", "whatsapp");
  const elapsed = performance.now() - started;
  console.log(
    `10 MB: ${stats.messages} messages, ${stats.links} links in ${Math.round(elapsed)} ms`,
  );
  expect(stats.links).toBeGreaterThan(90_000);
  // CI machines are slower than the M-series laptop the budget is set for.
  expect(elapsed).toBeLessThan(process.env.CI ? 6000 : 2000);
}, 30_000);
