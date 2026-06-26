import { test, expect } from "@playwright/test";

// Smoke test: the app boots and serves a page. Intentionally minimal —
// real flows are added with the Phase 3 vertical slice.
test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.+/);
});
