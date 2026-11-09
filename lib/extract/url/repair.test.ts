import { describe, expect, test } from "vitest";
import { repairCandidate } from "./repair";

const url = "https://example.com/a";

describe("repairCandidate", () => {
  test("keeps a bracket the URL opened and an entity's ;", () => {
    expect(repairCandidate(`${url}_(b))`, "")).toBe(`${url}_(b)`);
    expect(repairCandidate(`${url}?x=1&amp;`, "")).toBe(`${url}?x=1&amp;`);
    expect(repairCandidate(`${url}?x=1&#x2F;;`, "")).toBe(`${url}?x=1&#x2F;`);
    expect(repairCandidate(`${url};;`, "")).toBe(url);
  });

  // A pasted blob can end a URL in a long run of either. Each is a single
  // synchronous step the worker can't cancel, so it must stay linear.
  test.each([")", ";"])(
    "trims 80,000 trailing %s quickly",
    (char) => {
      const started = performance.now();
      const repaired = repairCandidate(url + char.repeat(80_000), "");
      const elapsed = performance.now() - started;
      expect(repaired).toBe(url);
      expect(elapsed).toBeLessThan(process.env.CI ? 600 : 200);
    },
    60_000,
  );
});
