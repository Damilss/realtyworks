import { defineConfig, devices } from "@playwright/test";

// E2E config. Since Phase 3 these specs authenticate against a real local
// Supabase stack — the `e2e` job in .github/workflows/ci.yml boots one and
// resets it to the seeded state before running. CI mode keys off process.env.CI
// below (forbidOnly, retries, reuseExistingServer), set automatically by Actions.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    // 127.0.0.1, not localhost, to match [auth] site_url in
    // supabase/config.toml. Cookies are scoped per host, so a mismatch would
    // strand any session established through an auth redirect on the other
    // hostname — a trap the moment OAuth or email confirmation lands.
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Playwright boots the app itself, so `pnpm test:e2e` is one command.
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
