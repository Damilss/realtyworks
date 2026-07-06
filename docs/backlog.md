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

## State verified (2026-07-04)

- `next 16.2.6` / `react 19.2.4` / `pnpm@9.15.9`, Node pinned to 24 (`.nvmrc`).
- CI runs `lint → format:check → typecheck → test → build → audit` — with
  `!cancelled()`, concurrency-cancel, `permissions: contents: read`, and
  pnpm + Next build caching. The audit step is **blocking** (fails on any
  high/critical advisory; see `docs/tooling.md`).
- Security workflows live: **gitleaks** on PR/push (+ pre-commit layer),
  weekly **osv-scanner** lockfile scan.
- Dependabot on (npm + github-actions, weekly) — still untuned (see 🟠 below).
- Husky **pre-commit** (lint-staged + gitleaks) **and `commit-msg`**
  (commitlint, conventional types + `deps`, `CI/CD` retired → `ci`).
- Playwright + one smoke test, **local-only by design** (`docs/playwright.md`).
- Prettier configured (markdown intentionally ignored).

### Sharp edges these issues address
- **~11 open Dependabot branches** (ungrouped). Dependabot emits
  `chore(deps)` / `chore(deps-dev)` prefixes — valid conventional commits, but
  not the house `deps` type (and commitlint is hook-only, so bot commits are
  never linted anyway). The open `@types/node → 26` bump **leads** the Node 24
  runtime; types should track the runtime major (24), not lead it.
  `@types/node` is currently `^20`.
- Native GitHub security features (CodeQL, secret-scanning push-protection,
  dependency-review) are **GHAS-gated on private repos**. Security issues below default
  to **OSS CI tools** (gitleaks, Semgrep, osv-scanner) — free, vendor-neutral, and they
  keep Phase 6 self-host mechanical per `CLAUDE.md` §5.

---

## ✅ Done (kept for the paper trail)

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
- Require PR before merge; require the **CI** check (and gitleaks/Semgrep once added) to pass.
- Dismiss stale approvals; require conversation resolution.
- Block force-push and deletion; include administrators.
**Done when:** a direct push to `main` is rejected; PRs need green checks to merge.

---

## 🟠 High

### 🟠 Tune Dependabot: group, prefix, and pin @types/node to Node 24
**Why:** ~11 ungrouped PRs is noise; Dependabot's `chore(deps)` prefix doesn't match
the house `deps` type; the open `@types/node → 26` bump leads your Node 24 runtime.
**Do:** in `.github/dependabot.yml`:
- `groups:` — bundle minor+patch (e.g. one `dev-minor` group) to cut PR count.
- `commit-message: { prefix: "deps", prefix-development: "deps" }` to match the house type.
- `ignore:` a major bump on `@types/node` beyond `24.x` (types track runtime, not lead it).
- Add `labels: ["dependencies"]`; consider dropping `open-pull-requests-limit` back down.
**Done when:** next Dependabot run opens grouped PRs with `deps(...)` messages that pass CI.

### 🟠 SAST in CI (Semgrep OSS)
**Why:** Static analysis catches injection/authz bugs before they ship; CodeQL needs GHAS on private.
**Do:** add a `semgrep ci` job (`returntocorp/semgrep`) with `p/typescript`, `p/react`,
`p/nextjs`, `p/owasp-top-ten` rulesets. (Swap to CodeQL later if you go public or buy GHAS.)
**Done when:** Semgrep runs on every PR and reports findings as annotations.

### 🟠 Harden GitHub Actions supply chain
**Why:** `@v4` tags are mutable; a compromised tag runs in your CI.
**Do:** pin every `uses:` to a full commit SHA (with a `# v4.x.x` comment). Add least-privilege
`permissions:` to each new workflow. Dependabot's `github-actions` updates will bump the SHAs for you.
**Done when:** no floating tags remain in `.github/workflows/`.

### 🟠 Fix `@types/node` to match the runtime
**Why:** `@types/node: ^20` lags Node 24; type surface won't match what you run.
**Do:** bump to `^24` (do **not** accept the `26` PR while on Node 24).
**Done when:** `pnpm typecheck` passes on `^24`.

---

## 🟡 Medium

### 🟡 Vitest DOM environment + Testing Library
**Why:** `react` / `react-dom` (19.2.4) and `@types/react-dom` are already installed for the app,
but Vitest runs in the default **node** environment with no DOM and no render helpers — so only
plain-TS logic is testable, not components. Needed before the Phase 3 slice's component tests
(`CLAUDE.md` §5).
**Current state:** `vitest.config.ts` sets only `include` globs (no `environment`, `setupFiles`, or
`globals`); `tests/unit/` doesn't exist yet (only `tests/e2e/smoke.spec.ts`); no `@testing-library/*`,
`happy-dom`, or `jsdom` installed (the lockfile mentions are Vitest's optional peer declarations).
**Do:**
- `pnpm add -D happy-dom @testing-library/react @testing-library/jest-dom` (React 19 / Vitest 4 compatible —
  `@testing-library/react` ≥ 16 for React 19).
- In `vitest.config.ts`: `test.environment: "happy-dom"`, `test.setupFiles: ["./tests/unit/setup.ts"]`,
  and `test.globals: true` (enables Testing Library's automatic per-test `cleanup()`).
- Add `tests/unit/setup.ts` → `import "@testing-library/jest-dom/vitest";` (registers the DOM matchers
  and augments Vitest's `expect` types via module augmentation — no tsconfig change needed for the matchers).
- For `globals: true` typing, add a `vitest.d.ts` with `/// <reference types="vitest/globals" />` rather
  than a `types: [...]` array in `tsconfig.json` — this repo has **no** `types` field, so introducing one
  would drop the currently auto-included `@types/node` / `@types/react`.
- Add one render test under the existing glob (`tests/unit/**` or `src/**/*.test.tsx`) to prove the setup;
  this also creates `tests/unit/`.
**Notes:** happy-dom over jsdom for speed/footprint (swap only if a needed API is missing). `tsconfig`
already sets `jsx: "react-jsx"`, so esbuild transforms `.tsx` in tests — `@vitejs/plugin-react` is **not**
required unless a test needs full `act()` / Fast-Refresh parity.
**Done when:** `pnpm test` runs a component render test green under happy-dom, `pnpm typecheck` still passes,
and jest-dom matchers (e.g. `toBeInTheDocument`) are available in specs.

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

### 🟡 Wire Playwright into CI (when the Phase 3 slice lands)
**Why:** `docs/playwright.md` intentionally defers E2E to Phase 3/4 — this issue is the "when."
**Do:** add a separate `e2e` job: install `chromium`, cache the browser, run `pnpm test:e2e`,
upload the HTML report artifact. Gate it to the branch/paths where the slice lives.
**Done when:** the smoke test (and first real flow) runs green in CI.

### 🟡 Optional hygiene: `knip`
**Why:** Catches dead deps/exports early — cheap signal for a solo dev.
**Do:** `pnpm add -D knip`; add a `knip` script; run occasionally (not a CI gate yet).
**Done when:** `pnpm knip` reports a clean (or triaged) baseline.

---

## 🟢 Low — general-development runway (Phase 2+, phase-gated)

### 🟢 Phase 2 — Supabase local
`supabase init`, commit `config.toml`, `supabase start` (Docker). One `db reset` command to a
known-good state. Stay within self-hostable features only (`CLAUDE.md` §5).

### 🟢 Phase 2 — First migrations (RLS in the same file as each table)
Numbered SQL for: properties, units, work_orders, vendors, activity_log, attachments. Every table
ships its RLS policy in the same migration. No dashboard click-ops.

### 🟢 Phase 2 — Seed data
3 users (landlord / manager / vendor), sample properties + a vendor, work orders in varied states.

### 🟢 Phase 2 — Supabase clients + generated types
`@supabase/ssr` → `client.ts` / `server.ts` / `middleware.ts`; generate `database.types.ts`
(`supabase gen types` — never hand-edit).

### 🟢 Phase 2/3 — Tailwind + shadcn/ui (not yet installed)
Stack is decided (`CLAUDE.md` §2) but absent. Install Tailwind + `prettier-plugin-tailwindcss`,
init shadcn/ui into `src/components/ui/`.

### 🟢 Phase 3 — The one vertical slice
manager logs in → creates work order → assigns vendor → vendor updates status + uploads photo →
activity log reflects it → manager sees it. Exercises auth, RLS, mutations, storage, audit once.

### 🟢 Phase 3 — First real unit tests
Work-order state transitions + permission checks — the "test what matters" targets (`CLAUDE.md` §5).

### 🟢 Phase 4 — Observability & deploy
`@sentry/nextjs`, Vercel PR preview deploys, prod deploys only from `main`. Keep a working
Dockerfile so self-host stays `docker run` away (`CLAUDE.md` §5/§7).

---

## Suggested dependencies (quick reference)

| Package | Why | When |
|---|---|---|
| ~~`@commitlint/cli` + `@commitlint/config-conventional`~~ | ✅ Installed (PR #40) | Done |
| `@testing-library/react`, `@testing-library/jest-dom`, `happy-dom` | Component tests need a DOM | Medium |
| `@vitest/coverage-v8` | Coverage visibility | Medium |
| `@t3-oss/env-nextjs` + `zod` | Typed, validated env vars (also the shared zod schemas per §3) | Medium → Phase 3 |
| `knip` | Dead deps/exports detector | Medium (optional) |
| `@supabase/ssr` + `@supabase/supabase-js` | Server-side auth + DB client | Phase 2 |
| `tailwindcss` + `prettier-plugin-tailwindcss` + shadcn/ui | Decided UI stack, not yet installed | Phase 2/3 |
| `@sentry/nextjs` | Error monitoring | Phase 4 |

*Not npm packages, but part of the plan:* `gitleaks`, `semgrep`, `osv-scanner` (CI actions),
and the `supabase` CLI (Phase 2).

---

## Recommended order for the next few sessions

*(Done so far: commitlint → gitleaks → `pnpm audit` gate + osv-scanner → Semgrep
→ audit gate flipped to blocking.)*

1. **Dependabot tuning** (High) — grouping cuts the open-PR noise, and the
   `deps` commit prefix aligns bot commits with the house type.
2. **Branch protection** (Critical) — last of this batch, so you can require every
   check that now exists (CI, gitleaks, Semgrep).

That gets the full security + CI + commit-hygiene foundation green before any Supabase code.
