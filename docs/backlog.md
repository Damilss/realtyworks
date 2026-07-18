# RealtyWorks — Foundation & Development Backlog

Ranked Critical → Low. Foundation (security · CI/CD · testing · commit hygiene) is
weighted to the top per current priority; general development (Phase 2+) sits lower
and is phase-gated by `CLAUDE.md` §4 — don't start it until the pipeline is green.

Each `###` block is scoped to become one GitHub issue (title / why / do / done-when).
Pick them off at your discretion.

**Priority key**
- 🔴 Critical — lock the door before secrets & app code land
- 🟠 High — finish the foundation `CLAUDE.md` already promises
- 🟡 Medium — repo hygiene / DX / test infra, do alongside early features
- 🟢 Low — general-development runway (Phase 2+)

---

## State verified (2026-07-17)

- `next 16.2.6` / `react 19.2.4` / `pnpm@11.13.1`, Node pinned to 24 (`.nvmrc`).
- CI runs `lint → format:check → typecheck → test → build → audit` — with
  `!cancelled()`, concurrency-cancel, `permissions: contents: read`, and
  pnpm + Next build caching. The audit step is **blocking** (fails on any
  high/critical advisory; see `docs/tooling.md`). A parallel **`e2e` job** runs
  the Playwright smoke test on every PR/push to `main`/`dev` (Chromium only,
  HTML report artifact).
- Security workflows live: **gitleaks** on PR/push to `main`/`dev`
  (+ pre-commit layer), **Semgrep SAST** (blocking, PR annotations), weekly
  **osv-scanner** lockfile scan (+ a scan on every PR into `main`). Every
  `uses:` is SHA-pinned; the semgrep container is digest-pinned.
- Dependabot on (npm + github-actions, weekly), **tuned** — grouped, `deps`
  prefix, `dependencies` label, `@types/node` pinned to `^24` (issue #23; see ✅).
- Husky **pre-commit** (lint-staged + gitleaks) **and `commit-msg`**
  (commitlint, conventional types + `deps`, `CI/CD` retired → `ci`).
- Prettier configured (markdown intentionally ignored).
- **Phase 2 schema live locally** — `supabase/` (9 migrations, seed, pgTAP
  suite via `pnpm exec supabase test db`), generated
  `src/lib/database.types.ts`, supabase CLI pinned as a devDependency. See ✅.

### Sharp edges these issues address
- Native GitHub security features (CodeQL, secret-scanning push-protection,
  dependency-review) are **GHAS-gated on private repos**. Security issues below default
  to **OSS CI tools** (gitleaks, Semgrep, osv-scanner) — free, vendor-neutral, and they
  keep Phase 7 self-host mechanical per `CLAUDE.md` §5.

---

## ✅ Done (kept for the paper trail)

### ✅ Phase 2 — Supabase local + schema + RLS + seed + pgTAP (2026-07-17)
Supabase CLI pinned as a devDependency (`supabase` ^2.109.1, install script
allow-listed in `pnpm-workspace.yaml`). Nine migrations create the seven §7
tables — RLS + grants + triggers in the **same file** as each table: landlord =
manager superset (deletes + role management via `set_user_role()`); all staff
see all properties; vendors scoped to assigned work orders with a fail-closed
column-guard trigger (status only → `in_progress`/`completed`); append-only
`work_order_activity` auto-logged from work-order changes; private
`work-order-attachments` bucket with path-derived object policies. `seed.sql`:
3 login-able users (`landlord|manager|vendor@realtyworks.test`), 2 properties,
3 units, a linked vendor, 5 work orders covering every status —
`pnpm exec supabase db reset` = one-command known-good state. 41 pgTAP tests in
`supabase/tests/` (`pnpm exec supabase test db`). `database.types.ts`
generated. Post-review hardening (same day): composite FK ties a work order's
unit to its property; `staff_directory` view gives vendors staff **names
only** (no whole-row profile reads); attachment `storage_path` CHECK enforces
the exact `<work_order_id>/<attachment_id>.<ext>` shape. Signup is invite-only (`[auth] enable_signup = false`) — gotcha:
`[auth.email].enable_signup` must stay `true`, turning it off disables the
whole email provider including logins (documented in `config.toml`). Full
design + decisions: `docs/schema/my_schema_writeup.md`.

### ✅ SAST in CI (Semgrep OSS) — verified in place 2026-07-17
`security.yml` runs a blocking `semgrep` job (digest-pinned container,
`p/typescript` + `p/react` + `p/nextjs` + `p/owasp-top-ten`) on PR/push to
`main`/`dev`, findings rendered as PR annotations. Was still listed as an open
🟠 item long after landing — the "Recommended order" footer already counted it
done.

### ✅ Harden GitHub Actions supply chain — verified in place 2026-07-17
Every `uses:` in `ci.yml` / `security.yml` / `osv-scanner.yml` is pinned to a
full commit SHA with a version comment; workflows carry least-privilege
`permissions:`; the semgrep `container:` image is digest-pinned (Dependabot
bumps `uses:` SHAs; the container pin is bumped manually — `docs/tooling.md`).

### ✅ Wire Playwright into CI — verified in place 2026-07-17
`ci.yml` has the parallel `e2e` job exactly as specced: installs Chromium,
caches the browser, runs `pnpm test:e2e`, uploads the HTML report artifact, on
every PR/push to `main`/`dev`. (Supersedes the old "local-only by design"
note.)

### ✅ Tune Dependabot + pin `@types/node` to Node 24 (2026-07-08, issue #23)
`.github/dependabot.yml`: both ecosystems now **group** bumps (npm splits into
`npm-production` / `npm-development`, github-actions into one; each bundles
major+minor+patch), carry the house `deps` commit prefix (`prefix` +
`prefix-development` on npm) instead of `chore(deps)`, and get a `dependencies`
label. `@types/node` is pinned to `^24` in `package.json` (matches Node 24 in
`.nvmrc`) and an npm `ignore:` rule drops any `@types/node` major beyond 24.x,
so the types track the runtime instead of leading it. `open-pull-requests-limit`
kept at 10 (grouping already cuts the real PR count). `pnpm typecheck` +
`pnpm build` green on `@types/node@24`. Rationale: `docs/tooling.md` §Dependabot.

### ✅ Untrack the committed pnpm store (2026-07-07)
`.pnpm-store/v11/index.db` (pnpm's local content-addressable store index) had
been committed by mistake. Added `.pnpm-store` to `.gitignore` and `git rm
--cached`'d the binary so it stops riding along in the tree. It's a per-machine
build artifact regenerated on `pnpm install` — never versioned.

### ✅ Vitest DOM environment + Testing Library
`happy-dom` environment + React Testing Library wired into Vitest. Dev deps:
`happy-dom`, `@testing-library/react` (+ its required `@testing-library/dom`
peer), `@testing-library/jest-dom`, `@testing-library/user-event`.
`vitest.config.ts` sets `environment: "happy-dom"`, `globals: true` (RTL's
automatic per-test cleanup), `setupFiles: ["./tests/unit/setup.ts"]`, and
`resolve: { tsconfigPaths: true }` — Vite 8's **native** `@/*` alias resolution,
so **no** `vite-tsconfig-paths` plugin (the recipe below first specced one;
Vite 8 does it in core). `tests/unit/setup.ts` imports
`@testing-library/jest-dom/vitest`; `vitest.d.ts`
(`/// <reference types="vitest/globals" />`, ESLint-ignored like `next-env.d.ts`)
types the globals without a tsconfig `types: [...]` array. Proof:
`tests/unit/harness.test.tsx` (render + jest-dom matcher + user-event) is green.
No `ci.yml` change — rides the existing `verify` steps. `@vitejs/plugin-react`
not needed (no `act()` warnings). happy-dom over jsdom per speed/footprint.

### ✅ Secret scanning (gitleaks) in CI + pre-commit — issue #19, PR #41
CI job on push + PR (full-history scan), `gitleaks git --pre-commit --staged`
in `.husky/pre-commit` (fail-safe when the binary is missing), committed
`.gitleaks.toml` (default rules + anchored `pnpm-lock.yaml` allowlist).
Follow-up hardening: `pull-requests: read` permission for the action.

### ✅ Dependency vulnerability gate — issue #20, PR #43
`pnpm audit --audit-level=high` in CI + weekly `osv-scanner` reusable workflow
(SARIF upload off: GHAS-gated on private repos). Landed **non-blocking** to
triage pre-existing advisories, then flipped to **blocking** (deliberate manual
edit, not date-based) once the one high finding — GHSA-fx2h-pf6j-xcff
(`vite`, dev-only peer of vitest) — was cleared by pinning `vite ^8.0.16` as a
direct devDependency (pnpm overrides don't move auto-installed peers).
Web-UI half (enable Dependabot **alerts** + **security updates** in Settings →
Security) — verify it's on.

### ✅ Flip the `pnpm audit` gate to blocking
Removed `continue-on-error: true` from the **Audit dependencies** step; a
high/critical advisory now fails CI. Cleared the blocking `vite` advisory
(GHSA-fx2h-pf6j-xcff) first by pinning `vite ^8.0.16` as a direct devDependency
(pnpm `overrides` don't move auto-installed peers). Comment de-staled.

### ✅ Enforce conventional commits (commitlint + commit-msg hook) — PR #40
`@commitlint/cli` + `config-conventional`, `commitlint.config.mjs` with the
decided type list (standard set + `deps`; `CI/CD` retired in favor of `ci`),
`.husky/commit-msg` running `commitlint --edit`.

### ✅ Extend CI/security/testing triggers to `dev` (2026-07-07)
`dev → main` integration flow went live. Added `dev` to the `push`/`pull_request`
`branches:` lists in `ci.yml` (verify + e2e) and `security.yml` (gitleaks +
Semgrep), so CI, secret, and SAST scans now run on `dev` pushes and PRs into
`dev`. `osv-scanner.yml` gained a `pull_request: [main]` trigger (chosen over
dev-push triggers — lowest noise, scans right before merge), keeping the weekly
cron + `workflow_dispatch`. No job renamed, so `main` branch-protection
required-check names are unchanged; the OSV scan surfaces as a non-required
(advisory, emails-on-fail) check on `dev → main` PRs. Docs synced: `tooling.md`,
`README.md`, `CLAUDE.md` §0.

---

## 🔴 Critical

### 🔴 Branch protection on `main` (verify/enable — web UI)
**Why:** `CLAUDE.md` §4/§5 make this a Phase-1 requirement and the paper trail depends on it.
**Do:** Settings → Branches → protect `main`:
- Require PR before merge; require the **CI**, gitleaks, and Semgrep checks to pass.
- Dismiss stale approvals; require conversation resolution.
- Block force-push and deletion; include administrators.
**Done when:** a direct push to `main` is rejected; PRs need green checks to merge.

---

## 🟠 High

*(Both former High items — Semgrep SAST and Actions supply-chain hardening —
shipped; see ✅ Done.)*

---

## 🟡 Medium

### 🟡 Coverage visibility (not a gate)
**Why:** See what's tested without chasing a %.
**Do:** `pnpm add -D @vitest/coverage-v8`; `pnpm test -- --coverage`; report in CI, no threshold yet.
**Done when:** a coverage summary prints in CI logs.

### 🟡 ESLint import boundary for `src/server/`
**Why:** `CLAUDE.md` §3: `src/server/` is the trust boundary; client must never import it.
**Do:** add a `no-restricted-imports` (or `eslint-plugin-boundaries`) rule blocking
`@/server/*` from client components. Land it now so it's ready when `src/server/` appears.
**Done when:** importing `@/server/...` into a client component fails lint.

### 🟡 Typed env vars + committed `.env.example`
**Why:** Enforces the "everything via env vars" rule and fails fast on a missing var.
**Do:** `pnpm add @t3-oss/env-nextjs zod`; define a typed env module; commit `.env.example`.
**Note:** `.gitignore` has `.env*` — add `!.env.example` or it won't commit.
**Done when:** a missing required var throws at build/start; `.env.example` is tracked.

### 🟡 GitHub repo scaffolding (paper trail)
**Why:** Templates + ownership records make the solo workflow auditable and consistent.
**Do:** add `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/{bug,feature,chore}.yml`,
`CODEOWNERS` (`* @yourname`), `CONTRIBUTING.md`, `SECURITY.md`.
**Done when:** new PRs/issues open with the templates prefilled.

### 🟡 `.editorconfig` + package.json `engines`
**Why:** Keep formatting/runtime consistent across machines and warn on wrong Node.
**Do:** add `.editorconfig` (mirror Prettier); add `"engines": { "node": ">=24 <25" }` and rely on
`packageManager` for pnpm.
**Done when:** wrong-Node installs warn; editors respect the config.

### 🟡 Optional hygiene: `knip`
**Why:** Catches dead deps/exports early — cheap signal for a solo dev.
**Do:** `pnpm add -D knip`; add a `knip` script; run occasionally (not a CI gate yet).
**Done when:** `pnpm knip` reports a clean (or triaged) baseline.

---

## 🟢 Low — general-development runway (Phase 2+, phase-gated)

### 🟢 Phase 2 — Supabase clients (`@supabase/ssr`)
`@supabase/ssr` → `src/lib/supabase/{client,server,middleware}.ts`. The rest of the Phase 2
runway (local stack, migrations + RLS, seed, `database.types.ts`) shipped 2026-07-17 — see ✅.
Regenerate types after every migration change, then `pnpm format`.

### 🟢 Phase 2/3 — Tailwind + shadcn/ui (not yet installed)
Stack is decided (`CLAUDE.md` §2) but absent. Install Tailwind + `prettier-plugin-tailwindcss`,
init shadcn/ui into `src/components/ui/`.

### 🟢 Phase 3 — The one vertical slice
manager logs in → creates work order → assigns vendor → vendor updates status + uploads photo →
activity log reflects it → manager sees it. Exercises auth, RLS, mutations, storage, audit once.
The vendor half is **magic-link, not a signup** — vendors get a real auth user reached by a unique
link (a "Copy vendor link" button in Phase 3; delivered over SMS in Phase 5). Design per
`docs/vendor-access.md`.

### 🟢 Phase 3 — First real unit tests
Work-order state transitions + permission checks — the "test what matters" targets (`CLAUDE.md` §5).

### 🟢 Phase 4 — Observability & deploy
`@sentry/nextjs`, Vercel PR preview deploys, prod deploys only from `main`. Keep a working
Dockerfile so self-host stays `docker run` away (`CLAUDE.md` §5/§7).

### 🟢 Phase 5 — PWA install layer (manifest + service worker)
Bolt-on to the already-responsive app — never a second codebase (`CLAUDE.md` §2). `src/app/manifest.ts`
(`MetadataRoute.Manifest`) + `public/sw.js` + icons; HTTPS required (`next dev --experimental-https`
locally). Platform constraints, per-OS install/push matrix, and the open decisions live in
`docs/pwa.md` — read it before building.
**Two decisions to settle first:** (1) do we need **web push** at all, given SMS already covers vendor
notification (§6) and iOS push only reaches users who *manually* installed the app? If yes, it's a §6
channel — logs to `messages`, respects `notification_preferences`, and needs a **push-subscriptions
table** (design it with the Phase 2 schema, not later). (2) **Offline** support means Serwist, which
per the Next.js guide needs **webpack** — but Next 16 defaults to **Turbopack**. Verify compatibility
before assuming offline is cheap; default is to skip offline writes entirely.
**Done when:** the app installs to an Android and an iOS home screen and launches standalone.

### 🟢 Phase 6 — Accounting & rent tracking (late stage, not a non-goal)
Promoted out of the MVP non-goals list (2026-07-09): rent roll, payments/expense ledger, cost
rollups. Gated behind Phase 5 breadth — don't start it early, and don't design it out either.
Money is the §2 trust rule at its strictest: amounts and balances computed server-side, ledger
append-only with reversing entries, never mutated history. Rent **collection** (payment rails,
PCI surface) is a separate go/no-go at the start of the phase.

---

## Suggested dependencies (quick reference)

| Package | Why | When |
|---|---|---|
| ~~`@commitlint/cli` + `@commitlint/config-conventional`~~ | ✅ Installed (PR #40) | Done |
| ~~`@testing-library/react` + `dom` + `jest-dom` + `user-event` + `happy-dom`~~ | ✅ Component test DOM harness (Vite 8 native `@/*` paths, no plugin) | Done |
| `@vitest/coverage-v8` | Coverage visibility | Medium |
| `@t3-oss/env-nextjs` + `zod` | Typed, validated env vars (also the shared zod schemas per §3) | Medium → Phase 3 |
| `knip` | Dead deps/exports detector | Medium (optional) |
| `@supabase/ssr` + `@supabase/supabase-js` | Server-side auth + DB client | Phase 2 |
| `tailwindcss` + `prettier-plugin-tailwindcss` + shadcn/ui | Decided UI stack, not yet installed | Phase 2/3 |
| `@sentry/nextjs` | Error monitoring | Phase 4 |

*Not npm packages, but part of the plan:* `gitleaks`, `semgrep`, `osv-scanner` (CI actions).
The `supabase` CLI is ✅ installed as a pinned devDependency (2026-07-17).

---

## Recommended order for the next few sessions

*(Done so far: commitlint → gitleaks → `pnpm audit` gate + osv-scanner → Semgrep
→ audit gate flipped to blocking → Dependabot tuning + `@types/node` pin.)*

1. **Branch protection** (Critical) — last of this batch, so you can require every
   check that now exists (CI, gitleaks, Semgrep).

That gets the full security + CI + commit-hygiene foundation green before any Supabase code.
