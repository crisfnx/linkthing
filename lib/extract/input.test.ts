import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import {
  chatNameFrom,
  InputError,
  isZip,
  prepareFile,
  preparePaste,
} from "./input";
import { normalizeText } from "./text";

const fixture = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url));

describe("prepareFile", () => {
  test("unzips an iPhone export and reads _chat.txt, skipping media and __MACOSX", () => {
    const bytes = new Uint8Array(fixture("whatsapp-ios.zip"));
    expect(isZip(bytes)).toBe(true);
    expect(prepareFile(bytes, "WhatsApp Chat - Weekend Crew.zip")).toEqual({
      text: normalizeText(fixture("whatsapp-ios.txt").toString("utf8")),
      encoding: "utf-8",
      fileName: "_chat.txt",
      chatName: "Weekend Crew",
    });
  });

  test("an Android export with media: the chat's .txt inside the zip", () => {
    const zip = zipSync({
      "WhatsApp Chat with Sam.txt": strToU8("25/05/2023, 19:48 - Sam: hi"),
      "IMG-20230525-WA0001.jpg": new Uint8Array([0xff, 0xd8]),
    });
    expect(prepareFile(zip, "WhatsApp Chat with Sam.zip")).toMatchObject({
      text: "25/05/2023, 19:48 - Sam: hi",
      fileName: "WhatsApp Chat with Sam.txt",
      chatName: "Sam",
    });
  });

  test("a plain file is decoded and normalized", () => {
    const bytes = new TextEncoder().encode("one\r\ntwo");
    expect(prepareFile(bytes, "WhatsApp Chat with Me.txt")).toEqual({
      text: "one\ntwo",
      encoding: "utf-8",
      fileName: "WhatsApp Chat with Me.txt",
      chatName: "Me",
    });
  });

  test("a zip without a chat in it is an error", () => {
    const zip = zipSync({
      "photo.jpg": new Uint8Array([1, 2, 3]),
      "__MACOSX/._chat.txt": strToU8("resource fork"),
    });
    expect(() => prepareFile(zip, "WhatsApp Chat - Me.zip")).toThrow(
      new InputError("zip-without-chat"),
    );
  });

  test("a damaged zip is an error of its own", () => {
    const zip = zipSync({
      "_chat.txt": strToU8("25/05/2023, 19:48 - Sam: hi"),
    });
    const cut = zip.slice(0, zip.length - 30); // as from an interrupted download
    expect(() => prepareFile(cut, "WhatsApp Chat - Me.zip")).toThrow(
      new InputError("unreadable-zip"),
    );
  });
});

test("preparePaste normalizes line endings", () => {
  expect(preparePaste("a\r\nb")).toEqual({ text: "a\nb", encoding: "utf-8" });
});

test.each([
  ["WhatsApp Chat with @crisfnx.txt", "@crisfnx"],
  ["WhatsApp Chat - Weekend Crew.zip", "Weekend Crew"],
  ["notes.txt", undefined],
  [undefined, undefined],
])("chatNameFrom(%s) → %s", (fileName, name) => {
  expect(chatNameFrom(fileName)).toBe(name);
});
