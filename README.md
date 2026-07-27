# RealtyWorks

Modern solutions for property management.

**RealtyWorks** is an enterprise work interface for property managers and
landlords to run real-estate maintenance and repair operations end-to-end:
work orders, vendor coordination, documentation, and audit-ready records.

> **Status:** MVP / in active development — Phases 1–2 complete;
> **Phase 3 (the vertical slice) is in progress** (as of 2026-07-27). The
> Tailwind + shadcn/ui toolkit is installed; the auth loop (login → session-gated
> shell) is the current focus.
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
| Runtime | Node **24** (pinned in `.nvmrc`, matched by CI) |
| Unit tests | Vitest |
| E2E tests | Playwright (smoke test also runs in CI — see [docs/playwright.md](docs/playwright.md)) |
| Database | Supabase (Postgres 17, Auth, Storage, RLS) — local stack via the pinned `supabase` CLI; schema lives in `supabase/migrations/` (RLS ships with each table), pgTAP tests in `supabase/tests/` |
| Lint / format | ESLint (`next/core-web-vitals` + TypeScript) · Prettier |
| Git hygiene | Husky + lint-staged · commitlint (conventional commits) · gitleaks |

Server-side auth is `@supabase/ssr`: browser and per-request server clients in
`src/lib/supabase/`, plus session refresh in `src/proxy.ts` (Next.js 16 renamed
the root `middleware` convention to `proxy` — it is **not** `middleware.ts`).
Both clients use the publishable key and the caller's session, so RLS applies
identically on the server and in the browser; neither is privileged.

Tailwind CSS + shadcn/ui (zinc) landed 2026-07-27 (Phase 3). Planned for a
later phase (decided, not yet installed): Sentry (Phase 4). There is **no
separate backend service** — backend logic
lives in Postgres (RLS/constraints), Next.js server actions/route handlers, and
Supabase Edge Functions. See `CLAUDE.md` §2.

---

## Getting started

### Prerequisites

- **Node 24** — pinned in `.nvmrc`. `nvm use` reads it; any Node 24 also works
  if you manage versions another way (fnm, asdf, Volta, or a manual install).
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
  | grep '^NEXT_PUBLIC_' > .env.local
```

That writes exactly the two variables the app reads. **The `grep` is
load-bearing:** `-o env` also prints `SERVICE_ROLE_KEY`, `SECRET_KEY`,
`JWT_SECRET`, and `DB_URL`, and none of those belong in the app's env file —
only the two `NEXT_PUBLIC_` values are safe to ship to the browser. The CLI
quotes its values; Next.js strips the quotes when it loads the file.

> The redirect **overwrites** `.env.local`. If you've customized it, back it up
> first — or take the manual route instead: `cp .env.example .env.local`, then
> fill in the two values from `pnpm exec supabase status`.
> [`.env.example`](.env.example) is committed and documents both.

Then run the app:

```bash
pnpm dev              # http://localhost:3000
```

Other local-database commands:

```bash
pnpm exec supabase db reset   # rebuild from migrations + seed (known-good state)
pnpm exec supabase test db    # pgTAP RLS/guard suite
pnpm exec supabase stop       # shut the stack down
```

Seeded logins (landlord, manager, vendor) come from `supabase/seed.sql`, which
`db reset` loads.

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
pnpm test:e2e                          # E2E (Playwright boots the dev server itself)
```

`pnpm test:e2e` boots the app via `pnpm dev`, so it needs the same `.env.local`
as the app — without it every request 500s and the run fails on the
`webServer` timeout, not on an assertion. The variables must be *present*; they
don't have to point at a live stack, since with no session cookie the refresh
short-circuits before any network call. (That's why CI's `e2e` job sets
placeholders and runs no Supabase — see `.github/workflows/ci.yml`.)

Full detail — what each runner collects and how they stay out of each other's
way — is in [Testing](#testing) below and [docs/playwright.md](docs/playwright.md).

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server at http://localhost:3000 |
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
- **E2E (Playwright)** — owns `tests/e2e/`; currently a single smoke test.
  Requires a one-time browser download:
  `pnpm exec playwright install chromium`. The smoke test **does** run in CI
  (the parallel `e2e` job in `.github/workflows/ci.yml`) — proving the app
  boots, not just compiles; only real end-to-end flows wait for the Phase 3
  vertical slice. Full guide: [docs/playwright.md](docs/playwright.md).

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
between runs. `e2e` boots the app and runs the Playwright smoke test. `db` boots
the local Supabase stack and runs the pgTAP suite from `supabase/tests/`, so an
RLS or write-guard regression fails CI rather than merging green — it's the
slowest of the three (cold Docker image pulls). Details:
[docs/tooling.md](docs/tooling.md).

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
│   ├── workflows/          # ci.yml · security.yml (gitleaks + semgrep) · osv-scanner.yml
│   └── dependabot.yml
├── .husky/                 # pre-commit (lint-staged + gitleaks) · commit-msg (commitlint)
├── docs/                   # project docs (see index below) · docs/reports/ = roadbump postmortems
├── public/
├── src/
│   ├── app/                # Next.js App Router · globals.css carries the shadcn zinc theme
│   ├── components/
│   │   └── ui/             # shadcn/ui primitives (button; add more via `shadcn add`)
│   ├── lib/
│   │   ├── supabase/       # client.ts (browser) · server.ts (per-request) · proxy.ts (session refresh) · env.ts (validated config)
│   │   ├── utils.ts        # cn() class-name helper (clsx + tailwind-merge)
│   │   └── database.types.ts   # GENERATED from the schema — never hand-edited
│   └── proxy.ts            # Next.js 16 root convention (renamed from middleware.ts)
├── supabase/
│   ├── migrations/         # timestamped SQL — SOURCE OF TRUTH (RLS ships with its table)
│   ├── tests/              # pgTAP RLS/write-guard suite
│   ├── seed.sql            # 3 login-able users + sample data
│   └── config.toml
├── tests/
│   ├── unit/               # Vitest (DOM harness)
│   └── e2e/                # Playwright specs (smoke test)
├── .env.example            # committed template — documents every required var
├── .gitleaks.toml          # secret-scanning config
├── .nvmrc                  # Node 24
├── commitlint.config.mjs   # conventional-commit rules
├── playwright.config.ts
├── vitest.config.ts
└── CLAUDE.md               # engineering source of truth (architecture, phases, rules)
```

The rest of the target application structure (`src/server/`, `src/schemas/`, …)
is specified in `CLAUDE.md` §3 and gets created as Phase 3 lands — not
speculatively. (`src/components/` arrived with the UI toolkit on 2026-07-27.)

## Documentation index

| Doc | What's in it |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Source of truth: architecture, phases, conventions, working agreements |
| [`docs/tooling.md`](docs/tooling.md) | CI, security scanning, git hooks — how it works, decisions, known issues |
| [`docs/playwright.md`](docs/playwright.md) | E2E testing: install, run, troubleshoot |
| [`docs/backlog.md`](docs/backlog.md) | Ranked foundation & development backlog (issue-ready blocks) |
| [`docs/schema/schema-brainstorming.md`](docs/schema/schema-brainstorming.md) | Schema design process: workflows → tables → security/RLS → Zod (Phase 2+) |
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
| 3 — Vertical slice | One full path: manager → work order → vendor → activity log | 🚧 In progress — UI toolkit (Tailwind + shadcn/ui, zinc) installed 2026-07-27; auth loop next |
| 4 — Hosted deploy | Vercel + Supabase Cloud, PR previews, Sentry | Planned |
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
