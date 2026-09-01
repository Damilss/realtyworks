import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * The vendor half of the Phase 3 vertical slice, end to end against a real
 * Supabase stack: staff add a vendor, assign them, and mint a magic link; the
 * vendor opens it in a *different browser context*, gets a real session, reports
 * progress, and uploads a photo; the trail names them for both.
 *
 * The second context is the point. A vendor session established by pasting a
 * link is the only login path this app has that never touches the sign-in form,
 * and the only way to prove the token round trip works is to redeem one in a
 * browser that has never authenticated.
 *
 * Every spec here WRITES, and the invite path also creates rows in `auth.users`
 * that no test deletes — so this needs a freshly seeded database. CI runs
 * `supabase db reset` immediately before Playwright; locally, re-run it first.
 */

const SEED_PASSWORD = "password123";
const SEED_PROPERTY = "Maple Court Apartments";

function main(page: Page) {
  return page.getByRole("main");
}

function trailEntry(page: Page, text: string) {
  return main(page).getByRole("listitem").filter({ hasText: text });
}

/**
 * Label-, worker- and retry-scoped, for the same reason as `title()` in
 * work-orders.spec.ts — but it matters more here. An invited vendor's email
 * becomes an `auth.users` row, and re-running against the same database would
 * hit `email_exists`, link the *existing* account to a second vendor row, and
 * fail the `vendors_profile_id_key` partial unique index. Distinct addresses
 * keep a retry from colliding with the attempt that created the account.
 *
 * `label` carries no less weight than the worker index, so it is required
 * rather than optional. Worker and attempt separate a spec from *other runs of
 * itself*; only the label separates it from a different spec that happens to
 * share its worker — which is every spec under `--workers=1`, and any spec once
 * there are more of them than workers. Sharing an address there leaves two rows
 * answering to one name, and `addVendor()` finds a vendor already invited by a
 * spec that has already finished.
 *
 * Labels must also not nest: `addVendor()` locates its row by substring, so
 * "Loop" alongside "Loop extra" would match two.
 */
function vendorIdentity(
  testInfo: { workerIndex: number; retry: number },
  label: string,
) {
  const suffix = `w${testInfo.workerIndex}${testInfo.retry > 0 ? `r${testInfo.retry}` : ""}`;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    name: `Test Vendor ${label} ${suffix}`,
    email: `test-vendor-${slug}-${suffix}@realtyworks.test`,
  };
}

function workOrderTitle(
  testInfo: { workerIndex: number; retry: number },
  label: string,
) {
  const attempt = testInfo.retry > 0 ? `-r${testInfo.retry}` : "";
  return `${label} (w${testInfo.workerIndex}${attempt})`;
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");
}

async function addVendor(
  page: Page,
  vendor: { name: string; email: string },
): Promise<void> {
  await page.goto("/vendors");
  await page.getByLabel("Name").fill(vendor.name);
  await page.getByLabel("Email").fill(vendor.email);
  await page.getByRole("button", { name: "Add vendor" }).click();

  // The row appearing is the insert; "Not invited" is `profile_id` still null,
  // which is the state the invite is about to change.
  const row = main(page).getByRole("row").filter({ hasText: vendor.name });
  await expect(row).toContainText("Not invited");
}

async function createAndAssign(
  page: Page,
  title: string,
  vendorName: string,
): Promise<string> {
  await page.goto("/work-orders/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Property").selectOption({ label: SEED_PROPERTY });
  await page.getByRole("button", { name: "Create work order" }).click();
  await expect(page).toHaveURL(/\/work-orders\/[0-9a-f-]{36}$/);

  await page.getByLabel("Vendor").selectOption({ label: vendorName });
  await page.getByRole("button", { name: "Assign vendor" }).click();
  await expect(page.getByText("Assigned", { exact: true })).toBeVisible();

  return page.url();
}

/**
 * Reads the minted link out of the readonly input.
 *
 * The link is rendered into a real form control rather than only being pushed to
 * the clipboard, which is what makes it readable here without granting Chromium
 * clipboard permissions — and, more to the point, what keeps it copyable for a
 * user whose browser refuses the Clipboard API.
 */
async function mintInviteLink(page: Page, previous?: string): Promise<string> {
  await page.getByRole("button", { name: /sign-in link/i }).click();

  const linkField = page.getByLabel("Sign-in link");
  await expect(linkField).toBeVisible();

  // Re-minting: the field is already on screen holding the *previous* link — the
  // action is pending, and useActionState serves the last state until it
  // resolves — so reading straight away hands back a token that has just been
  // spent. The value changing is the only signal that the new one has landed.
  if (previous !== undefined) {
    await expect(linkField).not.toHaveValue(previous);
  }

  const url = await linkField.inputValue();
  expect(url).toContain("/auth/confirm?");
  expect(url).toContain("token_hash=");

  return url;
}

/** A browser that has never signed in — the vendor's phone, in effect. */
async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/** A tiny but real JPEG: SOI, a JFIF APP0 marker, EOI. */
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff,
  0xd9,
]);

test("a vendor is invited, signs in by link, reports progress, and uploads a photo", async ({
  page,
  browser,
}, testInfo) => {
  const vendor = vendorIdentity(testInfo, "Loop");
  const title = workOrderTitle(testInfo, "Vendor loop");

  await signIn(page, "manager@realtyworks.test");
  await addVendor(page, vendor);
  const workOrderUrl = await createAndAssign(page, title, vendor.name);
  const inviteUrl = await mintInviteLink(page);

  // ── the vendor's side, in a browser with no session ──────────────────────
  const vendorPage = await freshPage(browser);

  // The link deep-links the job (docs/vendor-access.md §3b): one tap, and they
  // are looking at the work order rather than at a list they have to search.
  await vendorPage.goto(inviteUrl);
  await expect(vendorPage).toHaveURL(workOrderUrl);
  await expect(vendorPage.getByRole("heading", { name: title })).toBeVisible();

  // The account was created by the invite, so the shell knows their name —
  // handle_new_user() read it out of the `user_metadata` createUser sent, which
  // is the reason the invite creates the account explicitly instead of letting
  // generateLink() do it implicitly. Scoped to the header: the same name also
  // appears as the assigned vendor and in the trail, and matching any of those
  // would prove nothing about the *profile* row.
  await expect(
    vendorPage.getByRole("banner").getByText(vendor.name),
  ).toBeVisible();
  // The role badge. Exact, because the vendor's own *name* contains "vendor".
  await expect(
    vendorPage.getByRole("banner").getByText("vendor", { exact: true }),
  ).toBeVisible();

  // Status: only the two `guard_work_order_update()` admits. Cancelling is not
  // on offer because the trigger would raise 42501 for a vendor.
  const statusSelect = vendorPage.getByLabel("Status");
  await expect(statusSelect.getByRole("option")).toHaveText([
    "Choose a status…",
    "In progress",
    "Completed",
  ]);

  await statusSelect.selectOption("in_progress");
  await vendorPage.getByRole("button", { name: "Update status" }).click();
  await expect(vendorPage.getByText("In progress").first()).toBeVisible();

  // Upload: the object goes straight from this browser to Storage under the
  // vendor's own session, and only the metadata row is written server-side.
  await vendorPage.getByLabel("Add a photo or receipt").setInputFiles({
    name: "repair.jpg",
    mimeType: "image/jpeg",
    buffer: JPEG_BYTES,
  });
  await vendorPage.getByRole("button", { name: "Upload" }).click();

  // Listed means the metadata row landed — the app lists from metadata, never
  // from the bucket, so a stored object with no row would show nothing here.
  await expect(
    main(vendorPage).getByRole("link", { name: "repair.jpg" }),
  ).toBeVisible();

  // ── back to the manager ─────────────────────────────────────────────────
  await page.goto(workOrderUrl);

  // Both vendor actions, attributed to the vendor. The status entry comes from
  // log_work_order_changes() and the upload one from log_attachment_added(),
  // which coalesces a NULL auth.uid() (the metadata insert runs as service_role)
  // to `uploaded_by` — so this assertion is what proves the action passed the
  // actor explicitly instead of leaning on a default that could never work.
  await expect(
    trailEntry(page, "changed status from Assigned to In progress"),
  ).toContainText(vendor.name);
  await expect(trailEntry(page, "uploaded repair.jpg")).toContainText(
    vendor.name,
  );

  // And the manager can open the file, through a URL signed for *their* session.
  await expect(
    main(page).getByRole("link", { name: "repair.jpg" }),
  ).toBeVisible();

  // The vendors table now reports the link as live.
  await page.goto("/vendors");
  await expect(
    main(page).getByRole("row").filter({ hasText: vendor.name }),
  ).toContainText("Invited");
});

test("a magic link is single use", async ({ page, browser }, testInfo) => {
  const vendor = vendorIdentity(testInfo, "Single use");
  const title = workOrderTitle(testInfo, "Single use");

  await signIn(page, "manager@realtyworks.test");
  await addVendor(page, vendor);
  await createAndAssign(page, title, vendor.name);
  const inviteUrl = await mintInviteLink(page);

  const first = await freshPage(browser);
  await first.goto(inviteUrl);
  await expect(first.getByRole("heading", { name: title })).toBeVisible();

  // Replaying a spent token is the case that matters: SMS gets forwarded and
  // screenshotted (docs/vendor-access.md §3a), so a link that keeps working is
  // a standing credential rather than a login.
  const second = await freshPage(browser);
  await second.goto(inviteUrl);
  await expect(second).toHaveURL("/login?error=invalid-link");
  await expect(
    second.getByText(/expired or has already been used/i),
  ).toBeVisible();
});

test("a reassignment clears the outgoing vendor's link from the page", async ({
  page,
}, testInfo) => {
  const outgoing = vendorIdentity(testInfo, "Outgoing");
  const incoming = vendorIdentity(testInfo, "Incoming");
  const title = workOrderTitle(testInfo, "Reassigned");

  await signIn(page, "manager@realtyworks.test");
  await addVendor(page, outgoing);
  await addVendor(page, incoming);
  await createAndAssign(page, title, outgoing.name);

  await mintInviteLink(page);

  // `assignVendor` revalidates rather than navigating, so this re-renders the
  // page in place. The invite panel keeps its position in the tree — and, unless
  // something forces a remount, its useActionState along with it.
  await page.getByLabel("Vendor").selectOption({ label: incoming.name });
  await page.getByRole("button", { name: "Reassign vendor" }).click();

  // The panel is now about the incoming vendor…
  await expect(
    main(page).getByText(`Creates an account for ${incoming.name}`),
  ).toBeVisible();

  // …and the outgoing vendor's link is off the screen with them. A link that
  // stays on screen under the new assignee's name is how a bearer token reaches
  // the wrong person: it signs its holder in as the *outgoing* vendor, exposing
  // the other jobs assigned to them and attributing whatever the holder does to
  // a vendor who never touched the job.
  //
  // Scope, precisely: this is the UI dropping a stale token, **not** revocation.
  // `assignVendor` writes `vendor_id` and touches nothing in GoTrue, so a link
  // copied before the reassignment still redeems and still signs its holder in
  // as the outgoing vendor — RLS hides *this* job from them afterwards, and
  // their other jobs are as visible as they were. That is why the minted URL
  // above is discarded rather than replayed: there is no revocation here to
  // assert on yet (docs/backlog.md, "Reassignment does not revoke an
  // outstanding invite link").
  await expect(page.getByLabel("Sign-in link")).toHaveCount(0);
});

/**
 * Destinations that must never survive `safeNext()` in
 * src/app/auth/confirm/route.ts.
 *
 * Mirrored — deliberately — by the table in src/app/auth/confirm/route.test.ts;
 * keep the two in step. That layer proves the logic case by case in
 * milliseconds. This one proves the guard is *reached*, which is the half the
 * previous version of this spec missed.
 *
 * Written **decoded**: `URLSearchParams` re-encodes, so the second entry is
 * sent as `next=%2F%5Cevil.example` — the exact reported payload — without
 * hand-encoding it into something the handler never sees. Each entry is a
 * function of the app's origin, because two of them need it.
 */
const OFF_SITE_NEXT: ((origin: string) => string)[] = [
  () => "//evil.example/",
  () => "/\\evil.example",
  () => "/\\/evil.example",
  () => "/\t/evil.example",
  () => "/\r/evil.example",
  () => "https://evil.example/",
  // The last two take the app's own origin, because that is the whole trick:
  // the host rides in the *pathname*, so the parse the guard does says
  // same-origin and the bare path it would emit says `//evil.example`.
  (origin: string) => `${origin}//evil.example`,
  (origin: string) => `${origin}/\\/evil.example`,
];

/** Re-crafts a minted invite to point somewhere else, as an attacker would. */
function withNext(inviteUrl: string, next: string): string {
  const url = new URL(inviteUrl);
  url.searchParams.set("next", next);

  return url.toString();
}

test("the confirm endpoint refuses an off-site redirect", async ({
  page,
  browser,
}, testInfo) => {
  // Nine invites and nine contexts, well past the default 30s.
  test.slow();

  // This is the one endpoint that mints a session, which makes it the worst
  // place in the app for an open redirect: the victim is genuinely signed in
  // when they land on the attacker's page, which is what makes a "session
  // expired, sign in again" form work.
  //
  // Every case below redeems a **real, unspent** token, and that is the whole
  // point. The previous version of this spec passed `token_hash=bogus`:
  // verification failed, the handler bounced to /login, and `next` was never
  // read — so it asserted we stayed on our own host for reasons that had
  // nothing to do with the guard, and deleting `safeNext()` left it green
  // (docs/backlog.md).
  const vendor = vendorIdentity(testInfo, "Redirect");
  const title = workOrderTitle(testInfo, "Redirect guard");

  await signIn(page, "manager@realtyworks.test");
  await addVendor(page, vendor);
  const workOrderUrl = await createAndAssign(page, title, vendor.name);
  const workOrderPath = new URL(workOrderUrl).pathname;

  let minted: string | undefined;

  for (const buildNext of OFF_SITE_NEXT) {
    // A fresh token per case — they are single use, and a spent one fails
    // verification before the redirect line is ever reached.
    minted = await mintInviteLink(page, minted);

    const vendorPage = await freshPage(browser);
    await vendorPage.goto(withNext(minted, buildNext(new URL(minted).origin)));

    // Landed on the fallback…
    await expect(vendorPage).toHaveURL("/dashboard");
    // …and genuinely signed in. That second assertion is what proves the token
    // verified and the guard ran: a refused token would be on /login instead.
    await expect(
      vendorPage.getByRole("banner").getByText(vendor.name),
    ).toBeVisible();

    await vendorPage.context().close();
  }

  // And a legitimate destination still arrives, so the guard is not simply
  // swallowing every `next` — deep-linking the assigned job is what the invite
  // is for (docs/vendor-access.md §3b).
  minted = await mintInviteLink(page, minted);

  const deepLinked = await freshPage(browser);
  await deepLinked.goto(withNext(minted, workOrderPath));

  await expect(deepLinked).toHaveURL(workOrderPath);
  await expect(deepLinked.getByRole("heading", { name: title })).toBeVisible();

  // Closed for the same reason the loop closes its own: `browser` is
  // worker-scoped, so a context left open outlives this test, and Playwright
  // starts a trace chunk on every still-open context at the start of each
  // later test in the worker — padding unrelated traces with a session that
  // stopped being interesting here.
  await deepLinked.context().close();
});

test("a vendor cannot reach the vendors page", async ({ page }) => {
  await signIn(page, "vendor@realtyworks.test");

  // Not offered in the nav…
  await expect(page.getByRole("link", { name: "Vendors" })).toHaveCount(0);

  // …and typing the URL says so rather than rendering a form the
  // `vendors_insert_staff` policy would refuse.
  await page.goto("/vendors");
  await expect(
    page.getByRole("heading", { name: "Not available" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add vendor" })).toHaveCount(0);
});

test("a vendor with no email cannot be invited", async ({ page }, testInfo) => {
  const suffix = `w${testInfo.workerIndex}${testInfo.retry > 0 ? `r${testInfo.retry}` : ""}`;
  const name = `Phone Only Vendor ${suffix}`;
  const title = workOrderTitle(testInfo, "Phone only");

  await signIn(page, "manager@realtyworks.test");

  // Phone-only is a valid vendor row — `vendors_contact_method` wants either
  // one — it just cannot be invited until SMS delivery lands in Phase 5.
  await page.goto("/vendors");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Phone").fill("+15550001111");
  await page.getByRole("button", { name: "Add vendor" }).click();
  await expect(
    main(page).getByRole("row").filter({ hasText: name }),
  ).toBeVisible();

  await createAndAssign(page, title, name);
  await page.getByRole("button", { name: /sign-in link/i }).click();

  await expect(page.getByText(/Add an email address/i)).toBeVisible();
  await expect(page.getByLabel("Sign-in link")).toHaveCount(0);
});

test("a vendor with neither email nor phone is refused", async ({ page }) => {
  await signIn(page, "manager@realtyworks.test");
  await page.goto("/vendors");

  // Mirrors `vendors_contact_method`, which collapses whitespace to NULL before
  // checking — so a form full of spaces has to fail here too, or the user gets
  // a bare 23514 naming a rule no field mentions.
  await page.getByLabel("Name").fill("Unreachable Vendor");
  await page.getByLabel("Phone").fill("   ");
  await page.getByRole("button", { name: "Add vendor" }).click();

  await expect(
    page.getByText("Enter an email address or a phone number."),
  ).toBeVisible();

  // And the name survives the failed submit (CLAUDE.md §0).
  await expect(page.getByLabel("Name")).toHaveValue("Unreachable Vendor");
});
