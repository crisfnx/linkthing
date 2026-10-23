import { expect, test, type Page } from "@playwright/test";

// Settings that reach beyond the dialog (PRD §6.7): the theme before the
// first paint, duplicates collapsed by default, and Find bare domains read
// through the import flow.

const shown = (page: Page) =>
  page.getByRole("status").filter({ hasText: /\d links?, \d/ });

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  return page.getByRole("dialog", { name: "Settings" });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try with sample data" }).click();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(shown(page)).toHaveText("56 links, 51 unique");
});

test("a dark theme is there before the page draws, after a reload", async ({
  page,
}) => {
  const settings = await openSettings(page);
  await settings.getByRole("radio", { name: "Dark" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Record the attribute the moment <body> exists: set by the <head> script,
  // not by React later.
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (!document.body) return;
      (window as unknown as { themeAtBody: string | null }).themeAtBody =
        document.documentElement.getAttribute("data-theme");
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(shown(page)).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { themeAtBody: string | null }).themeAtBody,
    ),
  ).toBe("dark");
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe("rgb(10, 10, 10)");
});

test("duplicates collapsed by default: the list follows, the address stays", async ({
  page,
}) => {
  const listed = () =>
    page.getByRole("listitem").first().getAttribute("aria-setsize");
  expect(await listed()).toBe("56");
  const settings = await openSettings(page);
  await settings
    .getByRole("checkbox", {
      name: "Collapse duplicates when the library opens",
    })
    .check();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect.poll(listed).toBe("51");
  expect(new URL(page.url()).search).toBe("");
  await page.reload();
  await expect.poll(listed).toBe("51");
});

test("find bare domains off reads the source again without them, on brings them back", async ({
  page,
}) => {
  let settings = await openSettings(page);
  const bare = settings.getByRole("checkbox", { name: "Find bare domains" });
  await expect(settings).toContainText(
    "1 link in your library was found this way.",
  );
  await bare.click();
  await settings.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("Read again: 55 links found")).toBeVisible();
  await expect(shown(page)).toHaveText("55 links, 50 unique");
  await page.getByRole("button", { name: "Dismiss" }).click();

  settings = await openSettings(page);
  await settings.getByRole("checkbox", { name: "Find bare domains" }).click();
  await settings.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("Read again: 56 links found")).toBeVisible();
  await expect(shown(page)).toHaveText("56 links, 51 unique");
});
