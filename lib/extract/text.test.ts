import { describe, expect, test } from "vitest";
import { decodeText, normalizeText } from "./text";

describe("decodeText", () => {
  test("reads UTF-8 and drops its BOM", () => {
    const bytes = new TextEncoder().encode("\uFEFFcafé 😂");
    expect(decodeText(bytes)).toEqual({ text: "café 😂", encoding: "utf-8" });
  });

  test("falls back to windows-1252 when the bytes aren't UTF-8", () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80]);
    expect(decodeText(bytes)).toEqual({
      text: "café €",
      encoding: "windows-1252",
    });
  });

  test("keeps UTF-8 when only a stray byte is broken", () => {
    const good = new TextEncoder().encode("a".repeat(500));
    const bytes = new Uint8Array([...good, 0xff]);
    expect(decodeText(bytes).encoding).toBe("utf-8");
  });
});

describe("normalizeText", () => {
  test("drops a BOM and turns CRLF and CR into LF", () => {
    expect(normalizeText("\uFEFFone\r\ntwo\rthree\n")).toBe(
      "one\ntwo\nthree\n",
    );
  });

  test("leaves a BOM that isn't at the start alone", () => {
    expect(normalizeText("a\n\uFEFFb")).toBe("a\n\uFEFFb");
  });
});
