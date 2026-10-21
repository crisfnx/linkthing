import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { normalizeText } from "@/lib/extract/text";
import type { Message } from "@/lib/extract/types";
import { extractUrls } from "@/lib/extract/url/extract";
import { detectAdapter } from "./index";
import { scanWhatsApp, whatsapp } from "./whatsapp";

const fixture = (name: string) =>
  normalizeText(
    readFileSync(
      new URL(`../../../tests/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  );

// Local time, as the adapter computes it: exports carry no zone.
const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s).getTime();

const LRM = String.fromCharCode(0x200e);
const urlsIn = (messages: Message[]) =>
  messages.flatMap((m) => extractUrls(m.text).map((found) => found.url));
const byLine = (messages: Message[], line: number) =>
  messages.find((m) => m.lineStart === line);

describe("detection", () => {
  test.each(["whatsapp-android-gb.txt", "whatsapp-group-gb.txt"])(
    "%s is WhatsApp",
    (name) => {
      expect(whatsapp.detect({ text: fixture(name) })).toBeGreaterThan(0.8);
      expect(detectAdapter({ text: fixture(name) })).toMatchObject({
        kind: "whatsapp",
        needsConfirmation: false,
      });
    },
  );

  test("plain notes are not", () => {
    expect(whatsapp.detect({ text: fixture("plaintext.txt") })).toBe(0);
    expect(detectAdapter({ text: fixture("plaintext.txt") }).kind).toBe(
      "plaintext",
    );
  });
});

describe("whatsapp-android-gb.txt (chat with yourself)", () => {
  const text = fixture("whatsapp-android-gb.txt");
  const messages = whatsapp.parse({ text });

  test("scan: day first, one sender", () => {
    expect(scanWhatsApp(text)).toEqual({
      dateOrder: "DMY",
      senders: new Set(["Cris"]),
    });
  });

  test("37 messages from 44 lines; every key unique", () => {
    expect(messages).toHaveLength(37);
    expect(new Set(messages.map((m) => m.key)).size).toBe(37);
  });

  test("the encryption notice is a system message", () => {
    expect(messages[0]).toMatchObject({
      index: 0,
      lineStart: 1,
      isSystem: true,
      timestamp: at(2022, 7, 5, 0, 57),
      text: "Messages to yourself are end-to-end encrypted. No one else, not even WhatsApp, can read, listen to, or share them. *Learn more*",
    });
    expect(messages[0]?.sender).toBeUndefined();
  });

  test("continuation lines, blank ones included, join the message", () => {
    expect(byLine(messages, 6)).toMatchObject({
      sender: "Cris",
      timestamp: at(2022, 8, 25, 17, 34),
      text: "Example Gym Northfield\n01632 960123\nhttps://maps.app.goo.gl/AbCdEfGhIjKlMnOp7",
    });
    expect(byLine(messages, 9)?.text).toBe(
      "https://www.instagram.com/reel/AbCdEfGhIjK/?igshid=MDJmNzVkMjY=\n\n😂😂😂",
    );
    const bom = String.fromCharCode(0xfeff);
    const nbsp = String.fromCharCode(0xa0);
    expect(byLine(messages, 40)?.text).toBe(
      `Notes for later\n${bom}Example list${nbsp}item one\nhttps://example.com/list`,
    );
  });

  test("two identical messages in one minute get different keys", () => {
    const [first, second] = [byLine(messages, 12), byLine(messages, 13)];
    expect(first?.text).toBe("You deleted this message");
    expect(second?.text).toBe(first?.text);
    expect(second?.key).not.toBe(first?.key);
  });

  test("every link in the fixture", () => {
    expect(urlsIn(messages)).toEqual([
      "https://twitter.com/exampledev/status/1547000000000000001?s=20&t=AbCdEfGhIjKlMnOpQrStUv",
      "https://maps.app.goo.gl/AbCdEfGhIjKlMnOp7",
      "https://www.instagram.com/reel/AbCdEfGhIjK/?igshid=MDJmNzVkMjY=",
      "https://x.com/exampledev/status/1637000000000000002?s=46&t=ZyXwVuTsRqPoNmLkJiHgFe",
      "https://x.com/i/status/1637000000000000002",
      "https://www.instagram.com/reel/ZyXwVuTsRqP/?igsh=MWxhYmNkZWZnaGlqaw==",
      "https://youtube.com/shorts/AbCdEfGhIjK?feature=share",
      "https://youtu.be/ZyXwVuTsRqP?si=Ab12_cd34efgh5_",
      "https://dev.to/exampledev/caching-in-nextjs-2abc",
      "https://github.com/example-org/example-repo?s=09",
      "https://www.reddit.com/r/webdev/s/AbCdEfGh12",
      "https://www.reddit.com/r/webdev/comments/1abcdef/how_do_you_cache_api_calls/",
      "https://example.com/guide/getting-started",
      "https://example.com/is-it",
      "https://share.google/AbCdEfGhIjKlMnOpQr",
      "https://search.app/AbCdEfGhIjKlMn",
      "https://amzn.eu/d/AbCdEfG",
      "https://www.etsy.com/uk/listing/1234567890/handmade-oak-shelf?ref=share_v2_lx",
      "https://www.facebook.com/share/r/1AbCdEfGhI/",
      "https://open.spotify.com/track/4AbCdEfGhIjKlMnOpQrStU?si=abcdef1234567890&context=spotify%3Aalbum%3A1AbCdEfGhIjKlMnOpQrStU",
      "https://www.youtube.com/watch?v=AbCdEfGhIjK&si=ZyXwVuTsRqPoNmLk",
      "https://youtube.com/shorts/AbCdEfGhIjK?si=AbCdEfGhIjKlMnOp",
      "https://example.dev/tools",
      "http://old-site.example.org/page",
      "https://shop.example.com/search?q=oak,shelf&colour=light%20brown&utm_source=newsletter&utm_medium=email",
      "https://example.com/list",
      "https://x.com/exampledev/status/1980000000000000003",
    ]);
  });
});

describe("whatsapp-group-gb.txt", () => {
  const text = fixture("whatsapp-group-gb.txt");
  const messages = whatsapp.parse({ text });

  test("scan: senders include phone numbers and a one-time sender, not the subject change", () => {
    expect(scanWhatsApp(text)).toEqual({
      dateOrder: "DMY",
      senders: new Set(["Sam", "Alex", "+44 7700 900123", "Riley"]),
    });
  });

  test("19 messages; system messages have no sender", () => {
    expect(messages).toHaveLength(19);
    expect(messages.filter((m) => m.isSystem).map((m) => m.lineStart)).toEqual([
      1, 2, 3, 8, 15, 17, 18,
    ]);
    expect(messages.filter((m) => m.isSystem && m.sender)).toEqual([]);
    expect(byLine(messages, 18)?.text).toBe(
      'Sam changed the subject to "Weekend Crew: Season 2"',
    );
  });

  test("phone-number senders and one-time senders keep their name", () => {
    expect(byLine(messages, 6)?.sender).toBe("+44 7700 900123");
    expect(byLine(messages, 16)).toMatchObject({
      sender: "Riley",
      text: "only here once https://liquipedia.net/example/Main_Page",
    });
  });

  test("the edit marker is stripped", () => {
    expect(byLine(messages, 11)?.text).toBe(
      "Specs for the new build\nCPU: something fast\nhttps://www.example-shop.co.za/cpu/12345",
    );
    expect(byLine(messages, 14)?.text).toBe("lol");
  });

  test("every link, the bare domain included", () => {
    expect(urlsIn(messages)).toEqual([
      "https://www.youtube.com/watch?v=AbCdEfGhIjK&t=42s",
      "https://store.steampowered.com/app/123456/Example_Game/",
      "https://www.example-shop.co.za/cpu/12345",
      "https://liquipedia.net/example/Main_Page",
      "https://twitter.com/exampledev/status/1362000000000000001?s=20",
      "https://codesandbox.io",
    ]);
  });
});

describe("whatsapp-android-us.txt", () => {
  const text = fixture("whatsapp-android-us.txt");
  const messages = whatsapp.parse({ text });

  test("month first, 12-hour clock, either space before AM/PM", () => {
    expect(scanWhatsApp(text).dateOrder).toBe("MDY");
    expect(messages.map((m) => [m.lineStart, m.timestamp])).toEqual([
      [1, at(2023, 5, 25, 19, 48)],
      [2, at(2023, 5, 25, 19, 48)],
      [3, at(2023, 5, 25, 23, 54)],
      [5, at(2023, 5, 26, 0, 5)],
      [6, at(2023, 5, 26, 12, 30)],
      [7, at(2023, 12, 31, 23, 59)],
    ]);
    expect(messages[0]?.isSystem).toBe(true);
    expect(byLine(messages, 3)?.text).toBe(
      "Note for later\nhttps://example.org/two-lines",
    );
  });
});

describe("whatsapp-ios.txt (unconfirmed format)", () => {
  const text = fixture("whatsapp-ios.txt");
  const messages = whatsapp.parse({ text });

  test("brackets, seconds and U+200E line starts", () => {
    expect(messages).toHaveLength(7);
    expect(byLine(messages, 3)).toMatchObject({
      sender: "Sam",
      timestamp: at(2023, 5, 25, 19, 48, 40),
      text: "https://example.com/ios-one",
    });
    expect(byLine(messages, 4)).toMatchObject({
      sender: "Alex",
      text: `${LRM}image omitted`,
    });
    expect(byLine(messages, 4)?.isSystem).toBeUndefined();
  });

  test("system messages filed under the chat's name lose that sender", () => {
    for (const line of [1, 2]) {
      expect(byLine(messages, line)?.isSystem).toBe(true);
      expect(byLine(messages, line)?.sender).toBeUndefined();
    }
  });

  test("the U+200E after a link isn't part of it", () => {
    expect(urlsIn(messages)).toEqual([
      "https://example.com/ios-one",
      "https://example.com/ios-two",
      "https://youtu.be/AbCdEfGhIjK",
    ]);
  });
});

describe("whatsapp-de.txt (unconfirmed format)", () => {
  const messages = whatsapp.parse({ text: fixture("whatsapp-de.txt") });

  test("dots, two-digit years, German system text", () => {
    expect(messages).toHaveLength(5);
    expect(messages[0]?.isSystem).toBe(true);
    expect(messages[1]).toMatchObject({
      sender: "Cris",
      timestamp: at(2023, 5, 25, 19, 48),
      text: "https://example.de/artikel",
    });
    expect(messages.at(-1)?.timestamp).toBe(at(2023, 12, 31, 23, 59));
    expect(urlsIn(messages)).toEqual([
      "https://example.de/artikel",
      "https://example.de/rezept",
    ]);
  });
});

describe("other date and time formats", () => {
  const first = (text: string) => whatsapp.parse({ text })[0];

  test.each([
    ["ISO dates", "2023-05-25, 19:48 - Cris: hi", at(2023, 5, 25, 19, 48)],
    ["Korean", "2023. 5. 25. 오후 7:48 - Cris: hi", at(2023, 5, 25, 19, 48)],
    [
      "Korean morning",
      "2023. 5. 25. 오전 9:05 - Cris: hi",
      at(2023, 5, 25, 9, 5),
    ],
    ["Chinese", "2023/5/25 下午7:48 - Cris: hi", at(2023, 5, 25, 19, 48)],
    ["Spanish", "25/5/23, 7:48 p. m. - Cris: hola", at(2023, 5, 25, 19, 48)],
    [
      "iOS en-US",
      "[5/25/23, 7:48:32 PM] Cris: hi",
      at(2023, 5, 25, 19, 48, 32),
    ],
  ])("%s", (_, line, timestamp) => {
    expect(first(line)).toMatchObject({ sender: "Cris", timestamp });
  });

  test("ambiguous dates: the scan says so, and the option decides", () => {
    const text = "05/07/2022, 00:57 - Cris: a\n06/08/2022, 10:00 - Cris: b";
    expect(scanWhatsApp(text).dateOrder).toBeUndefined();
    expect(first(text)?.timestamp).toBe(at(2022, 7, 5, 0, 57));
    expect(whatsapp.parse({ text }, { dateOrder: "MDY" })[0]?.timestamp).toBe(
      at(2022, 5, 7, 0, 57),
    );
  });

  test("text before the first header is kept, without a date", () => {
    const messages = whatsapp.parse({
      text: "cut-off https://example.com/start\n25/05/2023, 19:48 - Cris: hi",
    });
    expect(messages[0]).toMatchObject({
      lineStart: 1,
      text: "cut-off https://example.com/start",
    });
    expect(messages[0]?.timestamp).toBeUndefined();
  });
});

describe("message keys", () => {
  const key = (text: string) => whatsapp.parse({ text })[0]?.key;

  test("match across Android and iPhone exports of the same message", () => {
    expect(key("25/05/2023, 19:50 - Alex: Good one")).toBe(
      key("[25/05/2023, 19:50:12] Alex: Good one"),
    );
  });

  test("ignore an edit marker and Unicode normalization", () => {
    const composed = "café";
    const decomposed = `cafe${String.fromCharCode(0x301)}`;
    expect(key(`25/05/2023, 19:50 - Alex: ${composed}`)).toBe(
      key(`25/05/2023, 19:50 - Alex: ${decomposed} <This message was edited>`),
    );
  });

  test("differ by minute, sender and text", () => {
    const base = key("25/05/2023, 19:50 - Alex: hi");
    expect(key("25/05/2023, 19:51 - Alex: hi")).not.toBe(base);
    expect(
      key("25/05/2023, 19:50 - Sam: hi\n25/05/2023, 19:50 - Sam: x"),
    ).not.toBe(base);
    expect(key("25/05/2023, 19:50 - Alex: hello")).not.toBe(base);
  });

  test("are the same every time a file is parsed", () => {
    const text = fixture("whatsapp-group-gb.txt");
    const once = whatsapp.parse({ text }).map((m) => m.key);
    expect(whatsapp.parse({ text }).map((m) => m.key)).toEqual(once);
  });
});
