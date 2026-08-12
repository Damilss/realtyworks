# Playwright (E2E testing)

End-to-end tests for RealtyWorks. Playwright drives a real browser against the
running app to verify user-facing behavior.

**Current scope (complete since 2026-08-03):** the boot smoke test plus the
whole Phase 3 vertical slice — 23 specs across four files, all against a
**real, seeded Supabase stack**:

| File | Specs | Covers |
| --- | --- | --- |
| `smoke.spec.ts` | 1 | the app boots and serves a page |
| `auth.spec.ts` | 8 | the auth loop: sign in as each seeded role, self-register, wrong password, rejected signup keeps its fields, signed-out redirect, root redirect, sign out |
| `work-orders.spec.ts` | 7 | the staff write path: create, assign, note (and the blank-note refusal), assignment making a job visible to its vendor, select state after a failed submit, a malformed id 404, a vendor refused the create form |
| `vendor-loop.spec.ts` | 7 | the vendor half: invite → redeem a real magic link in a second browser context → status + photo; single use, the stale link cleared from the page on reassignment (UI only — see below), the off-site redirect refusal, and the two un-invitable vendor cases |

The suite's point is not "a cookie was set." It is that the *same* URL renders
different rows for different people — the manager sees every seeded work order,
the assigned vendor sees only theirs, a self-registered stranger sees none. That
is RLS observed through the product, and it is only meaningful against a real
database.

**What the reassignment spec does not prove.** It asserts the outgoing vendor's
link is gone from the *manager's page* — the `key={assignedVendor.id}` remount in
`work-orders/[id]/page.tsx` dropping the `useActionState` that held it, so a
bearer token never sits on screen under the incoming vendor's name. It is not
token revocation. `assignVendor` writes `vendor_id` and nothing else; a link
already copied before the reassignment still redeems and still signs its holder
in as the *outgoing* vendor. RLS then hides the reassigned job from them, but
their other assigned jobs are visible exactly as before. Reassignment is a change
of job, not a change of access — see `docs/backlog.md` ("Reassignment does not
revoke an outstanding invite link") for what real revocation would take.

**Assertions are by identity, never by row count.** The config runs fully
parallel against one shared database and most specs write to it, so "every work
order" is the seed plus whatever another spec has committed by then — and a CI
retry re-runs against the rows the failed attempt left behind. Naming the rows
is also the stronger claim: a count of five never said it was the right five.

---

## Prerequisites

- Node **24** (`nvm use` — reads `.nvmrc`)
- **pnpm** (`pnpm@11.13.1`). Do **not** use `npm init playwright` — it writes a
  `package-lock.json`, adds example tests, and drops in its own GitHub Actions
  workflow, none of which we want.
- **A running local Supabase stack, freshly reset**
  (`pnpm exec supabase start` → `pnpm exec supabase db reset`). The specs sign
  in as the seeded users from `supabase/seed.sql` and assert against the seeded
  fixtures by name, so they need the known-good state, not merely a migrated
  database.
- A **`.env.local`** pointing at that stack. Playwright boots the app itself
  (see below), and `src/proxy.ts` refreshes the Supabase session on every
  request — without the config the app 500s on every route and the run fails on
  the `webServer` timeout rather than on an assertion. Setup is in the
  [README](../README.md#install--run).
  **Placeholder values no longer work.** They used to: with no session cookie
  the refresh short-circuits before any network call, so a smoke test that never
  logged in was happy with fiction. Most specs here sign in, and fiction fails
  at the first assertion with a connection error that reads like an application
  bug.
- **`SUPABASE_SECRET_KEY` in that same file**, not just the two
  `NEXT_PUBLIC_SUPABASE_*` values. `vendor-loop.spec.ts` invites a vendor and
  uploads a photo, and both are service-role writes through
  `src/lib/supabase/admin.ts`. Without the key those actions return "Vendor
  invites are not configured on this server." / "Uploads are not configured on
  this server." — so that one suite goes red while everything else stays green,
  which reads like a vendor bug rather than a missing variable. The README's
  `supabase status` redirect writes it for you (renaming the CLI's
  `SECRET_KEY`), exactly as the CI job does.

## Installation

Two separate steps — the library and the browser binaries are installed
independently:

```bash
pnpm add -D @playwright/test          # the test runner/library (devDependency)
pnpm exec playwright install chromium # downloads the Chromium binary into Playwright's cache
```

The browsers do **not** live in `node_modules`; `playwright install` fetches
them into a separate Playwright cache. We pin to `chromium` to keep the download
small. To add more engines later:

```bash
pnpm exec playwright install firefox webkit
```

## Running the tests

```bash
pnpm exec supabase db reset   # known-good state — see "Re-running" below
pnpm test:e2e                 # run all E2E tests (script in package.json)
```

You do **not** need to start the dev server yourself. `playwright.config.ts`
has a `webServer` block that boots `pnpm dev` automatically, waits for
`http://127.0.0.1:3000`, runs the tests, then shuts it down. (If a dev server is
already running locally, Playwright reuses it.)

**`baseURL` is `127.0.0.1`, not `localhost`** — deliberately, and it must stay
matched to `[auth] site_url` in `supabase/config.toml`. Cookies are scoped per
host, and the two hostnames are different hosts to a browser: a session
established through an auth redirect on one is invisible on the other. Nothing
breaks today, because password sign-in sets the cookie on whatever host served
the form — it breaks the moment OAuth or an email confirmation link sends the
user through Supabase and back. `next.config.ts` carries a matching
`allowedDevOrigins: ["127.0.0.1"]`, because the dev server initializes on
`localhost` and otherwise warns on every run about cross-origin requests to
dev-only assets.

### Re-running locally

**Most specs write, so `supabase db reset` before each pass is not optional.**
`auth.spec.ts` self-registers, every spec in `work-orders.spec.ts` inserts, and
every spec in `vendor-loop.spec.ts` creates a vendor row and an `auth.users`
account that nothing deletes. Those addresses are derived from the worker index,
the retry count, and a per-spec label rather than randomized — a fresh address
every run would pass forever while quietly filling `auth.users` — so a second
run against the same database fails with "account already exists," or links an
existing account to a second vendor row and trips the `vendors_profile_id_key`
partial unique index. CI gets this for free; it resets immediately before
Playwright starts.

Useful variants:

```bash
pnpm exec playwright test --ui               # interactive UI mode (great for debugging)
pnpm exec playwright test --headed           # watch the real browser
pnpm exec playwright test --debug            # step through with the inspector
pnpm exec playwright test vendor-loop        # filter by test file name/path
pnpm exec playwright test -g "magic link"    # filter by test title (--grep)
pnpm exec playwright show-report             # open the HTML report from the last run
```

## Where things live

```
playwright.config.ts           # config: testDir, baseURL, browser, webServer auto-boot
tests/e2e/                     # E2E specs (*.spec.ts)
tests/e2e/smoke.spec.ts        # the app boots + serves a page
tests/e2e/auth.spec.ts         # the auth loop: sign in as each seeded role, self-register,
                               # wrong password, rejected signup keeps its fields,
                               # signed-out redirect, root redirect, sign out
tests/e2e/work-orders.spec.ts  # the staff write path: create, assign, note (+ the
                               # blank-note refusal), a vendor seeing a job once
                               # assigned, select state after a failed submit,
                               # bad-id 404, a vendor refused the create form
tests/e2e/vendor-loop.spec.ts  # the vendor half: invite, redeem the link in a
                               # second browser context, status + photo, single
                               # use, the stale link cleared on reassign,
                               # off-site redirect
```

Test runners stay separated by directory: **Vitest** collects `src/**` and
`tests/unit/**` (`vitest.config.ts`); **Playwright** owns `tests/e2e/`. They
never collect each other's files.

Playwright's generated output (`test-results/`, `playwright-report/`,
`blob-report/`, `playwright/.cache/`) is gitignored.

## Writing a test

```ts
import { test, expect } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/"); // resolved against baseURL (127.0.0.1:3000)
  await expect(page).toHaveTitle(/.+/);
});
```

## Troubleshooting

- **`Cannot find module '@playwright/test'`** — run `pnpm add -D @playwright/test`.
  (This also makes `pnpm typecheck` fail until installed, since the config/specs
  import the package.)
- **`Executable doesn't exist ...` / browser missing** — run
  `pnpm exec playwright install chromium`. Installing the npm package alone does
  not download browsers.
- **Hangs on "waiting for 127.0.0.1:3000"** — the dev server is slow to boot on
  first run; the config allows 120s. Confirm `pnpm dev` works on its own.
- **Every login assertion fails / `fetch failed`** — the app is talking to a
  stack that isn't there. Check that `supabase status` reports running services
  and that `.env.local` matches its output; a stale URL or key from a previous
  stack looks exactly like an app bug.
- **Missing seeded rows, or "account already exists"** — the database has
  drifted from the seed. `pnpm exec supabase db reset`, then re-run.
- **Only `vendor-loop.spec.ts` fails, on "not configured on this server"** —
  `SUPABASE_SECRET_KEY` is missing from `.env.local`. The invite and the upload
  are service-role writes, so they are the only things that notice; every other
  spec passes without the key.
- **Wrong Node version** — `nvm use` to match `.nvmrc` (Node 24), the same
  version CI uses.

## CI

The suite runs in CI as a dedicated `e2e` job in `.github/workflows/ci.yml`
("E2E (Playwright auth loop)") — parallel to the `verify` gate
(`lint → format:check → typecheck → test → build → audit`, Vitest only), on the
same triggers (PRs + pushes to `main`/`dev`). The job name predates the rest of
the slice landing in it and is kept deliberately: branch protection matches
required checks **by name**, so a rename silently stops an existing rule from
gating. The job installs deps
(`--frozen-lockfile`) and Chromium (`playwright install --with-deps chromium`,
cached across runs on `~/.cache/ms-playwright`), then — since the auth loop
landed — stands up a real database before testing:

```
supabase start -x studio,imgproxy,edge-runtime,functions,analytics,vector,inbucket
supabase db reset
supabase status -o env … \
  | grep -E '^(NEXT_PUBLIC_|SECRET_KEY=)' \
  | sed 's/^SECRET_KEY=/SUPABASE_SECRET_KEY=/' > .env.local
pnpm run test:e2e
```

The HTML report uploads as a `playwright-report` artifact for debugging.
`next build` in `verify` proves the app compiles; this proves it boots,
authenticates, and enforces RLS.

Four things about that setup are load-bearing:

- **The job sets no `NEXT_PUBLIC_SUPABASE_*` env of its own — and must not.**
  It used to set placeholders, back when nothing logged in. Those had to be
  *removed*, not updated: **process env takes precedence over `.env.local` in
  Next.js**, so a leftover placeholder silently outranks the real values written
  from `supabase status`, and the app keeps addressing a stack that isn't there.
  The failure looks like a network error in the application, not a
  misconfigured job — which is the expensive kind of wrong.
- **`db reset` is not redundant here** (unlike in the `db` job, where it is kept
  as an assertion). The specs assert against the seeded fixtures by name and
  most of them write — including `auth.users` rows nothing cleans up — so the
  run needs the known-good state.
- **The `grep` is load-bearing, and it is an allowlist rather than a filter.**
  `supabase status -o env` also prints `SERVICE_ROLE_KEY` and `JWT_SECRET`, and
  neither belongs in a file `next build` reads. `SECRET_KEY` *is* admitted, and
  renamed by the `sed` to the `SUPABASE_SECRET_KEY` that
  `src/lib/supabase/admin.ts` expects — the vendor invite and the
  attachment-metadata insert are service-role writes with no client grant. It is
  safe there only because it carries no `NEXT_PUBLIC_` prefix, so it is never
  inlined into the bundle. The rename is a `sed` rather than a third
  `--override-name` because `supabase status --help` documents no override path
  for that key, and a wrong one emits nothing at all instead of erroring.
- **The `-x` list is deliberately not the `db` job's, and must not be synced to
  it.** That job talks to Postgres directly and drops Kong, PostgREST and
  Realtime; this one drives the app over HTTP and needs all three. The shared
  rule is narrower than it looks: never exclude `storage-api`, and `db` is not
  excludable at all. Two further things to know before editing this list.
  `functions`, `analytics` and `inbucket` are **not valid `-x` values** and are
  silently ignored, so logflare and mailpit boot regardless — the job runs nine
  containers, not the seven the list implies. And `inbucket` (really `mailpit`)
  is only *meant* to be gone while `[auth.email] enable_confirmations` is
  `false`; turning confirmations on (backlog, required before the Phase 4 public
  deploy) makes signup send mail and this job needs the mailbox back. That is
  why correcting the inert names is a backlog item rather than a drive-by fix —
  the two decisions are coupled.

`timeout-minutes: 20` caps a stack that never reaches healthy, same reasoning as
the `db` job. Cold image pulls mean this is no longer a fast job — details in
[tooling.md](tooling.md).

The vertical slice is fully covered as of 2026-08-03. What joins next is Phase 5
breadth — new pages get specs the same way, against the same seeded stack. See
`CLAUDE.md` §4–§5.
