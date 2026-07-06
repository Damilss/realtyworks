# RealtyWorks

Modern solutions for property management.

**RealtyWorks** is an enterprise work interface for property managers and
landlords to run real-estate maintenance and repair operations end-to-end:
work orders, vendor coordination, documentation, and audit-ready records.

> **Status:** MVP / in active development — Phase 1 (Foundations)
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

### Non-goals (for MVP)

Full accounting / rent collection · tenant portal / messaging suite · full
leasing pipeline · deep third-party integrations · mobile app / second
surface · dashboards beyond the minimal reporting above.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | [Next.js](https://nextjs.org) 16 (App Router) |
| Language | TypeScript (strict) on React 19 |
| Package manager | **pnpm** `9.15.9` (pinned via `packageManager`) |
| Runtime | Node **24** (pinned in `.nvmrc`, matched by CI) |
| Unit tests | Vitest |
| E2E tests | Playwright (local-only for now — see [docs/playwright.md](docs/playwright.md)) |
| Lint / format | ESLint (`next/core-web-vitals` + TypeScript) · Prettier |
| Git hygiene | Husky + lint-staged · commitlint (conventional commits) · gitleaks |

Planned for later phases (decided, not yet installed): Supabase (Postgres,
Auth, Storage, RLS), Tailwind CSS + shadcn/ui, Sentry. There is **no separate
backend service** — backend logic lives in Postgres (RLS/constraints), Next.js
server actions/route handlers, and Supabase Edge Functions. See `CLAUDE.md` §2.

---

## Getting started

### Prerequisites

- **Node 24** — `nvm use` reads `.nvmrc`
- **pnpm 9.15.9** — easiest via [corepack](https://nodejs.org/api/corepack.html)
  (`corepack enable`), which reads the `packageManager` field; **do not use npm**
- **gitleaks** *(optional but recommended)* — the pre-commit hook runs a local
  secret scan when it's installed, and skips it with a warning when it isn't
  (CI scans regardless): `brew install gitleaks`

### Install & run

```bash
git clone <repo-url> && cd realtyworks
nvm use               # Node 24
corepack enable       # activates pnpm 9.15.9 from package.json
pnpm install          # also installs the git hooks (husky) via "prepare"
pnpm dev              # http://localhost:3000
```

No environment variables are required yet — Phase 1 has no external services.
A committed `.env.example` arrives with Supabase in Phase 2 (real values go in
the gitignored `.env.local`).

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

Run the CI gauntlet locally before pushing:

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm audit --audit-level=high
```

---

## Testing

- **Unit (Vitest)** — collects `src/**/*.{test,spec}.{ts,tsx}` and
  `tests/unit/**/*.{test,spec}.{ts,tsx}` only. Run one file with
  `pnpm exec vitest run src/path/to/file.test.ts`, or filter by name with
  `pnpm exec vitest run -t "name of test"`.
- **E2E (Playwright)** — owns `tests/e2e/`; currently a single smoke test.
  Requires a one-time browser download:
  `pnpm exec playwright install chromium`. Intentionally **not** wired into CI
  until the Phase 3 vertical slice exists. Full guide:
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
  `build chore ci deps docs feat fix perf refactor revert style test`
  (`deps` is a house addition for dependency bumps; the old `CI/CD` type from
  early history is retired in favor of `ci`).

### CI — `.github/workflows/ci.yml` (PRs + pushes to `main`)

One job runs **lint → format check → typecheck → unit tests → build → audit**.
Every check step after the first uses `if: ${{ !cancelled() }}`, so a single
run reports *every* failure rather than stopping at the first. pnpm's store and the Next.js build
cache are cached between runs.

The final step, `pnpm audit --audit-level=high`, is a blocking dependency
vulnerability gate. Any high/critical advisory fails CI; moderate/low
advisories stay below the audit threshold. The flip from advisory-only to
blocking was deliberate and manual — see [docs/tooling.md](docs/tooling.md)
for the rationale and cleared advisory details.

### Security scanning

- **gitleaks** (`.github/workflows/security.yml`) — secret scan of the full
  git history on every PR and push to `main`. Config: `.gitleaks.toml`
  (default rules + an allowlist for `pnpm-lock.yaml` false positives).
- **Semgrep OSS** (`.github/workflows/security.yml`) — SAST scan on every PR
  and push to `main` (`p/typescript`, `p/react`, `p/nextjs`,
  `p/owasp-top-ten`). Blocking; findings render as PR annotations.
- **osv-scanner** (`.github/workflows/osv-scanner.yml`) — weekly lockfile CVE
  scan (Mondays 12:30 UTC, plus manual `workflow_dispatch`).
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
├── docs/                   # project docs (see index below)
├── public/
├── src/
│   └── app/                # Next.js App Router (near-empty scaffold — Phase 1)
├── tests/
│   └── e2e/                # Playwright specs (smoke test)
├── .gitleaks.toml          # secret-scanning config
├── .nvmrc                  # Node 24
├── commitlint.config.mjs   # conventional-commit rules
├── playwright.config.ts
├── vitest.config.ts
└── CLAUDE.md               # engineering source of truth (architecture, phases, rules)
```

The target application structure (`src/server/`, `src/schemas/`, `supabase/`
migrations, …) is specified in `CLAUDE.md` §3 and gets created as Phases 2–3
land — not speculatively.

## Documentation index

| Doc | What's in it |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Source of truth: architecture, phases, conventions, working agreements |
| [`docs/tooling.md`](docs/tooling.md) | CI, security scanning, git hooks — how it works, decisions, known issues |
| [`docs/playwright.md`](docs/playwright.md) | E2E testing: install, run, troubleshoot |
| [`docs/backlog.md`](docs/backlog.md) | Ranked foundation & development backlog (issue-ready blocks) |
| [`docs/dependency-version-management.md`](docs/dependency-version-management.md) | Field manual for dependency/version debugging |

---

## Roadmap (build phases)

| Phase | Scope | Status |
| --- | --- | --- |
| 1 — Foundations | Tooling, CI, hooks, security scanning on a near-empty app | 🔷 Nearly done — open: branch protection ([backlog](docs/backlog.md)) |
| 2 — Supabase | Local stack, migrations (RLS from day one), seed data | Next |
| 3 — Vertical slice | One full path: manager → work order → vendor → activity log | Planned |
| 4 — Hosted deploy | Vercel + Supabase Cloud, PR previews, Sentry | Planned |
| 5 — Breadth | More features, minimal reports, SMS/notifications | Planned |
| 6 — Self-host (optional) | Docker Compose migration — kept mechanical by design | Eventual |

Full definitions in `CLAUDE.md` §4.

---

## Repo conventions

- This repository is **not open source**. Do not redistribute or deploy
  outside approved environments.
- Production data is never used in local/dev environments.
- All changes reach `main` via PR with green CI (paper trail, even solo).
- Conventional commits, enforced by commitlint.
