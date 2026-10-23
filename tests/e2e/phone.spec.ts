import { expect, test, type Page } from "@playwright/test";

// The phone layout (PRD §7, M5): nothing scrolls sideways, controls are big
// enough to tap, details take the screen, and links can be selected by touch.
// Runs in the "phone" project: a Pixel 7, with touch.

const shown = (page: Page) =>
  page.getByRole("status").filter({ hasText: /\d links?, \d/ });

async function noSidewaysScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.scrollingElement!.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

// Visible buttons, inputs and selects under 24 px either way (WCAG 2.5.8).
// The rows' title links are left out: each is stretched over its 50 px row.
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const scope = document.querySelector("dialog[open]") ?? document;
    return [...scope.querySelectorAll("button, input, select")]
      .filter((element) => {
        const target = element.closest("label") ?? element;
        const box = target.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        if (getComputedStyle(element).visibility === "hidden") return false;
        if (element.matches("input[type=file]")) return false;
        return box.width < 24 || box.height < 24;
      })
      .map((element) =>
        (
          element.getAttribute("aria-label") ??
          ((element as HTMLInputElement).labels?.[0]?.textContent ||
            element.textContent) ??
          ""
        ).trim(),
      );
  });
}

test("the first screen and the library fit, with targets big enough to tap", async ({
  page,
}) => {
  await page.goto("/");
  await noSidewaysScroll(page);
  expect(await smallTargets(page)).toEqual([]);
  await page.getByRole("button", { name: "Try with sample data" }).tap();
  await page.getByRole("button", { name: "Dismiss" }).tap();
  await expect(shown(page)).toHaveText("56 links, 51 unique");
  await noSidewaysScroll(page);
  expect(await smallTargets(page)).toEqual([]);

  // The filters open in a dialog on a phone.
  await page.getByRole("button", { name: "Filters" }).tap();
  const filters = page.getByRole("dialog", { name: "Filters" });
  await expect(filters).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  await filters.getByRole("button", { name: "Done" }).tap();

  // Details take the whole width.
  await page.getByRole("listitem").first().getByRole("link").tap();
  const drawer = page.getByRole("dialog").last();
  const box = (await drawer.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
  expect(await smallTargets(page)).toEqual([]);
});

test("Select: a tap picks a link instead of opening it; Done ends it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try with sample data" }).tap();
  await page.getByRole("button", { name: "Dismiss" }).tap();
  await page.getByRole("button", { name: "Select", exact: true }).tap();
  const bar = page.getByRole("region", { name: "Selected links" });
  await expect(bar).toContainText("Choose links to copy or export.");
  const rows = page.getByRole("listitem");
  await rows.nth(0).getByRole("link").tap();
  await rows.nth(2).getByRole("link").tap();
  await expect(bar).toContainText("2 links selected");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await bar.getByRole("button", { name: "Done" }).tap();
  await expect(bar).toBeHidden();
});
