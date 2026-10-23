import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Importing real files (PRD §6.1): a chat export, a newer export of it
// merged as an update, the same file again, and an iPhone .zip, through the
// file picker as a person would.

// Playwright runs from the project root and loads specs as CommonJS, so
// fixtures are found from there rather than through import.meta.
const fixture = (name: string) => readFileSync(resolve("tests/fixtures", name));

// Chosen in the file picker under the name WhatsApp gives its exports.
async function choose(page: Page, fixtureName: string, as: string) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Choose files" }).click(),
  ]);
  await chooser.setFiles({
    name: as,
    mimeType: as.endsWith(".zip") ? "application/zip" : "text/plain",
    buffer: fixture(fixtureName),
  });
}

// In the library, the form sits behind the header's Import button.
async function openImport(page: Page) {
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Import" })
    .click();
}

test("a chat, its newer export as an update, and the same file again", async ({
  page,
}) => {
  await page.goto("/");
  await choose(page, "whatsapp-update-older.txt", "WhatsApp Chat with Me.txt");
  await expect(
    page.getByRole("heading", { name: "Me", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^\d+ links? found$/)).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();

  // A newer export of the same chat: offered as an update, preselected, so
  // Enter takes it.
  await openImport(page);
  await choose(page, "whatsapp-update-newer.txt", "WhatsApp Chat with Me.txt");
  const dialog = page.getByRole("dialog", {
    name: "Before importing WhatsApp Chat with Me.txt",
  });
  await expect(dialog).toContainText("newer export");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/new links? added to this chat/)).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();

  // The same file a second time: asked about, and not imported.
  await openImport(page);
  await choose(page, "whatsapp-update-newer.txt", "WhatsApp Chat with Me.txt");
  await expect(dialog).toContainText("You imported this file on");
  await dialog.getByRole("button", { name: "Don't import" }).click();
  // Said to screen readers too.
  await expect(
    page.getByRole("status").filter({ hasText: "Nothing was imported." }),
  ).toBeAttached();

  await page.getByRole("button", { name: "Sources" }).click();
  await expect(
    page.getByRole("dialog", { name: "Sources (1)" }).getByRole("listitem"),
  ).toHaveCount(1);
});

test("an iPhone export, dropped as the .zip it comes in", async ({ page }) => {
  await page.goto("/");
  await choose(page, "whatsapp-ios.zip", "WhatsApp Chat - Me.zip");
  await expect(page.getByText(/^\d+ links? found$/)).toBeVisible();
  await expect(page.getByRole("listitem").first()).toBeVisible();
});
