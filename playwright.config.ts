import { defineConfig, devices } from "@playwright/test";

// E2E config. Phase 1: install + one smoke test only. Real specs and a CI job
// come in Phase 3/4 once the vertical slice exists to drive (see CLAUDE.md §4).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Playwright boots the app itself, so `pnpm test:e2e` is one command.
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
