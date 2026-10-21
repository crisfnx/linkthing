import { expect, test } from "vitest";
import type { Adapter } from "@/lib/extract/types";
import { detectAdapter } from "./index";
import { plaintext } from "./plaintext";

const scoring = (score: number): Adapter => ({
  kind: "whatsapp",
  version: 1,
  detect: () => score,
  parse: () => [],
});

const input = { text: "anything" };

test("only plaintext available: plaintext, no question", () => {
  expect(detectAdapter(input)).toEqual({
    kind: "plaintext",
    scores: [{ kind: "plaintext", score: 0.1 }],
    needsConfirmation: false,
  });
});

test("a specialized adapter at 0.6 or more wins outright", () => {
  const detection = detectAdapter(input, [scoring(0.9), plaintext]);
  expect(detection.kind).toBe("whatsapp");
  expect(detection.needsConfirmation).toBe(false);
});

test("between 0.2 and 0.6 it falls back to plaintext and asks", () => {
  const detection = detectAdapter(input, [scoring(0.4), plaintext]);
  expect(detection.kind).toBe("plaintext");
  expect(detection.needsConfirmation).toBe(true);
  expect(detection.scores.map((s) => s.kind)).toEqual([
    "whatsapp",
    "plaintext",
  ]);
});

test("below 0.2 it is plain text without asking", () => {
  const detection = detectAdapter(input, [scoring(0.05), plaintext]);
  expect(detection).toMatchObject({
    kind: "plaintext",
    needsConfirmation: false,
  });
});
