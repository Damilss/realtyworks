# CLAUDE.md — RealtyWorks

@AGENTS.md

Operating guide and source of truth for working on this repo with Claude Code.
Read this fully before generating code, scaffolding, or migrations.

---

## 0. Quick reference

**Package manager is `pnpm` (`pnpm@11.13.1`), not npm.** Node is pinned to
**24** in two places that move together — `.nvmrc` (matched by CI) and
`engines.node` in `package.json` (`>=24 <25`, a warning on install, not a
gate). Stack versions are new and have breaking changes:
**Next.js 16.3.5**, **React 19.2.4**. Per `AGENTS.md`, read the
relevant guide in `node_modules/next/dist/docs/` (`01-app`, `02-pages`,
`03-architecture`, …) before writing Next.js code — do not assume
training-data APIs.

### Commands
```bash
pnpm install            # install deps (CI uses --frozen-lockfile)
pnpm dev                # dev server, http://127.0.0.1:3000 (matches [auth] site_url)
pnpm build              # production build (next build)
pnpm start              # serve the production build
pnpm lint               # eslint (next core-web-vitals + typescript)
pnpm typecheck          # tsc --noEmit (strict)
pnpm test               # vitest run --passWithNoTests
pnpm test:coverage      # same, + the v8 coverage table (what CI runs; no thresholds)
pnpm test:e2e           # playwright auth-loop suite (also runs in CI; boots the dev
                        # server itself, but needs a seeded local stack + .env.local)
pnpm format             # prettier --write .
pnpm format:check       # prettier --check . (CI gate; *.md is ignored)
```

Run a single test file / name:
```bash
pnpm exec vitest run src/path/to/file.test.ts     # one file (one-shot)
pnpm exec vitest run -t "name of test"            # filter by test name
pnpm exec vitest src/path/to/file.test.ts         # watch a single file
```

Supabase local stack (CLI is a pinned devDependency; Docker must be running):
```bash
pnpm exec supabase start        # boot the local stack
pnpm exec supabase stop         # stop it (config.toml changes need stop+start)
pnpm exec supabase db reset     # rebuild from migrations + seed — known-good state
pnpm exec supabase test db      # pgTAP suite in supabase/tests/
pnpm exec supabase gen types typescript --local > src/lib/database.types.ts
                                # regenerate after EVERY migration change,
                                # then `pnpm format` (generated file must pass format:check)
```

Vitest only collects `src/**/*.{test,spec}.{ts,tsx}` and
`tests/unit/**/*.{test,spec}.{ts,tsx}` (see `vitest.config.ts`). Import app code
via the `@/*` alias (`@/* → ./src/*`, `tsconfig.json`).

**CI** (`.github/workflows/ci.yml`, on PR + push to `main`/`dev`): the `verify` job
runs lint → format:check → typecheck → test → build → audit. The test step
runs `test:coverage`, so the coverage table prints in the log; it is
**visibility, not a gate** — no thresholds are configured, and the step fails
only on a failing test (issue #28). Coverage `include` spans all of `src/`, so
an untested module reports 0% instead of vanishing from the table the way
Vitest's default (loaded modules only) would show it. Each check step
after the first uses `if: !cancelled()` so one run reports *every* failure, not
just the first. A parallel `e2e` job boots a local Supabase stack
(`supabase start -x …` → `db reset` → write `.env.local` from `supabase
status`) and runs the whole Playwright vertical slice against it — auth loop,
staff write path, vendor loop (Chromium only, HTML report uploaded as an
artifact) — proving the app *runs* and that RLS holds through a real session,
not just that it compiles. (The job's *name* is still "E2E (Playwright auth
loop)"; branch protection matches required checks by name, so renaming it is a
deliberate change, not a tidy-up.) That job sets no
`NEXT_PUBLIC_SUPABASE_*` of its own on purpose: process env outranks
`.env.local`, so a leftover placeholder would silently outrank the real values.
Its env-writing step is an **allowlist**, not a filter: it admits the CLI's
`SECRET_KEY` and renames it to `SUPABASE_SECRET_KEY` (the invite and the
attachment insert are service-role writes), while `SERVICE_ROLE_KEY` and
`JWT_SECRET` never reach a file `next build` reads. Its stack is **eight
containers**, and since 2026-08-25 that deliberately includes **mailpit**: the
signup spec reads the confirmation email out of it (`tests/e2e/mailbox.ts`), so
the mail container is a dependency of that job rather than dead weight.
A parallel `db` job runs the pgTAP suite (`supabase test db`), so an RLS or
write-guard regression fails CI instead of merging green. It boots a **strictly
smaller stack than `e2e`** — three containers (Postgres, gotrue, storage-api),
because pg_prove talks to Postgres directly and never makes an HTTP request. Do
not sync the two `-x` lists. And note the trap when editing either: the valid
`-x` names are **not** the ones `supabase start --help` prints, and a wrong name
is silently ignored rather than rejected (`docs/tooling.md`).
The audit step (`pnpm audit --audit-level=high`) is blocking — CI fails on any
high/critical advisory. Two more workflows: gitleaks secret scan + Semgrep
SAST (`security.yml`, PR + push to `main`/`dev`; semgrep is blocking, findings
render as PR annotations) and a weekly osv-scanner lockfile CVE scan (plus a
scan on every PR into `main`) (`osv-scanner.yml`). Details + decisions:
`docs/tooling.md`. Reproduce the
main gate locally by running lint/format:check/typecheck/test/build in order
before pushing.

**Git hooks** (Husky, installed by `pnpm install`): pre-commit runs
lint-staged + a gitleaks staged-changes scan (skipped if the binary is
missing); commit-msg runs commitlint (conventional types + `deps` + `wip`; the
old `CI/CD` type is retired in favor of `ci` — see `commitlint.config.mjs`).

### Current state vs. the target in §3

The repo is at **Phase 3 (the vertical slice), complete as of 2026-08-03** —
Phases 1, 2 and 3 are done; **Phase 4 (hosted deployment) is next**. The schema
shipped 2026-07-17 and **merged to
`main` 2026-07-21** (PR #78), so `main` is the migration baseline: every schema
change from here is a *new* forward migration, never an edit to a merged one.
Parts of §3's *application* tree are still the **target**, not yet present.
Verify before assuming they exist:

- **In place — schema layer (on `main`):** `supabase/` with 14 migrations — the
  9 that built the schema (all 7 tables, RLS + grants + triggers in the same
  file as each table) plus 5 forward fixes since the 2026-07-21 baseline (the
  last-landlord delete guard and the signup-phone metadata fix, two narrowing
  `service_role`, and the non-blank-note constraint) — `seed.sql`
  (3 login-able users, sample properties/units/vendor, work orders in all 5
  statuses — `pnpm exec supabase db reset` is the one-command known-good
  state), `supabase/tests/` (pgTAP RLS/guard suite), and the generated
  `src/lib/database.types.ts`. Supabase CLI pinned as a devDependency.
  Settled 2026-07-17: landlord = manager superset (direct property/unit/vendor
  deletes + role management; work-order delete only through the coordinated
  server action); all staff see all properties; vendors scoped to assigned work
  orders (columns guarded by trigger); coordinated work-order hard delete
  removes Storage objects before cascading activity/attachment metadata.
  **Signup is open** as of 2026-07-27 (`[auth] enable_signup = true`), reversing
  the earlier invite-only call — safe because the role comes only from
  server-set `raw_app_meta_data`, so a self-registration is an unlinked
  `vendor` that can read nothing (see the auth-loop bullet below, and
  `docs/schema/my_schema_writeup.md` for the reversal's paper trail).
  Unchanged gotcha: `[auth.email].enable_signup` must STAY `true` — off kills
  logins, see config.toml.
- **In place — foundations:** Husky (pre-commit + commit-msg), commitlint,
  lint-staged, Vitest DOM harness (`tests/unit/`), Playwright
  (+ `tests/e2e/smoke.spec.ts`), gitleaks (CI + pre-commit), Semgrep SAST
  (CI), `pnpm audit` gate, weekly osv-scanner, Dependabot, and the parallel
  `db` job running the pgTAP suite on every PR/push to `main`/`dev`.
- **In place — Supabase clients (2026-07-21):** `@supabase/ssr` +
  `@supabase/supabase-js` installed, and `src/lib/supabase/`
  (`client.ts` browser · `server.ts` per-request server · `proxy.ts` session
  refresh · `env.ts` validated config) wired to the root `src/proxy.ts`.
  **Phase 2 is complete.** Note the Next.js 16 rename: the root `middleware`
  file convention is deprecated in favor of **`proxy`**, so the session-refresh
  file is `src/proxy.ts`, not `middleware.ts` — ignore any `@supabase/ssr`
  guide that says otherwise. Both clients use the *publishable* key and the
  caller's session, so RLS applies identically on server and client; neither is
  privileged.
- **In place — UI toolkit (2026-07-27):** Tailwind CSS v4
  (`@tailwindcss/postcss`, no `tailwind.config.js`) + shadcn/ui (zinc base,
  new-york style) wired via `postcss.config.mjs`, `components.json`, and
  `src/lib/utils.ts` (`cn`); `src/app/globals.css` carries the zinc theme
  tokens; `src/components/ui/` seeded with the `button` primitive. Tailwind
  class order is enforced by `prettier-plugin-tailwindcss`. (The current
  `shadcn` CLI dropped the classic zinc/neutral base colors for named
  "presets", so the toolkit was scaffolded from the registry's zinc tokens
  directly — add further primitives with `pnpm dlx shadcn@latest add <name>`.)
- **In place — auth loop (2026-07-27):** `src/schemas/auth.ts` (zod v4
  `loginSchema` / `signupSchema` / `normalizePhone`), `src/server/queries/`
  (`session.ts` — the DAL: `getSession`, `requireSession`, `getCurrentProfile`,
  `isStaff`, plus `getVerifiedCaller` since 2026-08-30, `cache()`-memoized
  behind `import "server-only"`; `work-orders.ts` — `listWorkOrders()`),
  `src/server/actions/auth.ts` (`signIn` · `signUp` ·
  `signOut`), the `(auth)` route group (`/login` + `/signup`, `useActionState`
  client forms), the `(dashboard)` shell (name, role badge, sign-out **form
  POST**) and `/dashboard` (work-order list, plus a pending-access state for an
  account nothing is linked to). `/` is now just `redirect("/dashboard")`. New
  primitives: `input`, `label`, `card`, `table`, `badge`; new deps: `zod`,
  `server-only`. **Auth checks live in pages and the DAL, never in a layout** —
  Next.js Partial Rendering means a layout check stops running on client-side
  navigation between sibling routes. **A mutating action resolves its caller
  through the DAL too, with `getVerifiedCaller()`** (2026-08-30, PR review):
  `getSession()` reads the JWT's claims, which is a *local* signature check
  once a project uses asymmetric signing keys, so it admits a session revoked
  up to `jwt_expiry` ago — fine for deciding what to render, wrong for
  changing a credential or writing an actor id. `getVerifiedCaller()` asks the
  Auth server instead. An action may import a `server-only` module:
  `"use server"` means the client's module graph stops at the RPC reference,
  which is what keeps the DAL usable from both halves of `src/server/`.
  **Every `useActionState` form echoes its non-sensitive submitted values
  back** in the action's state and reads them as `defaultValue` (fixed
  2026-08-01) — React resets an uncontrolled form after
  *every* function action, error paths included, so anything not echoed is
  retyped after a failed submit. Passwords are never echoed; that one field
  clears. It holds for every form added since, and for the next one.
  Self-service signup
  opened in the same change; the fail-safe is that a self-registration is a `vendor` with no
  `vendors` row, so `current_vendor_id()` is NULL and every vendor-scoped
  policy arm returns nothing (pinned by
  `supabase/tests/03_signup_defaults.test.sql`). Forward migration
  `20260727140000_handle_new_user_phone_from_metadata.sql` taught
  `handle_new_user()` to fall back to `raw_user_meta_data ->> 'phone'`
  (`auth.users.phone` still wins when set) and to store whitespace-only
  name/phone as NULL. **The phone half of that fallback is now dormant**
  (2026-08-31): `/signup` collects an email and nothing else, so `signUp()`
  sends no `options.data` at all, and the only other account-creating path —
  `inviteVendor`'s `admin.createUser` — sends `user_metadata.full_name` and no
  phone. Name and phone are collected at `/account-setup` after the emailed
  link is followed, and `completeAccountSetup()` writes them to `profiles`
  directly; the trigger is `after insert on auth.users`, so the
  `updateUser({ data })` it also makes never reaches it. Leave the fallback in
  place — it is free, it stays correct, and SMS signup (`[auth.sms]
  enable_signup`, Phase 5) is the path that would make it live again — but do
  not describe it as the route a phone travels today. The `full_name` half is
  still live, through the invite. One accepted risk remains, in
  `docs/backlog.md`: there is no
  CAPTCHA, and `[auth.rate_limit] sign_in_sign_ups` is the only brake. (The
  other, `enable_confirmations = false`, was closed 2026-08-25 — see the email
  confirmations bullet below.) **`/forgot-password` widened that risk**
  (2026-09-01, PR review): it is a second unauthenticated endpoint that sends
  mail on an anonymous caller's say-so, and `sign_in_sign_ups` does **not**
  cover `/recover` — 34 consecutive requests from one IP all returned 200 and
  all 34 sent, verified against the running stack. The only cap is
  `[auth.rate_limit] email_sent`, which is a *blast radius* rather than a
  brake: it is project-wide, so `/signup` and `/forgot-password` share one
  hourly pool and exhausting it stops confirmation mail for real signups — and
  it is unenforced locally, because it requires custom SMTP and that block is
  commented out. CAPTCHA covers `/recover` as well as `/signup`, which is why
  the backlog entry now names both. The `signOut()` global-scope defect filed
  alongside it is **fixed** (2026-08-25, issues #92/#98): the action now passes
  `{ scope: "local" }`, so signing out on one device no longer revokes the
  account's sessions everywhere.
- **In place — staff write path (2026-08-02):** `src/schemas/work-order.ts`,
  `src/server/actions/work-orders.ts` (`createWorkOrder` · `assignVendor` ·
  `addNote`), `src/server/queries/` (`properties.ts` · `vendors.ts`, plus
  `getWorkOrder` / `listWorkOrderActivity`), `/work-orders/new` and
  `/work-orders/[id]`, and `src/components/features/work-orders/`. Three rules
  worth carrying into the vendor half. **Use `z.guid()`, never `z.uuid()`**, for
  anything that lands in a Postgres `uuid` column: zod v4's `uuid()` enforces
  RFC 9562 version/variant nibbles that Postgres does not, and it rejects every
  id in `seed.sql`. **Resolve actor names through `public.staff_directory`**,
  never a `profiles` embed — a vendor has no SELECT policy on staff profile
  rows, so the embed silently renders staff actions anonymously. And **forms use
  a native `<select>`** (`src/components/ui/native-select.tsx`), not shadcn's
  Radix Select, so they submit with the server action and work before
  hydration. Forward migration
  `20260802143000_require_non_blank_activity_note.sql` closes the blank-note
  hole (issue #76).
- **In place — the vendor half (2026-08-03), which completes Phase 3:**
  `src/lib/supabase/admin.ts` (the privileged client), `src/lib/attachments.ts`
  (the shared upload contract), `src/schemas/vendor.ts`,
  `src/server/actions/vendors.ts` (`createVendor` · `inviteVendor`),
  `updateWorkOrderStatus` + `recordAttachment` in the work-order actions,
  `src/app/auth/confirm/route.ts`, and `/vendors`. **No migration** — every
  policy, grant and trigger this needed was already on `main`, which is what the
  Phase 2 design was for. Five rules to carry forward:

  **`SUPABASE_SECRET_KEY` is read lazily, inside `createAdminClient()`.** Never
  at module scope: the CI `verify` job runs `next build` with no stack and no
  secret, and a module-scope read fails that build the moment any page's import
  graph reaches the file. It also refuses a `sb_publishable_`-prefixed value,
  and it lives in `admin.ts` rather than `env.ts` because `env.ts` is imported
  by the browser client.

  **Reach for the admin client last, never first.** It bypasses RLS by
  definition, so the caller's access is established with the *session* client
  first — `can_access_work_order()` for an upload, `is_staff()` for an invite —
  and only then is the privileged client created. Signed download URLs are
  minted with the session client for the same reason: signing with the service
  role would hand out URLs RLS had just refused.

  **`inviteVendor` is the one action with its own authorization check**, and the
  exception is real rather than sloppy: `vendors.profile_id` has no client write
  grant, so the write goes through the service role and there is no policy left
  to lean on. `vendors_select_staff_or_self` is not a substitute — its
  `or profile_id = auth.uid()` arm means a read succeeding proves nothing.

  **The magic link is ours, not GoTrue's.** `generateLink` mints the token; we
  build a `/auth/confirm` URL from `properties.hashed_token` and redeem it with
  `verifyOtp`. `properties.action_link` is the implicit flow and returns the
  session in a URL fragment, which a cookie-session app cannot use. Verified
  against the running stack: `generateLink` **sends no email**, and the token is
  **single use**. Full reasoning and the other settled questions:
  `docs/vendor-access.md` §6.

  **Never string-match a URL something downstream will re-parse** (added
  2026-08-12, issue #105). `/auth/confirm`'s redirect guard checked
  `startsWith("/")` and `!startsWith("//")`, and `/\evil.example` passed both —
  `\` only becomes an authority separator once the WHATWG parser reads it, and
  tabs/newlines are stripped *after* any string check would have approved them.
  Parse with `new URL(value, origin)`, compare `.origin`, and return
  `pathname + search + hash` so no host is ever emitted — **then parse that
  result again and require it to still be the same same-origin path** (added
  2026-08-24, from review on the fix's own PR). Parsing the input alone leaves
  the mirror-image hole: `${origin}//evil.example` puts the host in the
  *pathname*, so `.origin` matches and the bare path emitted is
  `//evil.example`, which `redirect()` writes to `Location` verbatim and the
  browser reads as protocol-relative. The rule generalizes: **whatever you emit
  must re-parse into what you think it is** — a real path is already a fixed
  point, so nothing legitimate is refused and no denylist of spellings is
  needed. The companion lesson is about the test: the spec that appeared to
  cover it used a bogus token, so verification failed and the guarded line never
  ran. **If deleting the guard
  leaves its test green, the test does not cover the guard** — check by actually
  deleting it once. Reasoning: `docs/vendor-access.md` §6a; the testing half:
  `docs/playwright.md`.
- **In place — email confirmations (2026-08-25, issue #93)** — billed at the
  time as the last gate before Phase 4, though PR review opened another on the
  same endpoint (see the end of this bullet): `[auth.email] enable_confirmations = true`, a custom
  `supabase/templates/confirmation.html`, `signup` added to `/auth/confirm`'s
  `ALLOWED_TYPES`, `signUp()` returning a "check your email" state instead of
  redirecting, and `tests/e2e/mailbox.ts` reading the real mailbox. **No
  migration** — the seeded users already carry `email_confirmed_at`, so every
  existing login and all 94 pgTAP assertions were untouched. Five things worth
  carrying forward, all verified against the running stack rather than read in
  a doc. **The default template is unusable here**: `{{ .ConfirmationURL }}` is
  GoTrue's implicit flow, so the template points at our own `/auth/confirm`
  with `token_hash={{ .TokenHash }}&type=signup` — the same shape
  `buildInviteUrl()` builds. **`content_path` under
  `[auth.email.template.*]` resolves from the project root**, while
  `[auth.email.notification.*]` resolves from `supabase/`; the CLI's two
  commented examples differ for that reason and it is not a typo. **Editing a
  template while the stack runs silently stops all auth mail** (found 2026-08-28,
  reviewing this branch): each one is bind-mounted into Kong as a single *file*,
  so rewriting it on the host orphans the container's inode, Kong 404s, and
  GoTrue sends nothing — reported as a spec timing out on an empty mailbox, at
  the next container restart rather than at the edit. `supabase stop && start`
  rebinds it and `db reset` does not; CI is immune, since it never edits a
  template mid-run. Same shape as the `-x` trap: a local-only failure whose
  symptom names the wrong subsystem. **A duplicate
  signup still errors** — `user_already_exists` / 422 for a *confirmed*
  address, contrary to the docs' claim that the response becomes obfuscated;
  what changed is that re-submitting an *unconfirmed* address resends the link,
  which is why there is no separate "resend" control. And **`signIn` names the
  `email_not_confirmed` case on purpose**: GoTrue only returns it after the
  password checked out, so it is not an enumeration oracle, while the generic
  message would tell someone who simply has not opened their email that their
  password is wrong. The local mailbox is **mailpit** (`[local_smtp]`, port
  54324) even though its container is still named `supabase_inbucket_*`.
  Production SMTP is written into `config.toml` as Resend, **commented out** —
  deliberately not `enabled = false`. Enabling it in the file would route local
  dev and the CI mailbox spec through a real provider, so it is turned on for
  the hosted project only; but `enabled = false` is not the safe way to say that.
  `supabase config push` sends the whole auth block as one body, and the CLI maps
  a *present* smtp table with `enabled = false` to `smtp_host = ""` — the way you
  **disable** custom SMTP. Present-and-false would therefore let any later push
  wipe hosted SMTP alongside `mailer_autoconfirm = false`, i.e. mandatory
  confirmation mail sent through the built-in 2/hour mailer, so new accounts get
  no link and cannot sign in. Commented out, no `smtp_*` field is emitted at all.
  The general rule: **in `config.toml`, "off" and "absent" are the same locally
  and opposite remotely** — reach for absent unless you mean to push the off.
  **One 🟠 gate reopened here on 2026-08-28** (`docs/backlog.md`): `/auth/confirm`
  redeems on `GET`, so a mail gateway that prefetches links spends the one-time
  token — and takes the session cookie — before the recipient clicks. Reproduced
  with `curl`. It predates this work (`magiclink`/`invite` have redeemed on GET
  since 2026-08-03) and confirmations widened it to `signup`/`recovery`; it is
  invisible locally because mailpit follows nothing, and live as soon as real
  mail leaves Resend. Fix it before the public deploy, not after.
- **In place — verified account setup + password recovery (2026-08-26,
  `defb1bd`):** `src/app/(auth)/account-setup/` and
  `src/app/(auth)/forgot-password/` (a page + `useActionState` form each),
  `accountSetupSchema` / `passwordResetSchema` in `src/schemas/auth.ts`,
  `completeAccountSetup` + `requestPasswordReset` in
  `src/server/actions/auth.ts`, `supabase/templates/recovery.html` registered at
  `[auth.email.template.recovery]`, and `recovery` added to both `ALLOWED_TYPES`
  and `ACCOUNT_SETUP_TYPES` in `/auth/confirm`. `/login` links to
  `/forgot-password`. **No migration** — `profiles` already had the columns and
  the policies. Four things worth carrying forward.

  **`/signup` collects an email and nothing else.** The account it creates holds
  a random 32-byte password (`pendingAccountPassword()`) that is never returned,
  logged, or shown, so a pre-confirmation account is unreachable by password and
  every authoritative value is chosen at `/account-setup` by whoever proved they
  hold the mailbox. That is what makes GoTrue's ambiguous answer to a repeat
  signup safe to treat as one case: a resend for an unconfirmed address does not
  replace the first password or metadata, and here there is nothing
  authoritative for it to fail to replace.

  **Recovery re-enters the same boundary.** A `recovery` token redeems at
  `/auth/confirm` and lands on `/account-setup`, so losing the confirmation
  session is not a lockout — the second half of the reason `/signup` never sets
  a password.

  **The profile UPDATE is selected back, not written blind.** PostgREST answers
  an UPDATE that matched no row with 204 and a null error, so `profileError`
  alone cannot tell "written" from "no such row" — and that state is not
  hypothetical, since `getCurrentProfile()` already handles a live session whose
  profile row is missing. Missing it here would spend the one-time link, change
  the password anyway, and land the user on a dashboard saying their account is
  not configured, with no link left to retry.

  **`/account-setup` is a default destination, not an enforced one** — a 🟡 in
  `docs/backlog.md`. `/auth/confirm` reads `type` from the caller's own query
  string, and GoTrue does not bind a token to the type used to redeem it, so the
  holder can rewrite `type` and land on `next` instead. That is a bypassable
  guardrail, not an authorization bypass — it mints no session the holder could
  not already get, and `completeAccountSetup()` re-resolves the caller through
  `getVerifiedCaller()` regardless. Do not add a check that reads `type` and
  call it enforcement.
- **Not yet created:** `supabase/functions/`, `src/app/api/`. Neither is a gap
  to fill on its own — edge functions are Phase 5 (§6 SMS), and the only route
  handler that exists is `src/app/auth/confirm/route.ts`, which is deliberately
  *not* under `api/`. The SSO callback will be the next one. Do not scaffold
  either speculatively (§3/§8).
- When you add the next missing piece, follow §3/§5 exactly (e.g.
  `src/server/` as the trust boundary; schema changes only as new migrations
  with RLS alongside).

---

## 1. What this project is

**RealtyWorks** is an enterprise work interface for property managers and
landlords to run real-estate maintenance and repair operations end-to-end:
work orders, vendor coordination, documentation, and audit-ready records.

- Status: MVP / in active development
- Solo developer. No team. Optimize for low operational burden and a clear paper trail.
- License: Proprietary (see `LICENSE.md`).

### Timeline — we are on a clock

**Target: past MVP by early August 2026** — i.e. now. The §1 MVP scope needs to
be built, deployed, and usable, which is Phases 1–5 of §4, not just the
foundations. As of 2026-08-03 **Phases 1–3 are complete**: the toolkit and auth
loop landed 2026-07-27, the staff write path 2026-08-02, and the vendor half
2026-08-03, closing the vertical slice end to end. **Phase 4 (hosted deployment)
is the critical path now** — the largest remaining unknown, and the one thing
that turns a working local app into a usable one. Treat backlog follow-ups as
fill-in work around it, not as the main line.

**This does not lower the bar.** Rigor is what keeps a two-week push from
becoming a four-week one. RLS still ships in the same migration as its table,
the §2 trust rule still holds, CI still has to be green, migrations are still
the source of truth, and the audit trail is still a product feature. Do not
propose skipping these to save time — at this size they *are* the time savings.

What the deadline does change:
- **Scope discipline gets stricter, not looser.** The §1 non-goals and the
  Phase 6 deferral are now schedule protection. Flag creep early and fast.
- **Prefer the boring path** when two options both satisfy the requirement —
  §8's "smallest change" rule, applied harder. No speculative abstractions.
- **Don't stall on ambiguity.** State the assumption, pick the option that
  keeps Phase 7 mechanical, keep moving, and surface the call in your summary
  rather than blocking on a question.
- **Phase 5 breadth is the trim line** if something has to give. One polished
  vertical slice beats five half-wired features.

### MVP scope
- Properties & units (basic structure for organizing work)
- Work orders (create, assign, update status, priority, due dates)
- Activity trail (notes + timestamped history: who changed what)
- Attachments (photos, receipts, invoices, supporting docs)
- Vendor contacts (assign vendors + store contact details)
- Basic reporting (open work, aging work orders, cost summaries — minimal)

### Deferred — planned, but not for MVP
- **Accounting & rent tracking** (Phase 6, see §4) — rent roll, a payments/
  expense ledger, and cost rollups past the minimal cost summaries above.
  Deliberately *not* a non-goal: it is on the roadmap, just after the
  maintenance product is real. Actual rent **collection** (card/ACH rails, a
  payments provider, PCI surface) is a separate decision to make when Phase 6
  starts — tracking money is not the same as moving it.

Deferred means don't build it now. It also means don't design it out: prefer
schema and structure that leave room for a ledger later, without paying for it
today (no speculative tables, columns, or abstractions — §8).

### Explicit non-goals for MVP (do NOT build these)
- Tenant portal / messaging suite
- Full leasing pipeline
- Deep third-party integrations
- Mobile app / second surface (the responsive PWA is the mobile story — see §2)
- Dashboards beyond the minimal reporting above

Holding this scope line is the single biggest predictor of shipping. If a
request would expand into a non-goal — or pull a deferred item earlier than its
phase — flag it instead of building it.

---

## 2. Architecture: the core mental model

**There is NO backend service.** No Express/Fastify/Nest app, no separate API
service, no second deployment. Do not create a `/backend` folder or a standalone
server app.

**There IS backend logic.** It lives in exactly three places, never in the
client:

1. **Postgres (Supabase)** — RLS policies, check constraints, triggers,
   database functions. Most security and data-integrity logic belongs here.
2. **Next.js server actions & route handlers** — anything needing a secret,
   atomic orchestration, or trust the client shouldn't have.
3. **Supabase Edge Functions** — event-driven/async work, webhooks, scheduled
   jobs. Not expected to be needed early in MVP.

All three are serverless: they run on demand, then disappear. Nothing to keep
alive, nothing to SSH into.

### The non-negotiable trust rule
Anything that affects **security, money, or data integrity** MUST be enforced
server-side (RLS, server action, or DB constraint). The client may mirror logic
for UX, but is never the source of truth. Never trust a client-supplied role,
price, permission, or ownership check.

### Stack (decided — do not re-litigate)
- **BaaS:** Supabase (Postgres, Auth, Storage, Realtime, RLS). Open source and
  self-hostable.
- **Frontend:** Next.js (App Router) + TypeScript (strict) + Tailwind + shadcn/ui.
  One **responsive** web app — not a desktop site plus a separate mobile site.
  Layout adapts by breakpoint (dense tables for managers on desktop; stacked,
  touch-friendly views for vendors on phones). It becomes **PWA-installable**
  in Phase 5 (manifest + service worker added to the *same* app — never a second
  codebase, never an `m.` subdomain). No native app; this is the whole mobile
  story. Build responsive-first from day one so the PWA is a bolt-on, not a
  retrofit. Per-platform reality (Android vs iOS/iPadOS install + push), offline
  scope, and the open decisions: `docs/pwa.md`. The load-bearing constraint:
  **iOS web push only works for users who manually installed the app**, so SMS
  (§6) stays the default notification channel.
- **Server-side auth:** `@supabase/ssr`.
- **Hosting (current):** Vercel + Supabase Cloud, free tier. Live early.
- **Hosting (eventual, optional):** self-host. See §7.

---

## 3. Repo structure

Single Next.js app. No monorepo. Add folders only when there are 3+ real things
that belong in them — no speculative/empty folders.

```
realtyworks/
├── .github/
│   ├── ISSUE_TEMPLATE/             # bug · feature · chore issue forms + config.yml
│   ├── workflows/                  # ci.yml (main gate — see §0) · security.yml · osv-scanner.yml
│   ├── CODEOWNERS                  # * @Damilss — ownership record, NOT a required review
│   ├── dependabot.yml              # weekly npm + github-actions updates
│   └── pull_request_template.md    # self-review checklist (paper trail, not a gate)
├── .husky/                         # pre-commit (lint-staged + gitleaks), commit-msg (commitlint)
├── docs/                           # tooling.md · playwright.md · backlog.md · commit-messages.md · dependency-version-management.md · pwa.md · vendor-access.md · reports/
│   └── schema/                     # schema-brainstorming.md (the method) · my_schema_writeup.md (workflows → design → Phase 2 plan)
├── public/
├── src/
│   ├── app/                        # App Router
│   │   ├── (auth)/                 # route group: login, signup, account-setup, forgot-password
│   │   ├── (dashboard)/            # route group: authed app shell (work orders, vendors)
│   │   ├── auth/confirm/route.ts   # redeems a magic link → session cookies
│   │   ├── api/                    # route handlers (webhooks etc.) — not created yet
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                     # shadcn/ui primitives
│   │   └── features/               # composed, domain-specific components
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts           # browser client
│   │   │   ├── server.ts           # server client (cookies/SSR)
│   │   │   ├── admin.ts            # PRIVILEGED — secret key, bypasses RLS (§2)
│   │   │   ├── proxy.ts            # session refresh (called by src/proxy.ts)
│   │   │   └── env.ts              # validated NEXT_PUBLIC_SUPABASE_* config
│   │   ├── attachments.ts          # upload contract shared by browser + server
│   │   ├── database.types.ts       # GENERATED — never hand-edit
│   │   └── utils.ts
│   ├── server/                     # SERVER-ONLY — never imported by client
│   │   ├── actions/                # server actions ("use server")
│   │   └── queries/                # data-fetching helpers
│   ├── schemas/                    # zod schemas (shared client+server validation)
│   └── proxy.ts                    # Next 16 root convention (was middleware.ts)
├── supabase/
│   ├── migrations/                 # timestamped SQL — SOURCE OF TRUTH (RLS ships with its table)
│   ├── templates/                  # confirmation.html · recovery.html — both point at /auth/confirm
│   ├── functions/                  # edge functions (not created until needed)
│   ├── tests/                      # pgTAP RLS/guard suite — `pnpm exec supabase test db`
│   ├── seed.sql                    # 3 test users + sample data (db reset loads it)
│   └── config.toml
├── tests/
│   ├── unit/                       # vitest
│   └── e2e/                        # playwright
├── .env.example                    # committed — documents required vars
├── .env.local                      # gitignored — real secrets
├── .editorconfig                   # editor defaults (LF, 2-space, final newline) — not CI-enforced
├── .gitleaks.toml                  # secret-scanning config (default rules + allowlist)
├── .nvmrc                          # pinned Node, matches CI + package.json engines
├── commitlint.config.mjs
├── eslint.config.mjs
├── .prettierrc
├── next.config.ts
├── playwright.config.ts
├── tsconfig.json                   # strict: true
├── vitest.config.ts
├── package.json
├── pnpm-workspace.yaml             # pnpm settings (allowBuilds — reviewed install scripts)
├── CONTRIBUTING.md                 # setup · branch naming · commits · PR flow · schema rules
├── SECURITY.md                     # vulnerability reporting · gate coverage · triage runbook
└── README.md
```

### Structure rules
- `src/server/` is the trust boundary, with one deliberate seam.
  `src/server/queries/**` is server-only — every module opens with
  `import "server-only"`, so pulling one into client code fails the build.
  `src/server/actions/**` is the exception: client components are *meant* to
  import server actions, because `"use server"` swaps the body for an RPC
  reference and the implementation never ships. A lint rule blocking all of
  `@/server/*` would break the login form, so the one in `eslint.config.mjs`
  (`realtyworks/no-server-queries-in-client`, 2026-08-28, issue #29) is scoped
  to `queries/` and fires only inside a `"use client"` module. It allows
  `import type`, which is how all five client components that name a query
  module reach their types — those imports are erased before bundling. It
  matches by **resolving** the specifier rather than reading its text, so an
  alias and the relative path to the same file are one case, and it covers
  every node that pulls a module in: static import, dynamic `import()`,
  `export … from`, `export * from`, and `require()` (2026-09-01, PR review —
  a text-prefix check on `ImportDeclaration` alone missed all four of the
  others). It is not the boundary and never was: `server-only` fails
  `next build` for every one of these, verified against a real build. The rule
  buys that same failure earlier, with a message that names the boundary —
  which is worth nothing for a shape it does not match.
- `src/schemas/` (zod) is imported by both client and server: validate in both,
  trust only the server. Schemas do NOT live in `src/server/`.
- `database.types.ts` is generated via `supabase gen types typescript`.
  Regenerate whenever migrations change. Never hand-edit.
- No global `types/`, `services/`, `constants/`, `config/`, or `hooks/`
  junk-drawer folders. Co-locate or generate instead.

---

## 4. Build phases — current order of work

Foundations before features. Do not jump ahead to feature breadth. Phases 1–5
are the ~2-week MVP push (§1 *Timeline*); Phases 6–7 are explicitly after it.

**Phase 1 — Foundations**
Repo + tooling + green CI on a near-empty Next.js app. TS strict, ESLint +
Prettier, Husky hooks (lint-staged + gitleaks, commitlint), conventional
commits, branch protection on `main`, Vitest + Playwright installed (mostly
empty), GitHub Actions running lint + format check + typecheck + test +
build + dependency audit per PR plus a parallel Playwright smoke test, plus
gitleaks secret scanning and a weekly osv-scanner CVE scan. Pipeline green
before features.

**Phase 2 — Supabase local + schema + RLS**
`supabase init`, `supabase start` (Docker). Schema as numbered migrations only —
never click-ops in the dashboard. RLS policy written in the SAME migration as
the table it protects. Seed file with 3 test users (landlord, manager, vendor),
sample properties, a vendor, work orders in varied states. One command resets
local to a known-good state.

**Phase 3 — One vertical slice** *(complete 2026-08-03)*
Exactly one full path, nothing else: manager logs in → creates work order →
assigns vendor → vendor logs in → vendor updates status + uploads photo →
activity log reflects all of it → manager sees it. Exercised auth, RLS,
mutations, storage, and the activity trail before the pattern gets duplicated —
which was the point of doing it as one path instead of five half-features.
Landed in three parts: the toolkit + auth loop (2026-07-27), the staff write
path (2026-08-02), and the vendor half (2026-08-03). `tests/e2e/` drives the
whole thing against a seeded stack, including redeeming a real magic link in a
second browser context.

**Phase 4 — Hosted deployment** *(next)*
Vercel + Supabase Cloud free tier. PR preview deploys, Sentry wired, prod
deploys only from `main`.

**Phase 5 — Breadth**
Copy the vertical-slice pattern outward: more pages, features, minimal reports.
SMS/notifications added here (see §6) — not earlier. The PWA install layer
(manifest + service worker) also lands here — a bolt-on to the already-responsive
app, per §2. Read `docs/pwa.md` first (platform matrix + open decisions), then the
Next.js 16 manifest/metadata + service-worker guides in
`node_modules/next/dist/docs/`; the APIs have breaking changes.

**Phase 6 — Accounting & rent tracking (late stage)**
Only once Phase 5 breadth is real and in use. Rent roll, a payments/expense
ledger, and cost rollups on top of the existing work-order costs. Money is a §2
trust-rule maximum: amounts, balances, and postings are computed and enforced
server-side (DB constraints + server actions), never client-side. Ledger rows
are append-only with an audit trail — correct by reversing entries, never by
mutating history. Whether to add rent **collection** (a payments provider, card/
ACH rails, and the PCI surface that comes with them) is decided at the start of
this phase, not assumed by it.

**Phase 7 — Self-host migration (eventual, optional)**
See §7. Should be a weekend job, not a rewrite, if §5/§7 rules are followed.
(Was "Phase 6" before accounting was promoted from a non-goal to Phase 6.)

---

## 5. Engineering conventions

- **Migrations are the source of truth.** All schema/RLS changes via numbered
  migration files. No dashboard click-ops, ever.
- **Forward-only past `main`.** Since 2026-07-21 the migration set is merged to
  `main`. A migration that has reached `main` is immutable — fix or change it
  with a **new** timestamped migration, never by editing the merged file.
  (Editing is only ever an option for a migration still unmerged on a local
  branch, and only before anyone else's tree has applied it.)
- **RLS from day one.** Every table ships with its RLS policy in the same
  migration. Retrofitting RLS is not allowed.
- **Everything via env vars.** No hardcoded URLs, keys, or config. `.env.example`
  documents every required var; `.env.local` holds real values and is gitignored.
- **Stay within self-hostable Supabase features.** Avoid cloud-only features so
  Phase 7 stays mechanical.
- **No Vercel lock-in beyond Next.js itself.** `next start` must work anywhere.
  Keep a working Dockerfile for the app so self-host is `docker run` away.
- **TypeScript strict.** No `any` without a written reason. Generated DB types
  are the contract.
- **Validate twice, trust once.** Zod on client (UX) and server (trust). Server
  is authoritative.
- **Conventional commits**, enforced by commitlint. Branch protection on `main`
  requires green CI + review (yes, even solo — it's the paper trail).
- **Test what matters, not the framework.** Vitest on business logic (work-order
  state transitions, permission checks). Playwright on the one or two critical
  E2E happy paths. Not chasing coverage %.
- **A test that passes with the code deleted is decoration.** Twice now a green
  test has covered nothing: `z.uuid()` (fixtures the real database would never
  produce) and the `/auth/confirm` redirect guard (a bogus token, so the guarded
  line never ran). For anything security-shaped, **delete the thing under test
  once and watch the test fail** — it takes a minute and it is the only proof
  the fixture reaches the code. §0 has both cases.
- **Audit trail is a product feature, not a nice-to-have.** "Who changed what,
  when" and "was the vendor notified" must be answerable from our DB.

---

## 6. SMS / notifications (Phase 5 — do not build earlier)

SMS is backend logic. The provider key never reaches the browser.

- **User-initiated send** ("clicked Assign vendor") → Next.js **server action**.
- **Data-event send** ("status reached urgent") → DB trigger → **edge function**.
- **Scheduled** ("8am digest") → edge function on cron.
- **Provider callback** (delivery status webhook) → edge function / route handler.

Required from the first SMS:
- `messages` table logging every send (to, body, trigger, provider SID, status).
- `notification_preferences` (opt-out, channel, number) before real users exist.
- TCPA / 10DLC awareness: store consent w/ timestamp, honor STOP, register 10DLC
  before real customer volume.
- **Provider spending cap set in the provider console before message #1.**
- Idempotency: check `messages` or use an idempotency key to prevent dup sends
  on retry.

Default provider: Twilio (revisit only if volume justifies). Do not over-design
the notification system before knowing which events actually matter.

---

## 7. Self-hosting (eventual, optional)

Self-hosting is software-tractable here (Supabase publishes a maintained Docker
Compose stack; the app is `next build && next start` in a container). The hard
part is **operations**, identical regardless of stack:

- Backups: automated, off-site, **tested by actually restoring**.
- Patching: OS, Docker, Supabase upgrades, Next.js — never stops.
- Monitoring + alerting that actually pages, not just a dashboard.
- TLS (Caddy auto-renew), reverse proxy + firewall, secret management.
- Power (UPS) + internet resilience; the "2am, it's down, only you" problem.

**Uptime reality:** 100% is not achievable on any infrastructure. Single home
box ≈ 99% (a few days/yr). Better requires real redundancy. Design for graceful
degradation + fast recovery, never for "100%."

**Preferred tiers (mental model):**
1. Managed (Vercel + Supabase Cloud) — current. Likely the right long-term call.
2. Self-host on a VPS (e.g. Hetzner) — practical self-host; provider handles
   power/network/hardware. Recommended over home hardware if cost allows.
3. Self-host on home hardware — cheapest in $, most expensive in time/resilience.

Nothing in Phases 1–6 changes for self-host: the §5 rules already make Phase 7
mechanical. Re-decide hosting on the merits when the time comes, not by default.

---

## 8. Working agreements for Claude Code

- Do not introduce a backend service, a `/backend` folder, or a second
  deployable.
- Do not expand into §1 non-goals; flag scope creep instead. §1's *deferred*
  items (accounting / rent tracking) are the same answer before their phase —
  "not yet," not "never."
- Do not put security/money/integrity logic client-side.
- Do not click-ops schema; produce migration files with RLS in the same file.
- Do not hand-edit `database.types.ts`; regenerate it.
- Respect the phase order. If asked to build Phase N+1 work while Phase N is
  unfinished, say so and confirm before proceeding.
- Prefer the smallest change that satisfies the requirement. No speculative
  folders, abstractions, or dependencies.
- When a decision is ambiguous, prefer the option that keeps Phase 7 (self-host)
  mechanical and operational burden low.
- We are on a deadline (§1 *Timeline*). Treat it as a reason to cut scope and
  skip gold-plating — never as a reason to cut rigor, tests, RLS, or CI.
