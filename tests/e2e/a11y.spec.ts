import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Accessibility (PRD §7, §11): axe on every screen and dialog, light and
// dark, against WCAG 2.2 A and AA. Every screen is scanned before the test
// fails, so one run lists everything to fix.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Found = {
  screen: string;
  rule: string;
  impact: string;
  targets: string[];
};

async function scan(page: Page, screen: string, found: Found[]) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(TAGS)
    .analyze();
  for (const v of violations) {
    found.push({
      screen,
      rule: `${v.id}: ${v.help}`,
      impact: v.impact ?? "",
      targets: v.nodes.slice(0, 4).map((node) => node.target.join(" ")),
    });
  }
}

const shown = (page: Page) =>
  page.getByRole("status").filter({ hasText: /\d links?, \d/ });

for (const colorScheme of ["light", "dark"] as const) {
  test(`every screen and dialog, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const found: Found[] = [];

    await page.goto("/");
    await scan(page, "first screen", found);

    // An import that asks: dates that read either way.
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Choose files" }).click(),
    ]);
    await chooser.setFiles(
      resolve("tests/fixtures/whatsapp-ambiguous-dates.txt"),
    );
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, "import dialog", found);
    await page.keyboard.press("Enter");
    await expect(page.getByText(/^\d+ links? found$/)).toBeVisible();
    await scan(page, "library with the import summary", found);
    await page.getByRole("button", { name: "Dismiss" }).click();

    await page
      .getByRole("banner")
      .getByRole("button", { name: "Import" })
      .click();
    await scan(page, "import panel", found);
    await page.keyboard.press("Escape");

    await expect(shown(page)).toBeVisible();
    await scan(page, "library", found);

    await page.getByRole("listitem").first().getByRole("link").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, "details drawer", found);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Sources" }).click();
    await scan(page, "sources", found);
    await page.getByRole("button", { name: "Re-extract" }).first().click();
    await scan(page, "re-extract form", found);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Settings" }).click();
    await scan(page, "settings", found);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Export", exact: true }).click();
    await scan(page, "export", found);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("listitem").first().getByRole("link").click();
    await scan(page, "selecting", found);
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByRole("searchbox", { name: "Search links" }).fill("zzzzzz");
    await expect(page.getByText("No links match.")).toBeVisible();
    await scan(page, "no matches", found);
    await page.getByRole("searchbox", { name: "Search links" }).fill("");

    // Narrow: the filters in a dialog.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: /^Filters/ }).click();
    await scan(page, "filters dialog (phone)", found);

    expect(found, JSON.stringify(found, null, 2)).toEqual([]);
  });
}
