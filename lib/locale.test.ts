import { expect, test } from "vitest";
import { dateOrderFor } from "./locale";

test.each([
  ["en-US", "MDY"],
  ["en-GB", "DMY"],
  ["de-DE", "DMY"],
  ["es-ES", "DMY"],
  ["pt-BR", "DMY"],
  // Year first: their exports settle the order themselves (YMD), so the
  // default hardly matters; day first is the common case.
  ["ja-JP", "DMY"],
  ["ko-KR", "DMY"],
  ["not a language", "DMY"],
])("%s → %s", (locale, order) => {
  expect(dateOrderFor(locale)).toBe(order);
});
