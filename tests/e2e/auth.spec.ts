import { test, expect, type Page } from "@playwright/test";

import { clearMailbox, waitForConfirmationLink } from "./mailbox";

/**
 * The Phase 3 auth loop against a real Supabase stack seeded by
 * `supabase db reset`. The assertion that matters is not "a cookie was set" —
 * it is that the *same* URL renders different rows for different people,
 * because that is RLS doing its job over a real session.
 *
 * Credentials come from supabase/seed.sql.
 */

const SEED_PASSWORD = "password123";

/**
 * The seeded work orders, split by who may see them (supabase/seed.sql).
 *
 * Asserted by identity, never by row count. playwright.config.ts runs fully
 * parallel against one shared database and the work-order specs write to it, so
 * "every work order" is the seed plus whatever another spec has committed by
 * then — and a CI retry re-runs against the rows the failed attempt left behind,
 * which turns one flake into a guaranteed failure. Identity is the stronger
 * claim anyway: a count of five never said it was the right five.
 */
const STAFF_ONLY_WORK_ORDERS = [
  "Dripping kitchen faucet",
  "Repaint hallway scuffs",
];
const VENDOR_ASSIGNED_WORK_ORDERS = [
  "Water heater not heating",
  "Roof leak above back bedroom",
  "Gutter cleaning — full exterior",
];

async function signIn(page: Page, email: string, password = SEED_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Scoped to <main> deliberately. Next.js injects its own
 * `#__next-route-announcer__` with role="alert" once a client-side navigation
 * has happened, so a bare getByRole("alert") is a strict-mode violation in some
 * test orderings and not others.
 */
function formAlert(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

test("manager signs in and sees every work order", async ({ page }) => {
  await signIn(page, "manager@realtyworks.test");

  await expect(page).toHaveURL("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Work orders" }),
  ).toBeVisible();
  await expect(page.getByText("manager", { exact: true })).toBeVisible();

  // Every seeded work order, including the two nobody is assigned to — staff
  // scope is "all of them", not "the ones with my name on them".
  for (const workOrder of [
    ...STAFF_ONLY_WORK_ORDERS,
    ...VENDOR_ASSIGNED_WORK_ORDERS,
  ]) {
    await expect(page.getByText(workOrder)).toBeVisible();
  }
});

test("vendor signs in and sees only their assigned work orders", async ({
  page,
}) => {
  await signIn(page, "vendor@realtyworks.test");

  await expect(page).toHaveURL("/dashboard");

  for (const workOrder of VENDOR_ASSIGNED_WORK_ORDERS) {
    await expect(page.getByText(workOrder)).toBeVisible();
  }

  // The RLS boundary, observed through the UI: an unassigned work order is not
  // merely hidden by the view, it never reaches the client.
  for (const workOrder of STAFF_ONLY_WORK_ORDERS) {
    await expect(page.getByText(workOrder)).toHaveCount(0);
  }
});

test("a self-registration must confirm its email, and then has no access at all", async ({
  page,
}, testInfo) => {
  // Unique per worker rather than per wall-clock, so the address is stable and
  // parallel workers do not collide — and so the mailbox lookup below can
  // filter by recipient.
  //
  // This is the one spec that writes: it creates a real auth user, so it needs
  // a freshly seeded database. CI runs `supabase db reset` immediately before
  // Playwright; locally, re-run that first or this fails on the second pass
  // with "account already exists". Deliberately not randomized — a unique
  // address per run would pass every time while silently filling auth.users.
  const email = `selfreg-w${testInfo.workerIndex}@realtyworks.test`;

  // `db reset` does not empty the mail container, so a local re-run would
  // otherwise find the previous run's message and follow a spent token.
  await clearMailbox(email);

  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Self Registered");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Phone").fill("+1 (555) 123-9999");
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // The gate itself (issue #93): the account exists, but no session came with
  // it. Landing on /dashboard here would mean confirmations are off.
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/signup");

  // And it cannot be talked past by going in the front door.
  await signIn(page, email);
  await expect(page).toHaveURL("/login");
  await expect(formAlert(page)).toContainText("Confirm your email address");

  // Only the emailed link opens it. This is the half that a bogus token would
  // silently skip — see the /auth/confirm lesson in docs/backlog.md.
  await page.goto(await waitForConfirmationLink(email));
  await expect(page).toHaveURL("/dashboard");

  // The fail-safe: role defaults to vendor, nothing is linked, so RLS returns
  // nothing and the page says so instead of rendering an empty table.
  await expect(
    page.getByRole("heading", { name: /isn't linked yet/i }),
  ).toBeVisible();
  for (const workOrder of [
    ...STAFF_ONLY_WORK_ORDERS,
    ...VENDOR_ASSIGNED_WORK_ORDERS,
  ]) {
    await expect(page.getByText(workOrder)).toHaveCount(0);
  }

  // Safe to count here, unlike the two specs above: this account is linked to
  // nothing, so RLS returns zero rows no matter what another spec writes.
  await expect(page.locator("tbody tr")).toHaveCount(0);
});

test("a wrong password is refused without saying why", async ({ page }) => {
  await signIn(page, "manager@realtyworks.test", "not-the-password");

  await expect(page).toHaveURL("/login");
  await expect(formAlert(page)).toHaveText("Invalid email or password.");

  // The half of this only a real browser can prove: React resets an
  // uncontrolled form after every action, so without the values the action
  // echoes back, the address would be gone by the time the error rendered.
  await expect(page.getByLabel("Email")).toHaveValue(
    "manager@realtyworks.test",
  );
  await expect(page.getByLabel("Password")).toHaveValue("");
});

test("a rejected signup keeps everything but the password", async ({
  page,
}) => {
  // Both rejection paths, in the order a real user hits them. Nothing here
  // writes — the address is a seeded one, so the second attempt fails on the
  // duplicate — which keeps this off the fresh-seed state the self-registration
  // spec depends on.
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Already Registered");
  await page.getByLabel("Email").fill("manager@realtyworks.test");
  await page.getByLabel("Phone").fill("12");
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // Rejected by the schema, before Supabase. The field the user has to fix is
  // the only thing they should have to look at.
  await expect(page.getByText("Enter a valid phone number.")).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue("Already Registered");
  await expect(page.getByLabel("Email")).toHaveValue(
    "manager@realtyworks.test",
  );
  await expect(page.getByLabel("Phone")).toHaveValue("12");
  await expect(page.getByLabel("Password")).toHaveValue("");

  // Rejected by GoTrue this time, which is a different return path in the
  // action and resets the form just the same.
  await page.getByLabel("Phone").fill("+1 (555) 123-9999");
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(formAlert(page)).toContainText("Could not create that account");
  await expect(page.getByLabel("Full name")).toHaveValue("Already Registered");
  // As typed, not the normalized +15551239999 the schema would have produced.
  await expect(page.getByLabel("Phone")).toHaveValue("+1 (555) 123-9999");
  await expect(page.getByLabel("Password")).toHaveValue("");
});

test("the dashboard is unreachable while signed out", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("the root path routes a signed-out visitor to login", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL("/login");
});

test("signing out ends the session", async ({ page }) => {
  await signIn(page, "manager@realtyworks.test");
  await expect(page).toHaveURL("/dashboard");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");

  // Not just a redirect — the session is actually gone.
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/login");
});
