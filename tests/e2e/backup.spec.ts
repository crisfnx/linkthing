import { expect, test, type Page } from "@playwright/test";

// The MVP's round trip (PRD §6.5, §11): back up, delete everything, restore
// from the first screen, and the library is as it was; restoring again
// changes nothing.

const shown = (page: Page) =>
  page.getByRole("status").filter({ hasText: /\d links?, \d/ });

async function restore(page: Page, file: string) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Restore from a backup…" }).click(),
  ]);
  await chooser.setFiles(file);
}

test("backup → delete everything → restore: the same library, star and all", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try with sample data" }).click();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(shown(page)).toHaveText("56 links, 51 unique");
  const first = page.getByRole("listitem").first().getByRole("link");
  await first.focus();
  await page.keyboard.press("s");
  // The Starred filter, with its count: "★ Starred3".
  const starred = page
    .getByRole("checkbox", { name: /^Starred/ })
    .locator("..");
  await expect(starred).toBeVisible();
  const starredBefore = await starred.textContent();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    settings.getByRole("button", { name: "Download a backup" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^linkvault-backup-\d{4}-\d\d-\d\d\.jsonl\.gz$/,
  );
  const backup = (await download.path())!;
  await expect(settings).toContainText("1 source and 56 links");

  await settings.getByRole("button", { name: "Delete everything" }).click();
  await settings
    .getByRole("group", { name: "Delete everything" })
    .getByRole("button", { name: "Delete everything" })
    .click();
  await expect(
    page.getByRole("button", { name: "Try with sample data" }),
  ).toBeVisible();

  // A browser that lost its library: restore from the first screen.
  await restore(page, backup);
  await expect(shown(page)).toHaveText("56 links, 51 unique");
  await expect(starred).toHaveText(starredBefore!);

  // Again, from Settings: nothing new, nothing changed.
  await page.getByRole("button", { name: "Settings" }).click();
  await restore(page, backup);
  await expect(
    page.getByRole("dialog", { name: "Settings" }).getByRole("status"),
  ).toContainText(
    "Nothing to restore: the source in this backup is already here.",
  );
  await expect(shown(page)).toHaveText("56 links, 51 unique");
});
