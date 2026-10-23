import { expect, test, type Locator, type Page } from "@playwright/test";

// The main flows by keyboard alone (PRD §7, §11), and what a screen reader
// hears through the live regions: import, search, the list, details, star,
// select, export and settings, with focus never left on nothing.

const announced = (page: Page, text: string) =>
  page.getByRole("status").filter({ hasText: text });

// Presses Tab (or Shift+Tab) until the target has focus; fails after `most`.
async function tabTo(page: Page, target: Locator, most: number, back = false) {
  for (let presses = 0; presses < most; presses++) {
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      return presses;
    }
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
  }
  await expect(target).toBeFocused();
  return most;
}

test("import, search, details, star, select, export and settings, keys only", async ({
  page,
}) => {
  await page.goto("/");
  const sample = page.getByRole("button", { name: "Try with sample data" });
  await tabTo(page, sample, 8);
  await page.keyboard.press("Enter");
  await expect(announced(page, "Import finished.")).toBeAttached();
  // The first screen went with the focus on it: focus lands on Import.
  const importButton = page.getByRole("banner").getByRole("button", {
    name: "Import",
  });
  await expect(importButton).toBeFocused();

  // Dismissing the summary puts focus back on Import, not nowhere.
  await tabTo(page, page.getByRole("button", { name: "Dismiss" }), 3);
  await page.keyboard.press("Enter");
  await expect(importButton).toBeFocused();

  // "/" searches; the list is a few Tabs on, before the filters.
  await page.keyboard.press("/");
  const search = page.getByRole("searchbox", { name: "Search links" });
  await expect(search).toBeFocused();
  await page.keyboard.type("lisbon trams");
  const firstRow = page.getByRole("listitem").first().getByRole("link");
  expect(await tabTo(page, firstRow, 10)).toBeLessThanOrEqual(7);

  // Enter opens the details; s stars, and it's said; Esc goes back to the row.
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Lisbon beyond the trams" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("s");
  await expect(announced(page, "Starred.")).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(firstRow).toBeFocused();

  // x selects; the count is said; Esc lets it go.
  await page.keyboard.press("x");
  const bar = page.getByRole("region", { name: "Selected links" });
  await expect(bar).toContainText("1 link selected");
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();

  // Back to Export; Enter opens it on the chosen scope, Enter downloads.
  await tabTo(
    page,
    page.getByRole("button", { name: "Export", exact: true }),
    4,
    true,
  );
  await page.keyboard.press("Enter");
  const exporting = page.getByRole("dialog", { name: "Export links" });
  await expect(
    exporting.getByRole("radio", { name: /^This view/ }),
  ).toBeFocused();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  await expect(exporting).toBeHidden();

  // Settings: arrows choose the theme; Esc closes and focus goes back.
  const settingsButton = page.getByRole("button", { name: "Settings" });
  await tabTo(page, settingsButton, 12, true);
  await page.keyboard.press("Enter");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(
    settings.getByRole("heading", { name: "Settings" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    settings.getByRole("radio", { name: "Match the system" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(settingsButton).toBeFocused();
});
