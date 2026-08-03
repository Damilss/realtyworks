import { test, expect, type Page } from "@playwright/test";

/**
 * The write half of the Phase 3 vertical slice, against a real Supabase stack.
 *
 * What matters here is not that a form submits — it is that the *database* did
 * the work: the insert lands with status 'open' because `status` has no INSERT
 * grant, assignment writes an activity row because a trigger saw the UPDATE,
 * and a vendor sees a job appear because RLS re-evaluated `vendor_id`. None of
 * that is observable from a unit test with a mocked client.
 *
 * Every spec here WRITES, so it needs a freshly seeded database — CI runs
 * `supabase db reset` immediately before Playwright; locally, re-run it first.
 * Credentials and fixtures come from supabase/seed.sql.
 */

const SEED_PASSWORD = "password123";
const SEED_VENDOR_NAME = "Bob's Handyman Services";
const SEED_PROPERTY = "Maple Court Apartments";

/**
 * `profiles.full_name` for manager@realtyworks.test. The trail resolves it
 * through `staff_directory`, so asserting on it is asserting that the view
 * works — which is the whole reason it exists.
 */
const SEED_MANAGER_NAME = "Manny Manager";

/**
 * The header renders the signed-in user's name too, so every assertion about
 * trail content is scoped to <main> to stay out of strict-mode violations.
 */
function main(page: Page) {
  return page.getByRole("main");
}

/**
 * One entry in the activity trail, picked by what it says. Asserting on a
 * specific entry rather than on a name anywhere in the page is what makes the
 * assertion mean something: the same actor legitimately appears on several
 * entries, so a bare name match proves nothing about which one resolved.
 */
function trailEntry(page: Page, text: string) {
  return main(page).getByRole("listitem").filter({ hasText: text });
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
}

/**
 * Unique per worker rather than per wall-clock: stable enough to assert on,
 * distinct enough that parallel workers do not read each other's rows.
 *
 * The attempt index is in there because these rows outlive a failed attempt.
 * Without it a CI retry (playwright.config.ts sets retries: 2) would re-create a
 * title the first attempt already committed and assert against two rows —
 * turning one transient flake into a run that cannot recover. Locally retries
 * are 0, so the title is byte-identical to before and a database that was never
 * reset still fails loudly instead of quietly passing.
 */
function title(
  testInfo: { workerIndex: number; retry: number },
  label: string,
) {
  const attempt = testInfo.retry > 0 ? `-r${testInfo.retry}` : "";
  return `${label} (w${testInfo.workerIndex}${attempt})`;
}

async function createWorkOrder(page: Page, workOrderTitle: string) {
  await page.getByRole("link", { name: "New work order" }).click();
  await expect(page).toHaveURL("/work-orders/new");

  await page.getByLabel("Title").fill(workOrderTitle);
  await page.getByLabel("Property").selectOption({ label: SEED_PROPERTY });
  await page.getByLabel("Description").fill("Reported by the tenant.");
  await page.getByLabel("Priority").selectOption("high");
  await page.getByRole("button", { name: "Create work order" }).click();

  // The action redirects to the new work order, so the URL proves the insert.
  await expect(page).toHaveURL(/\/work-orders\/[0-9a-f-]{36}$/);
}

test("a manager creates a work order and it starts open and unassigned", async ({
  page,
}, testInfo) => {
  const workOrderTitle = title(testInfo, "Create only");

  await signIn(page, "manager@realtyworks.test");
  await createWorkOrder(page, workOrderTitle);

  await expect(
    page.getByRole("heading", { name: workOrderTitle }),
  ).toBeVisible();

  // status and vendor_id are excluded from the INSERT grant, so this is the
  // database's doing, not the form's.
  await expect(page.getByText("Open", { exact: true })).toBeVisible();
  await expect(page.getByText("Unassigned")).toBeVisible();

  // The trigger wrote the first trail entry as part of the same INSERT.
  await expect(page.getByText("created this work order")).toBeVisible();
});

test("assigning a vendor moves the work order and shows up in the trail", async ({
  page,
}, testInfo) => {
  const workOrderTitle = title(testInfo, "Assign flow");

  await signIn(page, "manager@realtyworks.test");
  await createWorkOrder(page, workOrderTitle);

  await page.getByLabel("Vendor").selectOption({ label: SEED_VENDOR_NAME });
  await page.getByRole("button", { name: "Assign vendor" }).click();

  await expect(page.getByText("Assigned", { exact: true })).toBeVisible();

  // Two trail rows from one UPDATE — log_work_order_changes() writes one per
  // change type, and the identity PK is what orders them inside the statement.
  await expect(page.getByText(`assigned ${SEED_VENDOR_NAME}`)).toBeVisible();
  await expect(
    page.getByText("changed status from Open to Assigned"),
  ).toBeVisible();
});

test("a note is recorded against its author and cannot be blank", async ({
  page,
}, testInfo) => {
  const workOrderTitle = title(testInfo, "Note flow");

  await signIn(page, "manager@realtyworks.test");
  await createWorkOrder(page, workOrderTitle);

  // Blank is refused before the round trip; the DB CHECK backs it up.
  await page.getByLabel("Add a note").fill("   ");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Enter a note.")).toBeVisible();

  await page.getByLabel("Add a note").fill("Tenant will be home after 4pm.");
  await page.getByRole("button", { name: "Add note" }).click();

  // actor_id has no insert grant — the name on the entry comes from the
  // column's auth.uid() default, not from anything the form sent.
  await expect(
    trailEntry(page, "Tenant will be home after 4pm."),
  ).toContainText(SEED_MANAGER_NAME);

  // Recorded means recorded: the box empties rather than echoing back.
  await expect(page.getByLabel("Add a note")).toHaveValue("");
});

test("assignment is what makes a work order visible to the vendor", async ({
  page,
}, testInfo) => {
  const workOrderTitle = title(testInfo, "RLS handoff");

  await signIn(page, "manager@realtyworks.test");
  await createWorkOrder(page, workOrderTitle);
  const workOrderUrl = page.url();

  // Before assignment the vendor cannot reach it — and gets a 404, not a
  // "forbidden", because RLS returns zero rows either way and a distinct
  // refusal would confirm the id is real.
  await signOut(page);
  await signIn(page, "vendor@realtyworks.test");
  await expect(page.getByText(workOrderTitle)).toHaveCount(0);

  // Asserting the status code, not page copy: getWorkOrder() calls notFound(),
  // and a real 404 response is the observable proof that RLS returned no row.
  const refused = await page.goto(workOrderUrl);
  expect(refused?.status()).toBe(404);

  // Assign it, and the same URL starts working for the same account.
  await signOut(page);
  await signIn(page, "manager@realtyworks.test");
  await page.goto(workOrderUrl);
  await page.getByLabel("Vendor").selectOption({ label: SEED_VENDOR_NAME });
  await page.getByRole("button", { name: "Assign vendor" }).click();
  await expect(page.getByText("Assigned", { exact: true })).toBeVisible();

  await signOut(page);
  await signIn(page, "vendor@realtyworks.test");
  await expect(page.getByText(workOrderTitle)).toBeVisible();

  await page.goto(workOrderUrl);
  await expect(
    page.getByRole("heading", { name: workOrderTitle }),
  ).toBeVisible();

  // The trail names the staff member who assigned them — resolved through
  // staff_directory, because a vendor has no SELECT policy on profiles. This is
  // the assertion that would fail if the query used a `profiles` embed: the
  // vendor would see the entry, but with no name on it.
  await expect(trailEntry(page, `assigned ${SEED_VENDOR_NAME}`)).toContainText(
    SEED_MANAGER_NAME,
  );

  // Assignment is not authorship: the vendor gets no assign control.
  await expect(page.getByLabel("Vendor")).toHaveCount(0);
});

test("a vendor cannot open the create form", async ({ page }) => {
  await signIn(page, "vendor@realtyworks.test");

  await expect(page.getByRole("link", { name: "New work order" })).toHaveCount(
    0,
  );

  await page.goto("/work-orders/new");
  await expect(page.getByRole("heading", { name: "Staff only" })).toBeVisible();
});
