# RealtyWorks

Modern solutions for property management.

**RealtyWorks** is an enterprise work interface for property managers and
landlords to run real-estate maintenance and repair operations end-to-end:
work orders, vendor coordination, documentation, and audit-ready records.

> **Status:** MVP / in active development — **Phases 1–3 complete** as of
> 2026-08-03 (merged to `main` 2026-08-04). The vertical slice runs end to end:
> a manager signs in, creates a work order, assigns a vendor and mints a
> magic-link invite; the vendor opens the link, gets a real session, updates
> status and uploads a photo; the activity trail records all of it.
> **Phase 4 (hosted deployment) is next and is the critical path.**
> **License:** Proprietary (see [`LICENSE.md`](LICENSE.md))

---

## What it does

RealtyWorks focuses on the operational layer of property management — getting
repairs done and keeping clean records.

Typical workflow:

1. Property/Unit exists in the system
2. A maintenance issue becomes a **work order**
3. Work order is assigned internally or to a vendor
4. Work is tracked through statuses with photos, notes, invoices
5. Everything stays documented for accountability and reporting

### MVP scope

- **Properties & units** — basic structure for organizing work
- **Work orders** — create, assign, update status, priority, due dates
- **Activity trail** — notes + timestamped history (who changed what)
- **Attachments** — photos, receipts, invoices, supporting docs
- **Vendor contacts** — assign vendors + store contact details
- **Basic reporting** — open work, aging work orders, cost summaries (minimal)

### Deferred (planned, not MVP)

**Accounting & rent tracking** — rent roll, payments/expense ledger, cost
rollups. On the roadmap as Phase 6, after the maintenance product is real.
Whether it includes rent *collection* (payment rails) is decided then.

### Non-goals (for MVP)

Tenant portal / messaging suite · full leasing pipeline · deep third-party
integrations · mobile app / second surface · dashboards beyond the minimal
reporting above.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | [Next.js](https://nextjs.org) 16 (App Router) |
| Language | TypeScript (strict) on React 19 |
| Package manager | **pnpm** `11.13.1` (pinned via `packageManager`) |
| Runtime | Node **24** (pinned in `.nvmrc`, matched by CI; `engines.node` warns on a wrong major) |
| Unit tests | Vitest |
| E2E tests | Playwright (the whole vertical slice runs in CI against a real seeded stack — see [docs/playwright.md](docs/playwright.md)) |
| Database | Supabase (Postgres 17, Auth, Storage, RLS) — local stack via the pinned `supabase` CLI; schema lives in `supabase/migrations/` (RLS ships with each table), pgTAP tests in `supabase/tests/` |
| Lint / format | ESLint (`next/core-web-vitals` + TypeScript) · Prettier · `.editorconfig` (editor-side, not gated) |
| Git hygiene | Husky + lint-staged · commitlint (conventional commits) · gitleaks |

Server-side auth is `@supabase/ssr`: browser and per-request server clients in
`src/lib/supabase/`, plus session refresh in `src/proxy.ts` (Next.js 16 renamed
the root `middleware` convention to `proxy` — it is **not** `middleware.ts`).
Both clients use the publishable key and the caller's session, so RLS applies
identically on the server and in the browser; neither is privileged. There is
one privileged client, `src/lib/supabase/admin.ts`, and it exists only for the
two writes that have no client grant by design — attachment metadata and
`vendors.profile_id` — plus `auth.admin` for the vendor invite. It reads
`SUPABASE_SECRET_KEY` lazily, bypasses RLS, and is always reached *after* the
caller's access has been established with their own session.

Phase 3 landed in three parts: Tailwind CSS + shadcn/ui (zinc) and the auth loop
on 2026-07-27, the staff write path on 2026-08-02, and the vendor half on
2026-08-03 — zod schemas in `src/schemas/`, the server-only data-access layer
and server actions in `src/server/`, the `(auth)` / `(dashboard)` route groups,
and `src/app/auth/confirm/route.ts`, which redeems a magic link into cookie
session. Email confirmations followed on 2026-08-25 (the last gate before
Phase 4), reusing that same route handler for the signup link. Planned for a
later phase (decided, not yet installed): Sentry (Phase 4). There is **no separate backend service** — backend logic lives in
Postgres (RLS/constraints), Next.js server actions/route handlers, and Supabase
Edge Functions. See `CLAUDE.md` §2.

---

## Getting started

### Prerequisites

- **Node 24** — pinned in `.nvmrc`. `nvm use` reads it; any Node 24 also works
  if you manage versions another way (fnm, asdf, Volta, or a manual install).
  `package.json` declares `engines.node` (`>=24 <25`) as a second signal: a
  wrong major prints an `Unsupported engine` warning on `pnpm install` — it
  warns, it does not stop the install.
- **pnpm 11.13.1** — easiest via [corepack](https://nodejs.org/api/corepack.html)
  (`corepack enable`), which reads the `packageManager` field and activates the
  pinned version on first use; **do not use npm**. The first `pnpm` command may
  download pnpm — that's expected, not an error.
- **git** — to clone and for the commit hooks.
- **Docker** — required for the local Supabase stack (Postgres, Auth, Storage).
  Docker Desktop or OrbStack; the daemon must be **running**, not just installed.
- **gitleaks** *(optional but recommended)* — the pre-commit hook runs a local
  secret scan when it's installed, and skips it with a warning when it isn't
  (CI scans regardless): `brew install gitleaks`

### Install & run

```bash
git clone <repo-url> && cd realtyworks
nvm use               # Node 24 (or ensure Node 24 another way)
corepack enable       # activates pnpm 11.13.1 from package.json
pnpm install          # installs deps + the git hooks (husky) via "prepare"
```

**Stop here — the app needs environment variables before it will serve a single
page.** `src/proxy.ts` refreshes the Supabase session on *every* request, and
`src/lib/supabase/env.ts` throws when its config is missing. Running `pnpm dev`
without a `.env.local` returns **500 on every route**, including `/login`, so
there is no page you can reach to work around it.

Boot the local database, then write `.env.local` from the running stack:

```bash
pnpm exec supabase start      # boot the local stack (first run pulls images)

pnpm exec supabase status -o env \
  --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
  --override-name auth.publishable_key=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  | grep -E '^(NEXT_PUBLIC_|SECRET_KEY=)' \
  | sed 's/^SECRET_KEY=/SUPABASE_SECRET_KEY=/' > .env.local
```

That writes exactly the three variables the app reads — the same command the CI
`e2e` job runs. **The `grep` is load-bearing, and it is an allowlist rather than
a filter:** `-o env` also prints `SERVICE_ROLE_KEY`, `JWT_SECRET`, and `DB_URL`,
none of which belong in the app's env file. The CLI quotes its values; Next.js
strips the quotes when it loads the file.

The `sed` renames `SECRET_KEY` to the `SUPABASE_SECRET_KEY` that
`src/lib/supabase/admin.ts` reads (`supabase status` documents no override for
this one). **That variable is deliberately not `NEXT_PUBLIC_`** — it bypasses
RLS completely, and `next build` inlines every `NEXT_PUBLIC_*` value into the
browser bundle. The app boots and serves without it; only the vendor invite and
the attachment upload need it, so they are what fails if it is missing.

> The redirect **overwrites** `.env.local`. If you've customized it, back it up
> first — or take the manual route instead: `cp .env.example .env.local`, then
> fill in the three values from `pnpm exec supabase status`.
> [`.env.example`](.env.example) is committed and documents all of them.

Then run the app:

```bash
pnpm dev              # http://127.0.0.1:3000
```

`/` redirects to `/dashboard`, which redirects to **`/login`** when there is no
session. **`/signup`** is open self-registration (name, email, password,
phone), and it takes two steps: the account cannot sign in until the emailed
confirmation link is followed (`[auth.email] enable_confirmations`). Locally
that mail goes to **mailpit** at <http://127.0.0.1:54324>, not to a real inbox.
Even once confirmed, a self-registered account is deliberately inert: it lands
as an unlinked `vendor`, so RLS returns nothing until staff link it to a
`vendors` row, and the dashboard says as much instead of rendering an empty
table.

Prefer `127.0.0.1` over `localhost` for the dev server. It is what
`[auth] site_url` in `supabase/config.toml` and the Playwright `baseURL` both
use, and cookies are scoped per host — mixing the two hostnames strands a
session on whichever one issued it.

Other local-database commands:

```bash
pnpm exec supabase db reset   # rebuild from migrations + seed (known-good state)
pnpm exec supabase test db    # pgTAP RLS/guard suite
pnpm exec supabase stop       # shut the stack down
```

Seeded logins (landlord, manager, vendor) come from `supabase/seed.sql`, which
`db reset` loads — `<role>@realtyworks.test` / `password123`. Signing in as each
is the fastest way to see RLS working: the manager sees all five seeded work
orders, the vendor only the three assigned to them. To walk the rest of the
slice, sign in as the manager, open a work order, assign a vendor, press
**Create sign-in link**, **Copy** it, and open it in a private window — that is
the vendor's whole login path (`docs/vendor-access.md`).

### Additional checkouts (git worktrees)

`node_modules/` and `.husky/_/` are gitignored generated state, so they never
travel with a checkout. A new `git worktree` — or a fresh clone — starts without
them, and **git treats a missing hooks directory as "no hooks configured."** It
skips pre-commit and commit-msg silently: no warning, zero exit code, commits
succeed exactly as normal while lint-staged, gitleaks, and commitlint do
nothing at all.

`pnpm install` installs the hooks via the `prepare` script — but only when it
actually installs something. If `node_modules/` is already populated (say by an
earlier `pnpm update`, which does *not* run `prepare`), install short-circuits
with `Already up to date` and the hooks are never created. That combination is
easy to hit and gives no signal.

So in a new worktree or clone, run both:

```bash
pnpm install       # dependencies
pnpm run prepare   # git hooks — cheap, idempotent, safe to re-run anytime
```

To check an existing checkout:

```bash
ls .husky/_/commit-msg >/dev/null 2>&1 \
  && echo "hooks installed" \
  || echo "HOOKS MISSING — run: pnpm run prepare"
```

CI is unaffected either way — the workflows run the checks directly rather than
through git hooks. A missing hook costs you fast local feedback, not the gate.

### Verify your setup

Run the full check suite once to confirm the toolchain is wired — this is the
same gauntlet CI runs, and the one to run locally before every push:

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm audit --audit-level=high
```

All green means you're good to go.

### Run the tests

```bash
pnpm test                              # unit (Vitest), one-shot
pnpm exec playwright install chromium  # one-time per machine: download the E2E browser
pnpm exec supabase db reset            # E2E needs the seeded known-good state
pnpm test:e2e                          # E2E (Playwright boots the dev server itself)
```

`pnpm test:e2e` boots the app via `pnpm dev`, so it needs the same `.env.local`
as the app — without it every request 500s and the run fails on the `webServer`
timeout, not on an assertion. The specs sign in as the seeded users and assert
against the seeded fixtures **by identity, not by row count**, so the variables
must point at a **running, freshly reset** stack; placeholders no longer work.
The vendor-loop specs also need `SUPABASE_SECRET_KEY`, since inviting a vendor
is a service-role write. The signup spec needs the **mail container** running
(it reads the confirmation link out of mailpit), which `supabase start` gives
you by default. Most specs write, and the signup and invite paths
create real `auth.users` rows that nothing cleans up, so a second run without
`db reset` fails on "account already exists". CI's `e2e` job does exactly this —
boots a stack, resets it, writes `.env.local` from `supabase status` — see
[docs/playwright.md](docs/playwright.md).

Full detail — what each runner collects and how they stay out of each other's
way — is in [Testing](#testing) below and [docs/playwright.md](docs/playwright.md).

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server at http://127.0.0.1:3000 |
| `pnpm build` | Production build (`next build`) |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier write / check (CI gate) |
| `pnpm typecheck` | `tsc --noEmit` (strict) |
| `pnpm test` | Vitest, one-shot (`--passWithNoTests`) |
| `pnpm test:e2e` | Playwright E2E (boots the dev server itself) |

---

## Testing

- **Unit (Vitest)** — collects `src/**/*.{test,spec}.{ts,tsx}` and
  `tests/unit/**/*.{test,spec}.{ts,tsx}` only. Run one file with
  `pnpm exec vitest run src/path/to/file.test.ts`, or filter by name with
  `pnpm exec vitest run -t "name of test"`.
- **E2E (Playwright)** — owns `tests/e2e/`: the boot smoke test plus the three
  slice suites — `auth.spec.ts` (sign in as each seeded role, self-register and
  confirm by following a link read out of the real mailbox, wrong password,
  signed-out redirect, sign out), `work-orders.spec.ts` (create,
  assign, note, the 404 and vendor-refusal paths), and `vendor-loop.spec.ts`
  (invite → redeem a real magic link in a second browser context → status +
  photo, plus single-use, the stale link clearing from the page on
  reassignment, and `/auth/confirm` refusing a hostile post-login destination
  while still deep-linking to the job). Requires a one-time browser download:
  `pnpm exec playwright install chromium`, and a seeded local stack. All of them
  run in CI (the parallel `e2e` job in `.github/workflows/ci.yml`), which boots
  its own Supabase stack — so CI proves the app runs *and* that RLS holds
  through a real session, not just that it compiles. Full guide:
  [docs/playwright.md](docs/playwright.md).

The two runners never collect each other's files.

---

## Quality gates

Everything below must pass before code lands on `main`.

### Local git hooks (Husky)

- **pre-commit** — `lint-staged` (ESLint `--fix` + Prettier on staged files),
  then a gitleaks scan of the staged changes (best-effort; skipped if gitleaks
  isn't installed).
- **commit-msg** — commitlint enforces
  [conventional commits](https://www.conventionalcommits.org). Allowed types:
  `build chore ci deps docs feat fix perf refactor revert style test wip`
  (`deps` is a house addition for dependency bumps and `wip` for local
  work-in-progress checkpoints; the old `CI/CD` type from early history is
  retired in favor of `ci`).

Both hooks **fail open**: if `.husky/_/` is missing, git skips them without
warning and every commit passes unchecked. Common in a fresh worktree or clone —
see [Additional checkouts](#additional-checkouts-git-worktrees).

### CI — `.github/workflows/ci.yml` (PRs + pushes to `main`)

Three jobs run in parallel. `verify` runs **lint → format check → typecheck →
unit tests → build → audit**; every check step after the first uses
`if: ${{ !cancelled() }}`, so a single run reports *every* failure rather than
stopping at the first. pnpm's store and the Next.js build cache are cached
between runs. `e2e` boots a local Supabase stack, resets it to the seeded state,
then boots the app and runs the Playwright vertical-slice specs against it —
auth loop, staff write path, and vendor loop. (The job is still *named* "E2E
(Playwright auth loop)" from when that was all it ran; renaming it would break
any branch-protection rule that matches the check by name.) `db`
runs the pgTAP suite from `supabase/tests/`, so an RLS or write-guard regression
fails CI rather than merging green — on a **deliberately smaller stack**, three
containers to `e2e`'s eight, because pg_prove talks to Postgres directly and
never makes an HTTP request (and, unlike `e2e`, has no mailbox to read). The two `-x` exclusion lists are not the same list
and must not be synced. Both jobs pull Docker images cold, so they, not
`verify`, set the wall-clock. Details: [docs/tooling.md](docs/tooling.md).

The final step, `pnpm audit --audit-level=high`, is a blocking dependency
vulnerability gate. Any high/critical advisory fails CI; moderate/low
advisories stay below the audit threshold. The flip from advisory-only to
blocking was deliberate and manual — see [docs/tooling.md](docs/tooling.md)
for the rationale and cleared advisory details.

### Security scanning

- **gitleaks** (`.github/workflows/security.yml`) — secret scan of the full
  git history on every PR and push to `main`/`dev`. Config: `.gitleaks.toml`
  (default rules + an allowlist for `pnpm-lock.yaml` false positives).
- **Semgrep OSS** (`.github/workflows/security.yml`) — SAST scan on every PR
  and push to `main`/`dev` (`p/typescript`, `p/react`, `p/nextjs`,
  `p/owasp-top-ten`). Blocking; findings render as PR annotations.
- **osv-scanner** (`.github/workflows/osv-scanner.yml`) — weekly lockfile CVE
  scan (Mondays 12:30 UTC), plus a scan on every PR into `main` and manual
  `workflow_dispatch`.
- **Dependabot** — weekly version updates for npm packages and GitHub Actions.

Details, decisions, and known issues: [docs/tooling.md](docs/tooling.md).

---

## Repository layout

```
realtyworks/
├── .github/
│   ├── ISSUE_TEMPLATE/     # bug.yml · feature.yml · chore.yml · config.yml (issue forms)
│   ├── workflows/          # ci.yml · security.yml (gitleaks + semgrep) · osv-scanner.yml
│   ├── CODEOWNERS          # * @Damilss — ownership record, not a required review
│   ├── dependabot.yml
│   └── pull_request_template.md
├── .husky/                 # pre-commit (lint-staged + gitleaks) · commit-msg (commitlint)
├── docs/                   # project docs (see index below) · docs/reports/ = roadbump postmortems
├── public/
├── src/
│   ├── app/                # Next.js App Router · globals.css carries the shadcn zinc theme
│   │   ├── (auth)/         # login · signup (signed-out route group)
│   │   ├── (dashboard)/    # authed shell · /dashboard · /work-orders/{new,[id]} · /vendors
│   │   └── auth/confirm/   # route handler: redeems a magic link or signup link → session cookies
│   ├── components/
│   │   ├── features/       # composed, domain-specific components (work-orders/)
│   │   └── ui/             # shadcn/ui primitives (button, input, label, card, table, badge, textarea, native-select, form-feedback)
│   ├── lib/
│   │   ├── supabase/       # client.ts (browser) · server.ts (per-request) · admin.ts (PRIVILEGED, bypasses RLS) · proxy.ts (session refresh) · env.ts (validated config)
│   │   ├── attachments.ts  # upload contract shared by browser + server
│   │   ├── utils.ts        # cn() class-name helper (clsx + tailwind-merge)
│   │   └── database.types.ts   # GENERATED from the schema — never hand-edited
│   ├── schemas/            # zod schemas shared by client + server (auth · work-order · vendor)
│   ├── server/             # actions/ (server actions) · queries/ (server-only DAL)
│   └── proxy.ts            # Next.js 16 root convention (renamed from middleware.ts)
├── supabase/
│   ├── migrations/         # timestamped SQL — SOURCE OF TRUTH (RLS ships with its table)
│   ├── tests/              # pgTAP RLS/write-guard suite
│   ├── templates/          # confirmation.html — points signup mail at /auth/confirm
│   ├── seed.sql            # 3 login-able users + sample data
│   └── config.toml
├── tests/
│   ├── unit/               # Vitest (DOM harness)
│   └── e2e/                # Playwright specs (smoke · auth · work-orders · vendor-loop)
├── .env.example            # committed template — documents every required var
├── .editorconfig           # editor defaults (LF, 2-space, final newline)
├── .gitleaks.toml          # secret-scanning config
├── .nvmrc                  # Node 24 (with package.json engines)
├── commitlint.config.mjs   # conventional-commit rules
├── playwright.config.ts
├── vitest.config.ts
├── CONTRIBUTING.md         # setup · branch naming · commits · PR & merge flow
├── SECURITY.md             # vulnerability reporting · what the gates cover · triage
└── CLAUDE.md               # engineering source of truth (architecture, phases, rules)
```

The rest of the target structure (`src/app/api/`, `supabase/functions/`) is
specified in `CLAUDE.md` §3 and gets created when something needs it — not
speculatively. Edge functions are Phase 5 (SMS), and the only route handler that
exists lives at `src/app/auth/confirm/route.ts` rather than under `api/`,
because it is an auth endpoint. (`src/components/`, `src/schemas/`, and
`src/server/` all arrived with the UI toolkit and auth loop on 2026-07-27.)

`src/server/queries/` is server-only and says so in code (`import
"server-only"`, which fails the build if client code imports it).
`src/server/actions/` is the deliberate exception — client components import
server actions, and `"use server"` keeps the implementation out of the bundle.

## Documentation index

| Doc | What's in it |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Source of truth: architecture, phases, conventions, working agreements |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, branch naming, commits, PR & merge flow, schema rules |
| [`SECURITY.md`](SECURITY.md) | Reporting a vulnerability, what the gates cover, secret-leak runbook |
| [`docs/tooling.md`](docs/tooling.md) | CI, security scanning, git hooks — how it works, decisions, known issues |
| [`docs/playwright.md`](docs/playwright.md) | E2E testing: install, run, troubleshoot |
| [`docs/backlog.md`](docs/backlog.md) | Ranked foundation & development backlog (issue-ready blocks) |
| [`docs/vendor-access.md`](docs/vendor-access.md) | How vendors get in: magic links, not accounts — and what was settled shipping it |
| [`docs/schema/schema-brainstorming.md`](docs/schema/schema-brainstorming.md) | Schema design process: workflows → tables → security/RLS → Zod (Phase 2+) |
| [`docs/schema/my_schema_writeup.md`](docs/schema/my_schema_writeup.md) | The schema as built: workflows → design decisions → the open-signup reversal |
| [`docs/pwa.md`](docs/pwa.md) | PWA: per-platform install/push reality (Android vs iOS/iPadOS), offline scope (Phase 5) |
| [`docs/commit-messages.md`](docs/commit-messages.md) | Commit message cheat sheet — format + allowed types (commitlint) |
| [`docs/dependency-version-management.md`](docs/dependency-version-management.md) | Field manual for dependency/version debugging |
| [`docs/reports/`](docs/reports/) | Roadbump reports — postmortems of notable dependency/CI/build snags |

---

## Roadmap (build phases)

| Phase | Scope | Status |
| --- | --- | --- |
| 1 — Foundations | Tooling, CI, hooks, security scanning on a near-empty app | ✅ Done |
| 2 — Supabase | Local stack, migrations (RLS from day one), seed data, `@supabase/ssr` clients | ✅ Done — schema, RLS, seed, and pgTAP suite merged to `main` 2026-07-21; clients + session-refresh proxy landed on top |
| 3 — Vertical slice | One full path: manager → work order → vendor → activity log | ✅ Done — in three parts: UI toolkit + auth loop 2026-07-27, staff write path 2026-08-02, vendor half 2026-08-03; merged to `main` 2026-08-04 (PR #94) |
| 4 — Hosted deploy | Vercel + Supabase Cloud, PR previews, Sentry | 🚧 Next — the critical path |
| 5 — Breadth | More features, minimal reports, SMS/notifications, PWA install layer | Planned |
| 6 — Accounting & rent tracking | Rent roll, ledger, cost rollups — server-side, append-only | Late stage |
| 7 — Self-host (optional) | Docker Compose migration — kept mechanical by design | Eventual |

Full definitions in `CLAUDE.md` §4.

---

## Repo conventions

- This repository is **not open source**. Do not redistribute or deploy
  outside approved environments.
- Production data is never used in local/dev environments.
- All changes reach `main` via PR with green CI (paper trail, even solo).
- Conventional commits, enforced by commitlint.
- Branch naming, the `feature → dev → main` flow, and the PR checklist live in
  [CONTRIBUTING.md](CONTRIBUTING.md); vulnerability reporting in
  [SECURITY.md](SECURITY.md).
