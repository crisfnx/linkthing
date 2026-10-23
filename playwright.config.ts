import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (PRD §8.5): the production build in a real browser,
// desktop and phone. Locally they use the installed Google Chrome, so nothing
// is downloaded; CI installs Playwright's Chromium.
const PORT = 3200; // not 3000/3001, where a dev server may be running
const chrome = process.env.CI ? {} : { channel: "chrome" as const };

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], ...chrome },
      testIgnore: /phone\.spec\.ts/,
    },
    {
      name: "phone",
      use: { ...devices["Pixel 7"], ...chrome },
      testMatch: /phone\.spec\.ts/,
    },
  ],
  // CI builds in a step of its own; locally the tests build first.
  webServer: {
    command: process.env.CI
      ? `pnpm start -p ${PORT}`
      : `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
