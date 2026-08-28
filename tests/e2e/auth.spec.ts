import { test, expect, type Page } from "@playwright/test";

import { clearMailbox, waitForAuthLink } from "./mailbox";

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
 * Clicking "Sign out" posts to a server action that redirects; the click on its
 * own does not wait for that to land. Going straight to /login while the POST
 * is still in flight arrives with the session cookie intact, and /login sends
 * an authenticated visitor to /dashboard — so the next step reads as "sign-out
 * did nothing" when it was only unfinished. Let it settle.
 */
async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
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
  const password = "selfreg-password123";
  const recoveredPassword = "selfreg-password456";

  // `db reset` does not empty the mail container, so a local re-run would
  // otherwise find the previous run's message and follow a spent token.
  await clearMailbox(email);

  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Create account" }).click();

  // The gate itself (issue #93): the account exists, but no session came with
  // it. Landing on /dashboard here would mean confirmations are off.
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/signup");

  // The reported edge case: GoTrue treats a second signup for this unconfirmed
  // address as a resend but does not replace the first password or metadata.
  // The app now accepts neither before verification, so the ambiguous success
  // has nothing authoritative to discard.
  //
  // Wait out [auth.email] max_frequency ("1s") before resending. A fixed sleep
  // is normally the wrong tool, but this is a server-side time window rather
  // than a UI state worth polling for: resend inside it and GoTrue returns 429
  // over_email_send_rate_limit, which the action renders — correctly — as "Too
  // many attempts", so the resend path this test exists to cover never runs.
  await page.waitForTimeout(1_100);
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();

  // Only the newest emailed link opens setup. This is the half that a bogus
  // token would silently skip — see the /auth/confirm lesson in docs/backlog.md.
  await page.goto(await waitForAuthLink(email));
  await expect(page).toHaveURL("/account-setup");
  await page.getByLabel("Full name").fill("Self Registered");
  await page.getByLabel("Phone").fill("+1 (555) 123-9999");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Finish account setup" }).click();
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

  // The password selected only after mailbox ownership was proved is the real
  // credential, including after the session is torn down.
  await signOut(page);
  await signIn(page, email, password);
  await expect(page).toHaveURL("/dashboard");

  // Recovery enters the same verified setup boundary. This closes the second
  // lockout path: losing the confirmation session is not permanent.
  await signOut(page);
  await clearMailbox(email);
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send password-reset link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();

  await page.goto(await waitForAuthLink(email));
  await expect(page).toHaveURL("/account-setup");
  await expect(page.getByLabel("Full name")).toHaveValue("Self Registered");
  await expect(page.getByLabel("Phone")).toHaveValue("+15551239999");
  await page.getByLabel("Password", { exact: true }).fill(recoveredPassword);
  await page.getByLabel("Confirm password").fill(recoveredPassword);
  await page.getByRole("button", { name: "Finish account setup" }).click();
  await expect(page).toHaveURL("/dashboard");

  await signOut(page);
  await signIn(page, email, recoveredPassword);
  await expect(page).toHaveURL("/dashboard");
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

test("a rejected signup keeps the submitted email", async ({ page }) => {
  // Both rejection paths, in the order a real user hits them. Nothing here
  // writes — the address is a seeded one, so the second attempt fails on the
  // duplicate — which keeps this off the fresh-seed state the self-registration
  // spec depends on.
  // Valid to the browser, invalid to zod — and that combination is the point.
  // The field is type="email" required, so a value the browser itself rejects
  // ("not-an-email") is never submitted at all: the server action does not run
  // and none of our messages render. "a@b" is a plausible typo Chrome accepts
  // and z.email() does not, so it reaches the schema the way a real user does.
  await page.goto("/signup");
  await page.getByLabel("Email").fill("a@b");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("a@b");

  // Rejected by GoTrue this time, which resets the form just the same.
  await page.getByLabel("Email").fill("manager@realtyworks.test");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(formAlert(page)).toContainText("Could not create that account");
  await expect(page.getByLabel("Email")).toHaveValue(
    "manager@realtyworks.test",
  );
});

test("a mistyped signup address can be corrected without a reload", async ({
  page,
}, testInfo) => {
  // `.tst` is the point: syntactically valid, so zod and GoTrue both accept it,
  // and the confirmation panel then names an address whose link cannot arrive.
  // Before the reset affordance the panel was terminal — no way back short of
  // knowing to reload.
  const typo = `reset-probe-w${testInfo.workerIndex}@realtyworks.tst`;
  const fixed = `reset-probe-w${testInfo.workerIndex}@realtyworks.test`;

  // Unlike the self-registration spec this does not need a fresh seed: neither
  // address is ever confirmed, so a re-run is just GoTrue resending both links.
  await page.goto("/signup");
  await page.getByLabel("Email").fill(typo);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await expect(page.getByText(typo)).toBeVisible();

  await page.getByRole("button", { name: "Use a different address" }).click();

  // The form comes back carrying the typo, which is what makes it correctable
  // rather than retypeable.
  await expect(page.getByLabel("Email")).toHaveValue(typo);
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toHaveCount(0);

  // The half the unit tests structurally cannot reach: they mock
  // `useActionState`, so only a real browser proves the flag the panel sets is
  // cleared on submit rather than suppressing the *next* panel.
  await page.waitForTimeout(1_100); // [auth.email] max_frequency
  await page.getByLabel("Email").fill(fixed);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await expect(page.getByText(fixed)).toBeVisible();
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
