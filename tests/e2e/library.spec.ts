import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The sample, end to end (PRD §8.5): import, search with the view in the
// address, star in the drawer, the Starred filter, a CSV of the view, and
// a selection's URLs copied.

// "56 links, 51 unique": the line under the toolbar.
const shown = (page: Page) =>
  page.getByRole("status").filter({ hasText: /\d links?, \d/ });

async function sample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try with sample data" }).click();
  await expect(page.getByText("56 links found")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(shown(page)).toHaveText("56 links, 51 unique");
}

test("search, star, the Starred filter, and a CSV of the view", async ({
  page,
}) => {
  await sample(page);
  const search = page.getByRole("searchbox", { name: "Search links" });
  const rows = page.getByRole("listitem");

  // Search narrows the list; the address keeps the view through a reload.
  await search.fill("lisbon trams");
  await expect(shown(page)).toContainText("of 56 links");
  await expect(page).toHaveURL(/\?q=lisbon\+trams/);
  await page.reload();
  await expect(search).toHaveValue("lisbon trams");
  await expect(rows.first()).toContainText("Lisbon beyond the trams");

  // Star it in the drawer: every copy of it is starred.
  await rows.first().getByRole("link").click();
  const drawer = page.getByRole("dialog", { name: "Lisbon beyond the trams" });
  await drawer.getByRole("button", { name: "Star" }).click();
  await expect(drawer.getByRole("button", { name: "Starred" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await drawer.getByRole("button", { name: "Close" }).click();
  await search.fill("");

  const starred = page.getByRole("checkbox", { name: /^Starred/ });
  await starred.check();
  await expect(page).toHaveURL(/starred=1/);
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (const row of await rows.all())
    await expect(row).toContainText("Starred");

  // A CSV of the view: a header, then the starred links.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export links" });
  await expect(dialog.getByRole("radio", { name: /^This view/ })).toBeChecked();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^linkvault-view-\d{4}-\d\d-\d\d\.csv$/,
  );
  const csv = readFileSync((await download.path())!, "utf8");
  const lines = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split("\r\n");
  expect(lines[0]).toBe(
    '"url","title","site","kind","date","sender","source","starred","message","url_as_found"',
  );
  expect(lines).toHaveLength(count + 1);
  expect(lines.slice(1).every((line) => line.includes('"yes"'))).toBe(true);
  await expect(page.getByText(`Exported ${count} link`)).toBeVisible();
});

test("x selects a link, and Copy URLs copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await sample(page);
  const first = page.getByRole("listitem").first().getByRole("link");
  await first.focus();
  await page.keyboard.press("x");
  const bar = page.getByRole("region", { name: "Selected links" });
  await expect(bar).toContainText("1 link selected");
  await bar.getByRole("button", { name: "Copy URLs" }).click();
  await expect(page.getByText("Copied 1 URL.")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(await first.getAttribute("href"));
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
});
