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

## State verified (2026-07-01)

- `next 16.2.6` / `react 19.2.4` / `pnpm@9.15.9`, Node pinned to 24 (`.nvmrc`).
- CI runs `lint → format:check → typecheck → test → build` — with `!cancelled()`,
  concurrency-cancel, `permissions: contents: read`, and pnpm + Next build caching.
- Dependabot on (npm + github-actions, weekly).
- Husky **pre-commit** only (lint-staged). No `commit-msg` hook.
- Playwright + one smoke test, **local-only by design** (`docs/playwright.md`).
- Prettier configured (markdown intentionally ignored).

### Sharp edges these issues address
- **Commitlint is not installed** — no config, no `commit-msg` hook — yet `CLAUDE.md`
  §5 claims conventional commits are "enforced by commitlint." Nothing checks commit
  format today. Existing history uses `deps(...)` and `CI/CD(...)`, which the standard
  `config-conventional` type list **rejects** — the type list must be decided.
- **~11 open Dependabot branches** (ungrouped, no conventional prefix). Once commitlint
  is on, Dependabot's default messages will fail it. The open `@types/node → 26` bump
  **leads** the Node 24 runtime; types should track the runtime major (24), not lead it.
  `@types/node` is currently `^20`.
- Native GitHub security features (CodeQL, secret-scanning push-protection,
  dependency-review) are **GHAS-gated on private repos**. Security issues below default
  to **OSS CI tools** (gitleaks, Semgrep, osv-scanner) — free, vendor-neutral, and they
  keep Phase 6 self-host mechanical per `CLAUDE.md` §5.

---

## 🔴 Critical

### 🔴 Secret scanning (gitleaks) in CI + pre-commit
**Why:** Phase 2 introduces Supabase keys. A leaked `service_role` key = full DB
compromise, and native push-protection needs GHAS on a private repo. Catch it in OSS.
**Do:**
- Add a `gitleaks` GitHub Actions job (`gitleaks/gitleaks-action`) on push + PR.
- Add a local `gitleaks protect --staged` step to `.husky/pre-commit` (after lint-staged).
- Commit a `.gitleaks.toml` (start from default rules).
**Done when:** a fake key in a test commit is blocked locally and fails CI.

### 🔴 Dependency vulnerability gate + enable Dependabot alerts/security updates
**Why:** You have Dependabot *version* updates, but nothing fails the build on a known CVE.
**Do:**
- Repo Settings → Security: enable **Dependabot alerts** + **security updates** (free on private).
- Add a CI step: `pnpm audit --audit-level=high` (non-blocking first week, then blocking).
- Add a weekly `osv-scanner` job (`google/osv-scanner-action`) for lockfile CVEs.
**Done when:** CI surfaces high/critical vulns; alerts appear in the Security tab.

### 🔴 Branch protection on `main` (verify/enable — web UI)
**Why:** `CLAUDE.md` §4/§5 make this a Phase-1 requirement and the paper trail depends on it.
**Do:** Settings → Branches → protect `main`:
- Require PR before merge; require the **CI** check (and gitleaks/Semgrep once added) to pass.
- Dismiss stale approvals; require conversation resolution.
- Block force-push and deletion; include administrators.
**Done when:** a direct push to `main` is rejected; PRs need green checks to merge.

---

## 🟠 High

### 🟠 Enforce conventional commits (commitlint + commit-msg hook)
**Why:** `CLAUDE.md` claims this is enforced; it isn't. The audit trail is a product feature.
**Do:**
- `pnpm add -D @commitlint/cli @commitlint/config-conventional`
- `commitlint.config.js` — **decide the type list**. History uses `deps` and `CI/CD`,
  which the default set rejects. Recommended: map `CI/CD → ci`, and allow `deps`:
  ```js
  export default {
    extends: ["@commitlint/config-conventional"],
    rules: { "type-enum": [2, "always",
      ["build","chore","ci","docs","feat","fix","perf","refactor","revert","style","test","deps"]] },
  };
  ```
- Add `.husky/commit-msg`: `pnpm exec commitlint --edit "$1"`
**Done when:** a non-conventional commit message is rejected locally.

### 🟠 Tune Dependabot: group, prefix, and pin @types/node to Node 24
**Why:** ~11 ungrouped PRs is noise; default messages will fail commitlint; the open
`@types/node → 26` bump leads your Node 24 runtime.
**Do:** in `.github/dependabot.yml`:
- `groups:` — bundle minor+patch (e.g. one `dev-minor` group) to cut PR count.
- `commit-message: { prefix: "deps", prefix-development: "deps" }` so commits pass commitlint.
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
**Why:** Component tests need a DOM; current Vitest is node-env only.
**Do:** `pnpm add -D @testing-library/react @testing-library/jest-dom happy-dom`; set
`test.environment: "happy-dom"` + a setup file in `vitest.config.ts`.
**Done when:** a trivial component render test passes.

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
| `@commitlint/cli` + `@commitlint/config-conventional` | Enforce the commit convention CLAUDE.md already assumes | High / now |
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

1. **commitlint** (High) + **Dependabot tuning** (High) together — they interact
   (Dependabot's commit prefix must satisfy commitlint).
2. **gitleaks** (Critical) — secrets before Phase 2 keys.
3. **Semgrep + `pnpm audit`** (Critical / High) — the SAST + dependency gate.
4. **Branch protection** (Critical) — last of this batch, so you can require the new
   checks once they exist.

That gets the full security + CI + commit-hygiene foundation green before any Supabase code.
