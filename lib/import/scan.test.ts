import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Dexie from "dexie";
import { zipSync } from "fflate";
import { afterEach, describe, expect, test } from "vitest";
import { createDb, type LinkVaultDb } from "@/lib/db/schema";
import { InputError } from "@/lib/extract/input";
import { sha256 } from "@/lib/extract/keys";
import { extractLinks, linkCounts, linkIdsFor } from "@/lib/extract/pipeline";
import { normalizeText } from "@/lib/extract/text";
import type { DateOrder } from "@/lib/extract/types";
import { scanInput } from "./scan";

const fixtureBytes = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url));
const fixture = (name: string) =>
  normalizeText(fixtureBytes(name).toString("utf8"));
const dropped = (name: string, as = name) => ({
  file: new File([fixtureBytes(name)], as),
});

const opened: Dexie[] = [];

function freshDb(): LinkVaultDb {
  const db = createDb(`test-${crypto.randomUUID()}`);
  opened.push(db);
  return db;
}

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

const importedAt = Date.UTC(2026, 7, 12); // "You imported this file on 12 Aug"

// Stores a chat as the save pass will, so the scan has something to find.
async function storeChat(
  db: LinkVaultDb,
  text: string,
  name: string,
  dateOrder: DateOrder,
  at = importedAt,
): Promise<string> {
  const sourceId = crypto.randomUUID();
  const { links, stats } = extractLinks(text, sourceId, "whatsapp", {
    dateOrder,
  });
  const bytes = new TextEncoder().encode(text);
  await db.sources.add({
    id: sourceId,
    name,
    kind: "whatsapp",
    adapterVersion: 1,
    importedAt: at,
    updatedAt: at,
    stats,
    options: { dateOrder },
  });
  await db.sourceParts.add({
    // Ids sort by date, so finding the latest import can't pass by luck.
    id: `part-${at}-${sourceId}`,
    sourceId,
    importedAt: at,
    byteSize: bytes.byteLength,
    contentHash: await sha256(bytes),
    raw: new Blob([text]),
  });
  await db.links.bulkAdd(links);
  return sourceId;
}

describe("into an empty library, each fixture", () => {
  test.each([
    ["whatsapp-android-gb.txt", "whatsapp", "DMY", []],
    ["whatsapp-android-us.txt", "whatsapp", "MDY", []],
    ["whatsapp-group-gb.txt", "whatsapp", "DMY", []],
    ["whatsapp-ios.txt", "whatsapp", "DMY", []],
    ["whatsapp-ios.zip", "whatsapp", "DMY", []],
    ["whatsapp-de.txt", "whatsapp", "DMY", []],
    ["whatsapp-update-older.txt", "whatsapp", "DMY", []],
    ["whatsapp-update-newer.txt", "whatsapp", "DMY", []],
    ["plaintext.txt", "plaintext", undefined, []],
    // Every date fits both orders, so the dialog asks.
    ["whatsapp-ambiguous-dates.txt", "whatsapp", undefined, ["date-order"]],
    // Long notes first: a quarter of the lines are headers, so the dialog
    // offers WhatsApp. The scan already knows its dates are day first.
    ["whatsapp-unsure.txt", "plaintext", "DMY", ["adapter"]],
  ])("%s: %s, %s, %j", async (name, kind, dateOrder, questions) => {
    const { result } = await scanInput(freshDb(), dropped(name));
    expect(result.detection.kind).toBe(kind);
    expect(result.dateOrder).toBe(dateOrder);
    expect(result.dateOrderAmbiguous).toBe(questions.includes("date-order"));
    expect(result.questions).toEqual(questions);
  });
});

describe("what the scan reads", () => {
  test("an iPhone zip: its chat, the chat's name, the dropped file's name", async () => {
    const { text, result } = await scanInput(
      freshDb(),
      dropped("whatsapp-ios.zip", "WhatsApp Chat - Weekend Crew.zip"),
    );
    const chat = fixture("whatsapp-ios.txt");
    expect(text).toBe(chat);
    expect(result).toMatchObject({
      fileName: "WhatsApp Chat - Weekend Crew.zip",
      chatName: "Weekend Crew",
      encoding: "utf-8",
      byteSize: Buffer.byteLength(chat),
      contentHash: createHash("sha256").update(chat).digest("hex"),
    });
  });

  test("the same chat hashes the same zipped, unzipped, with CRLF or pasted", async () => {
    const db = freshDb();
    const chat = fixture("whatsapp-ios.txt");
    const zip = zipSync({ "WhatsApp Chat with Sam.txt": Buffer.from(chat) });
    const inputs = [
      dropped("whatsapp-ios.zip"),
      dropped("whatsapp-ios.txt"),
      { file: new File([zip], "WhatsApp Chat with Sam.zip") },
      { text: chat.replaceAll("\n", "\r\n") },
    ];
    const hashes = new Set<string>();
    for (const input of inputs) {
      hashes.add((await scanInput(db, input)).result.contentHash);
    }
    expect(hashes.size).toBe(1);
  });

  test("pasted text has no file name", async () => {
    const { text, result } = await scanInput(freshDb(), {
      text: "Read later: https://example.com/a\r\n",
    });
    expect(text).toBe("Read later: https://example.com/a\n");
    expect(result.detection.kind).toBe("plaintext");
    expect(result.fileName).toBeUndefined();
    expect(result.questions).toEqual([]);
  });

  test("a zip with no chat in it is an InputError", async () => {
    const zip = zipSync({ "IMG-20230525-WA0001.jpg": new Uint8Array([0xff]) });
    const input = { file: new File([zip], "WhatsApp Chat - Me.zip") };
    await expect(scanInput(freshDb(), input)).rejects.toThrow(InputError);
  });
});

describe("a file imported before", () => {
  test("is reported with its source and date, and not offered as an update", async () => {
    const db = freshDb();
    const older = fixture("whatsapp-update-older.txt");
    const sourceId = await storeChat(db, older, "Chat with Me", "DMY");

    const { result } = await scanInput(
      db,
      dropped("whatsapp-update-older.txt"),
    );
    expect(result.duplicateOf).toEqual({
      sourceId,
      sourceName: "Chat with Me",
      importedAt,
    });
    expect(result.updateCandidate).toBeUndefined();
    expect(result.questions).toEqual(["duplicate"]);
  });

  test("imported twice already: the latest import is named", async () => {
    const db = freshDb();
    const older = fixture("whatsapp-update-older.txt");
    const reimportedAt = Date.UTC(2026, 8, 1);
    await storeChat(db, older, "Chat with Me", "DMY");
    const again = await storeChat(db, older, "Me again", "DMY", reimportedAt);

    const { result } = await scanInput(
      db,
      dropped("whatsapp-update-older.txt"),
    );
    expect(result.duplicateOf).toEqual({
      sourceId: again,
      sourceName: "Me again",
      importedAt: reimportedAt,
    });
  });

  test("other files are not duplicates", async () => {
    const db = freshDb();
    await storeChat(db, fixture("whatsapp-update-older.txt"), "Me", "DMY");
    const { result } = await scanInput(db, dropped("plaintext.txt"));
    expect(result.duplicateOf).toBeUndefined();
    expect(result.questions).toEqual([]);
  });
});

describe("a newer export of a stored chat", () => {
  test("update-newer is offered as an update of update-older", async () => {
    const db = freshDb();
    const older = fixture("whatsapp-update-older.txt");
    const sourceId = await storeChat(db, older, "Chat with Me", "DMY");
    await storeChat(db, fixture("whatsapp-group-gb.txt"), "Crew", "DMY");

    const { result } = await scanInput(
      db,
      dropped("whatsapp-update-newer.txt"),
    );
    expect(result.updateCandidate).toEqual({
      sourceId,
      sourceName: "Chat with Me",
      newLinks: 12, // 26 links, 14 of them stored already
    });
    expect(result.questions).toEqual(["update"]);
  });

  test("a different chat is not offered one", async () => {
    const db = freshDb();
    await storeChat(db, fixture("whatsapp-group-gb.txt"), "Crew", "DMY");
    const { result } = await scanInput(
      db,
      dropped("whatsapp-update-newer.txt"),
    );
    expect(result.updateCandidate).toBeUndefined();
    expect(result.questions).toEqual([]);
  });

  test("keys are compared in the stored chat's day/month order", async () => {
    // The user read this chat month first; a later export is still ambiguous.
    const db = freshDb();
    const older = fixture("whatsapp-ambiguous-dates.txt");
    const newer = `${older}12/06/2024, 08:00 - Cris: https://example.com/summer-list\n`;
    const sourceId = await storeChat(db, older, "Notes", "MDY");

    const { result } = await scanInput(db, { text: newer });
    expect(result.updateCandidate).toEqual({
      sourceId,
      sourceName: "Notes",
      newLinks: 1,
    });
    expect(result.questions).toEqual(["date-order", "update"]);

    // Read day first, none of its links would have matched.
    const stored = await db.links
      .where("sourceId")
      .equals(sourceId)
      .primaryKeys();
    const dayFirst = linkIdsFor(
      sourceId,
      linkCounts(newer, "whatsapp", { dateOrder: "DMY" }),
    );
    expect(dayFirst.filter((id) => stored.includes(id))).toEqual([]);
  });

  test("plain text is never offered an update", async () => {
    const db = freshDb();
    await storeChat(db, fixture("whatsapp-update-older.txt"), "Me", "DMY");
    const { result } = await scanInput(db, {
      text: "https://x.com/i/status/1637000000000000002",
    });
    expect(result.updateCandidate).toBeUndefined();
  });
});
