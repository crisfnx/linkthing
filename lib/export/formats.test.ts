import { describe, expect, test } from "vitest";
import type { Link } from "@/lib/extract/types";
import { describeUrl } from "@/lib/extract/url/describe";
import {
  csvCell,
  markdownText,
  markdownUrl,
  toCsv,
  toMarkdown,
  toText,
} from "./formats";
import { localDateTime, type ExportRow } from "./rows";

const at = new Date(2026, 2, 14, 21, 3).getTime();

function row(
  url: string,
  fields: Partial<ExportRow> = {},
  link: Partial<Link> = {},
): ExportRow {
  return {
    link: {
      id: "l1",
      sourceId: "chat",
      url,
      ...describeUrl(url),
      position: { line: 1, column: 0, messageIndex: 0 },
      ...link,
    },
    title: "",
    site: "example.com",
    source: "Chat with Me",
    starred: false,
    ...fields,
  };
}

describe("CSV", () => {
  test.each([
    [
      '=HYPERLINK("https://evil.example")',
      '"\'=HYPERLINK(""https://evil.example"")"',
    ],
    ["+1 555", '"\'+1 555"'],
    ["-Ana", '"\'-Ana"'],
    ["@everyone", '"\'@everyone"'],
    ["\tTabbed", '"\'\tTabbed"'],
    ["\rReturn", '"\'\rReturn"'],
    ["plain, with a comma", '"plain, with a comma"'],
    ['a "quote"', '"a ""quote"""'],
  ])("a cell %j is written %s", (value, written) => {
    expect(csvCell(value)).toBe(written);
  });

  test("a header, then a link per record, CRLF, readable as UTF-8 by Excel", () => {
    const csv = toCsv([
      row(
        "https://x.com/exampledev/status/1?s=20",
        { title: "Post by @exampledev", site: "x.com", starred: true },
        { timestamp: at, sender: "Ana", context: "=1+1 look https://x.com/…" },
      ),
      row("https://example.com/page"),
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      '"url","title","site","kind","date","sender","source","starred","message","url_as_found"',
    );
    expect(lines[1]).toBe(
      '"https://x.com/exampledev/status/1","Post by @exampledev","x.com","social","2026-03-14 21:03","Ana","Chat with Me","yes","\'=1+1 look https://x.com/…","https://x.com/exampledev/status/1?s=20"',
    );
    expect(lines[2]).toBe(
      '"https://example.com/page","","example.com","other","","","Chat with Me","","","https://example.com/page"',
    );
    expect(lines[3]).toBe("");
  });

  test("each link once adds how many times it was shared", () => {
    const csv = toCsv([row("https://example.com/a", { shared: 3 })]);
    const [header, first] = csv.slice(1).split("\r\n");
    expect(header?.endsWith(',"times_shared"')).toBe(true);
    expect(first?.endsWith(',"3"')).toBe(true);
  });
});

describe("Markdown", () => {
  test("a list of links with their dates", () => {
    expect(
      toMarkdown([
        row(
          "https://www.theguardian.com/travel/2026/mar/10/lisbon-beyond-the-trams",
          { title: "Lisbon beyond the trams" },
          { timestamp: at },
        ),
        row("https://bit.ly/ex4mpleCP"), // no title, no date
      ]),
    ).toBe(
      "- [Lisbon beyond the trams](https://www.theguardian.com/travel/2026/mar/10/lisbon-beyond-the-trams) — 2026-03-14\n" +
        "- [bit.ly/ex4mpleCP](https://bit.ly/ex4mpleCP)\n",
    );
  });

  test("brackets in titles and parentheses in URLs can't break the link", () => {
    expect(markdownText("[draft] notes \\ ideas\nline two")).toBe(
      "\\[draft\\] notes \\\\ ideas line two",
    );
    expect(markdownUrl("https://en.wikipedia.org/wiki/Mercury_(planet)")).toBe(
      "https://en.wikipedia.org/wiki/Mercury_%28planet%29",
    );
    expect(
      toMarkdown([
        row("https://en.wikipedia.org/wiki/Mercury_(planet)", {
          title: "Mercury [planet]",
        }),
      ]),
    ).toBe(
      "- [Mercury \\[planet\\]](https://en.wikipedia.org/wiki/Mercury_%28planet%29)\n",
    );
  });
});

test("plain text: one URL per line", () => {
  expect(toText(["https://a.example/", "https://b.example/"])).toBe(
    "https://a.example/\nhttps://b.example/\n",
  );
  expect(toText([])).toBe("");
});

test("dates in the browser's time zone; none for undated links", () => {
  expect(localDateTime(new Date(2026, 0, 5, 7, 9).getTime())).toBe(
    "2026-01-05 07:09",
  );
  expect(localDateTime(undefined)).toBe("");
});
