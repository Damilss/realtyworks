# CLAUDE.md — RealtyWorks

@AGENTS.md

Operating guide and source of truth for working on this repo with Claude Code.
Read this fully before generating code, scaffolding, or migrations.

---

## 0. Quick reference

**Package manager is `pnpm` (`pnpm@9.15.9`), not npm.** Node is pinned to
**24** (`.nvmrc`, matched by CI). Stack versions are new and have breaking
changes: **Next.js 16.2.6**, **React 19.2.4**. Per `AGENTS.md`, read the
relevant guide in `node_modules/next/dist/docs/` (`01-app`, `02-pages`,
`03-architecture`, …) before writing Next.js code — do not assume
training-data APIs.

### Commands
```bash
pnpm install            # install deps (CI uses --frozen-lockfile)
pnpm dev                # dev server, http://localhost:3000
pnpm build              # production build (next build)
pnpm start              # serve the production build
pnpm lint               # eslint (next core-web-vitals + typescript)
pnpm typecheck          # tsc --noEmit (strict)
pnpm test               # vitest run --passWithNoTests
pnpm test:e2e           # playwright smoke test (also runs in CI; boots the dev server itself)
pnpm format             # prettier --write .
pnpm format:check       # prettier --check . (CI gate; *.md is ignored)
```

Run a single test file / name:
```bash
pnpm exec vitest run src/path/to/file.test.ts     # one file (one-shot)
pnpm exec vitest run -t "name of test"            # filter by test name
pnpm exec vitest src/path/to/file.test.ts         # watch a single file
```

Vitest only collects `src/**/*.{test,spec}.{ts,tsx}` and
`tests/unit/**/*.{test,spec}.{ts,tsx}` (see `vitest.config.ts`). Import app code
via the `@/*` alias (`@/* → ./src/*`, `tsconfig.json`).

**CI** (`.github/workflows/ci.yml`, on PR + push to `main`): the `verify` job
runs lint → format:check → typecheck → test → build → audit. Each check step
after the first uses `if: !cancelled()` so one run reports *every* failure, not
just the first. A parallel `e2e` job runs the Playwright smoke test (boots the
app, Chromium only, HTML report uploaded as an artifact) — proving the app
*runs*, not just that it compiles.
The audit step (`pnpm audit --audit-level=high`) is blocking — CI fails on any
high/critical advisory. Two more workflows: gitleaks secret scan + Semgrep
SAST (`security.yml`, PR + push; semgrep is blocking, findings render as PR
annotations) and a weekly osv-scanner lockfile CVE scan
(`osv-scanner.yml`). Details + decisions: `docs/tooling.md`. Reproduce the
main gate locally by running lint/format:check/typecheck/test/build in order
before pushing.

**Git hooks** (Husky, installed by `pnpm install`): pre-commit runs
lint-staged + a gitleaks staged-changes scan (skipped if the binary is
missing); commit-msg runs commitlint (conventional types + `deps` + `wip`; the
old `CI/CD` type is retired in favor of `ci` — see `commitlint.config.mjs`).

### Current state vs. the target in §3

The repo is at **Phase 1 (Foundations)** — tooling/CI/security gates are in
place around a near-empty Next.js scaffold (`src/app/{layout,page}.tsx` +
globals, one Playwright smoke test). Most of §3's *application* tree and some
§5 tools are the **target**, not yet present. Verify before assuming they
exist:

- **Not yet created:** `supabase/` (no migrations/seed/config), `src/server/`,
  `src/lib/`, `src/schemas/`, `src/components/`, `tests/unit/`, `.env.example`.
- **Not yet installed:** `@supabase/ssr` / Supabase client, Tailwind,
  shadcn/ui. `database.types.ts` does not exist until the first migration is
  generated.
- **Already in place:** Husky (pre-commit + commit-msg), commitlint,
  lint-staged, Playwright (+ `tests/e2e/smoke.spec.ts`), gitleaks
  (CI + pre-commit), Semgrep SAST (CI), `pnpm audit` gate, weekly osv-scanner,
  Dependabot.
- When you add the first missing piece, follow §3/§5 exactly (e.g. RLS in the
  same migration as its table; `src/server/` as the trust boundary).

---

## 1. What this project is

**RealtyWorks** is an enterprise work interface for property managers and
landlords to run real-estate maintenance and repair operations end-to-end:
work orders, vendor coordination, documentation, and audit-ready records.

- Status: MVP / in active development
- Solo developer. No team. Optimize for low operational burden and a clear paper trail.
- License: Proprietary (see `LICENSE.md`).

### MVP scope
- Properties & units (basic structure for organizing work)
- Work orders (create, assign, update status, priority, due dates)
- Activity trail (notes + timestamped history: who changed what)
- Attachments (photos, receipts, invoices, supporting docs)
- Vendor contacts (assign vendors + store contact details)
- Basic reporting (open work, aging work orders, cost summaries — minimal)

### Explicit non-goals for MVP (do NOT build these)
- Full accounting / rent collection
- Tenant portal / messaging suite
- Full leasing pipeline
- Deep third-party integrations
- Mobile app / second surface
- Dashboards beyond the minimal reporting above

Holding this scope line is the single biggest predictor of shipping. If a
request would expand into a non-goal, flag it instead of building it.

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
│   ├── workflows/                  # ci.yml (main gate — see §0) · security.yml · osv-scanner.yml
│   └── dependabot.yml              # weekly npm + github-actions updates
├── .husky/                         # pre-commit (lint-staged + gitleaks), commit-msg (commitlint)
├── docs/                           # tooling.md · playwright.md · backlog.md · dependency-version-management.md · reports/
├── public/
├── src/
│   ├── app/                        # App Router
│   │   ├── (auth)/                 # route group: login, signup
│   │   ├── (dashboard)/            # route group: authed app shell
│   │   ├── api/                    # route handlers (webhooks etc.)
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
│   │   │   └── middleware.ts       # session refresh
│   │   ├── database.types.ts       # GENERATED — never hand-edit
│   │   └── utils.ts
│   ├── server/                     # SERVER-ONLY — never imported by client
│   │   ├── actions/                # server actions ("use server")
│   │   └── queries/                # data-fetching helpers
│   └── schemas/                    # zod schemas (shared client+server validation)
├── supabase/
│   ├── migrations/                 # numbered SQL — SOURCE OF TRUTH
│   ├── functions/                  # edge functions (empty until needed)
│   ├── seed.sql                    # test users + sample data
│   └── config.toml
├── tests/
│   ├── unit/                       # vitest
│   └── e2e/                        # playwright
├── .env.example                    # committed — documents required vars
├── .env.local                      # gitignored — real secrets
├── .gitleaks.toml                  # secret-scanning config (default rules + allowlist)
├── .nvmrc                          # pinned Node, matches CI
├── commitlint.config.mjs
├── eslint.config.mjs
├── .prettierrc
├── next.config.ts
├── playwright.config.ts
├── tsconfig.json                   # strict: true
├── vitest.config.ts
├── package.json
└── README.md
```

### Structure rules
- `src/server/` is the trust boundary. Client components must never import from
  it. Enforce with an ESLint import restriction once real code exists.
- `src/schemas/` (zod) is imported by both client and server: validate in both,
  trust only the server. Schemas do NOT live in `src/server/`.
- `database.types.ts` is generated via `supabase gen types typescript`.
  Regenerate whenever migrations change. Never hand-edit.
- No global `types/`, `services/`, `constants/`, `config/`, or `hooks/`
  junk-drawer folders. Co-locate or generate instead.

---

## 4. Build phases — current order of work

Foundations before features. Do not jump ahead to feature breadth.

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

**Phase 3 — One vertical slice**
Exactly one full path, nothing else: manager logs in → creates work order →
assigns vendor → vendor logs in → vendor updates status + uploads photo →
activity log reflects all of it → manager sees it. Exercises auth, RLS,
mutations, storage, activity trail before the pattern is duplicated.

**Phase 4 — Hosted deployment**
Vercel + Supabase Cloud free tier. PR preview deploys, Sentry wired, prod
deploys only from `main`.

**Phase 5 — Breadth**
Copy the vertical-slice pattern outward: more pages, features, minimal reports.
SMS/notifications added here (see §6) — not earlier.

**Phase 6 — Self-host migration (eventual, optional)**
See §7. Should be a weekend job, not a rewrite, if §5/§7 rules are followed.

---

## 5. Engineering conventions

- **Migrations are the source of truth.** All schema/RLS changes via numbered
  migration files. No dashboard click-ops, ever.
- **RLS from day one.** Every table ships with its RLS policy in the same
  migration. Retrofitting RLS is not allowed.
- **Everything via env vars.** No hardcoded URLs, keys, or config. `.env.example`
  documents every required var; `.env.local` holds real values and is gitignored.
- **Stay within self-hostable Supabase features.** Avoid cloud-only features so
  Phase 6 stays mechanical.
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

Nothing in Phases 1–5 changes for self-host: the §5 rules already make Phase 6
mechanical. Re-decide hosting on the merits when the time comes, not by default.

---

## 8. Working agreements for Claude Code

- Do not introduce a backend service, a `/backend` folder, or a second
  deployable.
- Do not expand into §1 non-goals; flag scope creep instead.
- Do not put security/money/integrity logic client-side.
- Do not click-ops schema; produce migration files with RLS in the same file.
- Do not hand-edit `database.types.ts`; regenerate it.
- Respect the phase order. If asked to build Phase N+1 work while Phase N is
  unfinished, say so and confirm before proceeding.
- Prefer the smallest change that satisfies the requirement. No speculative
  folders, abstractions, or dependencies.
- When a decision is ambiguous, prefer the option that keeps Phase 6 (self-host)
  mechanical and operational burden low.
