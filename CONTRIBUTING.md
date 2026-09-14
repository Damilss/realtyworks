# Contributing to RealtyWorks

**This repository is not open source** ([`LICENSE.md`](LICENSE.md)) and is not
accepting outside contributions. It is a private, proprietary, one-developer
project. This file is the working agreement, with future-you, and with any
collaborator or coding agent that shows up later.

[`CLAUDE.md`](CLAUDE.md) is the engineering source of truth: architecture,
build phases, and the rules that constrain what gets built.
[`AGENTS.md`](AGENTS.md) binds coding agents specifically. Read both before
writing code. Where this file and `CLAUDE.md` disagree, `CLAUDE.md` wins.

---

## 1. Setup

**Use `pnpm`, never npm.** Node is pinned to 24 (`.nvmrc`, plus `engines.node`
in `package.json` — a wrong major only warns); pnpm to 11.13.1
(`packageManager`). `.editorconfig` carries the whitespace conventions for your
editor; Prettier is what CI actually checks. Docker must be running for the local Supabase stack.

```bash
git clone <repo-url> && cd realtyworks
nvm use               # Node 24
corepack enable       # activates pnpm 11.13.1
pnpm install          # deps + git hooks (via the "prepare" script)
```

**The app will not serve a single page without environment variables.**
`src/proxy.ts` refreshes the Supabase session on every request and
`src/lib/supabase/env.ts` throws when its config is missing, so `pnpm dev`
without a `.env.local` returns **500 on every route** — including `/login`.
Boot the database, then write the file from the running stack:

```bash
pnpm exec supabase start

pnpm exec supabase status -o env \
  --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
  --override-name auth.publishable_key=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  | grep -E '^(NEXT_PUBLIC_|SECRET_KEY=)' \
  | sed 's/^SECRET_KEY=/SUPABASE_SECRET_KEY=/' > .env.local
```

That is the same command the CI `e2e` job runs, and it writes the three
variables the app reads. The `grep` is load-bearing and is an **allowlist**:
`-o env` also prints `SERVICE_ROLE_KEY`, `JWT_SECRET`, and `DB_URL`, none of
which belong in the app's env file. `SECRET_KEY` is admitted on purpose and
renamed to the `SUPABASE_SECRET_KEY` that `src/lib/supabase/admin.ts` reads —
the vendor invite and the attachment upload are service-role writes. It must
never gain a `NEXT_PUBLIC_` prefix: `next build` inlines those into the browser
bundle, and this key bypasses RLS. The app boots without it; only those two
paths fail. This command **overwrites** `.env.local`; back it up if you've
customized it. Full walkthrough and the manual alternative:
[`README.md` § Getting started](README.md#getting-started).

Everyday database commands:

```bash
pnpm exec supabase db reset   # rebuild from migrations + seed — known-good state
pnpm exec supabase test db    # pgTAP RLS / write-guard suite
pnpm exec supabase stop       # shut it down
```

### The hooks gotcha, in a new worktree or clone

`node_modules/` and `.husky/_/` are gitignored, so they never travel with a
checkout — and **git treats a missing hooks directory as "no hooks
configured."** It skips pre-commit and commit-msg silently: no warning, zero
exit code, commits succeed while lint-staged, gitleaks, and commitlint do
nothing. Worse, `pnpm install` only runs `prepare` when it actually installs
something, so an already-populated `node_modules/` short-circuits with
`Already up to date` and the hooks are never created.

In a new worktree or clone, run both:

```bash
pnpm install
pnpm run prepare   # cheap, idempotent, safe to re-run
```

Check an existing one with `ls .husky/_/commit-msg`. CI is unaffected either
way — it runs the checks directly, not through hooks.

---

## 2. Branching

`main` is protected and is the **migration baseline**: a migration that has
reached `main` is immutable. `dev` is the integration branch. Work happens on a
short-lived branch and reaches `main` as:

```
feature branch → dev → PR → main
```

Never commit directly to `main`.

**Preferred naming: `<issue-number>-<kebab-slug>`** — the format GitHub's
"Create a branch" button on an issue produces, and the dominant style in this
repo's history (`19-secret-scanning-gitleaks-in-ci-pre-commit`,
`44-make-the-pnpm-audit-dependency-gate-blocking-remove-continue-on-error`).
The leading issue number is the paper trail: it links branch, PR, and issue
without anyone typing `Refs #19`.

**Without an issue: `<type>/<slug>`**, reusing a commitlint type, kebab-case:

```
feat/work-order-status-filter
fix/session-refresh-loop
ci/pgtap-required-check
docs/security-policy
```

Both forms exist in history and both are fine. A bare `patch-1`, `help`, or
`test2` is not — if the name doesn't say what the branch is for, rename it.
Delete the branch after merge.

---

## 3. Commits

Conventional commits, enforced by commitlint via the `commit-msg` hook.

```
type(optional-scope): subject
```

The minimum viable commit is just `type: subject`. Allowed types:

| Type | Use for |
| --- | --- |
| `feat` | A new capability |
| `fix` | A bug fix |
| `docs` | Docs only — no code change |
| `test` | Adding or adjusting tests only |
| `refactor` | Neither fixes a bug nor adds a feature |
| `perf` | A performance improvement |
| `style` | Formatting/whitespace, no logic change |
| `build` | Build system / tooling config (not CI, not deps) |
| `ci` | CI config & workflows (`.github/workflows/…`) |
| `deps` | Dependency bumps — also what Dependabot uses |
| `chore` | Housekeeping that fits nothing above |
| `revert` | Reverting a previous commit |
| `wip` | Local work-in-progress checkpoint |

Blocking rules: lowercase type, non-empty subject, no trailing period, subject
not in Sentence-case/Start-Case/PascalCase/UPPER-CASE, header ≤ 100 characters.

Scopes are free-form lowercase area nouns — in practice `db`, `auth`, `readme`,
`tooling`, `security`, `ci`, `deps`, `supabase`, `backlog`, `reports`. Use
imperative mood ("add", not "added"). Link issues in the footer with
`Refs #24` or `Closes #52`.

Two things worth knowing. **`wip` persists** — this repo merges with merge
commits, so a `wip` commit that isn't squashed away stays in `main`'s history;
use it for local checkpoints and reword before it reaches a PR. And
**commitlint is hook-only** — there is no CI step, so `--no-verify` genuinely
bypasses it and nothing downstream catches the result.

Full cheat sheet, including the ambiguous cases:
[`docs/commit-messages.md`](docs/commit-messages.md).

---

## 4. Before you push

Run the same gauntlet CI runs. Finding out in 90 seconds beats a six-minute
red-CI round trip:

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm audit --audit-level=high
```

One trap: `lint-staged` covers `*.{ts,tsx,json,css,md}` but **not `*.yml`**, and
Prettier does format YAML (only `pnpm-lock.yaml` is exempt). A mis-formatted
workflow or issue-form file sails through the pre-commit hook and fails
`format:check` in CI. Run `pnpm format` after touching any `.yml`.

Markdown is the opposite case: `.prettierignore` lists `*.md`, so docs are
hand-formatted and **can never break `format:check`**.

---

## 5. Pull requests

Every change reaches `main` through a PR with green CI — solo included. The PR
is the record of *why*; the diff is only the *what*.

1. Open the PR. `.github/pull_request_template.md` prefills it; fill it in
   rather than deleting it. Base is `dev` unless the branch was cut from `main`.
2. Reference the issue as `Refs #NN` — **not** `Closes #NN`. Closing keywords in
   a PR description are interpreted only when the PR targets the *default*
   branch; target any other branch and "these keywords are ignored, no links are
   created, and merging the PR has no effect on the issues." Since PRs here
   normally target `dev`, `Closes` in a PR body silently does nothing. **Put the
   closing keyword in the commit message instead** — a commit-message `Closes
   #NN` fires when that commit reaches `main`, which is exactly what the
   `dev → main` merge does. That is the only form that survives this flow.
3. **Read your own diff in the Files-changed tab before merging.** This is the
   step that actually catches things. GitHub won't let you approve your own PR,
   so the review *is* the reading, not the button.
4. Merge with a **merge commit**, not a squash — the history and the `wip`
   caveat both assume it. Delete the branch.

What the CI jobs prove:

| Job | Proves |
| --- | --- |
| `verify` | lint → format:check → typecheck → test → build → audit. It compiles and is clean. Every step after the first runs on `!cancelled()`, so one run reports *every* failure |
| `e2e` | Boots a real Supabase stack, resets it to the seed, and drives the whole Playwright vertical slice in Chromium (auth loop · staff write path · vendor loop) — the app actually **runs** and RLS holds through a real session, not just compiles. Still *named* "E2E (Playwright auth loop)"; branch protection matches by name, so the name outlived its scope on purpose |
| `db` | `supabase db reset` + pgTAP — RLS and write guards still hold. Runs on every PR, **not yet a required check** |
| `security` | gitleaks full-history secret scan + Semgrep SAST. Both blocking |
| `osv-scanner` | Lockfile CVEs — weekly, plus every PR into `main`. Advisory |

Red CI blocks the merge. Fix the change; don't bypass the gate. If the *gate* is
wrong, change the gate in its own PR and say so. Detail and decisions:
[`docs/tooling.md`](docs/tooling.md).

`CODEOWNERS` (`* @Damilss`) is an ownership record, not a gate — GitHub never
requests review from a PR's own author, so it is inert on your own PRs and only
fires on Dependabot's. "Require review from Code Owners" stays **off**; it would
be unsatisfiable solo.

---

## 6. Schema changes

The rules that bite, all from `CLAUDE.md` §5:

- **Migrations are the source of truth.** Every schema and RLS change is a
  numbered migration file. **No dashboard click-ops, ever.**
- **Forward-only past `main`.** A migration that has reached `main` is
  immutable — change it with a *new* timestamped migration, never by editing the
  merged file. Editing is only ever an option for a migration still unmerged on
  a local branch.
- **RLS ships with its table**, in the same migration. Retrofitting RLS is not
  allowed.
- **Regenerate the types, never hand-edit them:**
  ```bash
  pnpm exec supabase gen types typescript --local > src/lib/database.types.ts
  pnpm format   # the generated file must pass format:check
  ```
- **Add pgTAP coverage** in `supabase/tests/` for anything touching
  authorization, so a regression fails CI instead of merging green.

`pnpm exec supabase db reset` rebuilds local from migrations + seed — that is
the known-good state to reproduce from.

---

## 7. Where logic goes

**There is no backend service.** No Express/Nest app, no `/backend` folder, no
second deployable. Backend *logic* lives in exactly three places:

1. **Postgres** — RLS, check constraints, triggers, DB functions. Most security
   and integrity logic belongs here.
2. **Next.js server actions & route handlers** (`src/server/`) — secrets, atomic
   orchestration, anything the client shouldn't be trusted with.
3. **Supabase Edge Functions** — event-driven/async work, webhooks, cron.

**The trust rule:** anything affecting security, money, or data integrity is
enforced server-side. The client may mirror logic for UX and is never the source
of truth. Never trust a client-supplied role, price, permission, or ownership
check.

`src/server/` is the trust boundary, with one deliberate seam.
`src/server/queries/` is server-only and enforces it in code (`import
"server-only"`); `src/server/actions/` is the exception, because client
components are *meant* to import server actions — `"use server"` replaces the
body with an RPC reference and the implementation never ships. `src/schemas/`
(zod) is imported by both sides: validate twice, trust only the server.

**One client bypasses RLS**, `src/lib/supabase/admin.ts`, and it exists only for
the two writes with no client grant (attachment metadata, `vendors.profile_id`)
plus `auth.admin` for the vendor invite. Reach for it **last**: establish the
caller's access with their own session client first, then create the privileged
one. It is the one place where a missing check has no policy behind it.

---

## 8. Scope discipline

The project is on a deadline, and holding the scope line is the single biggest
predictor of shipping. Before building, check `CLAUDE.md` §1:

- **Non-goals for MVP** — tenant portal / messaging, full leasing pipeline, deep
  third-party integrations, a native app or second mobile surface, dashboards
  beyond minimal reporting. Don't build these; flag the creep instead.
- **Deferred** — accounting and rent tracking are Phase 6. "Not yet," not
  "never": leave room for a ledger without paying for it today.
- **Respect the phase order** (`CLAUDE.md` §4). If asked for Phase N+1 work
  while Phase N is unfinished, say so and confirm first.
- **Prefer the smallest change** that satisfies the requirement. No speculative
  folders, abstractions, or dependencies. Add a folder only when 3+ real things
  belong in it.

The deadline is a reason to cut scope and skip gold-plating — never a reason to
cut rigor, tests, RLS, or CI.

---

## 9. The paper trail

[`docs/backlog.md`](docs/backlog.md) is the intake. Each `###` block is written
in the shape the issue forms ask for — **Why** / **Do** / **Done when** — ranked
🔴🟠🟡🟢, so a block copies straight across into a new issue. When the work
lands, **move** the block into *✅ Done (kept for the paper trail)* with the date
and issue/PR number. Don't delete it.

When something fights back for an hour, write it up: copy
[`docs/reports/TEMPLATE_REPORT.md`](docs/reports/TEMPLATE_REPORT.md) to
`docs/reports/YYYY-MM-DD-short-slug.md`, fill it in, and add a row to
[`docs/reports/README.md`](docs/reports/README.md).

"Who changed what, when" is a product feature here, not a nice-to-have. It
applies to the repo too.

---

## 10. Security

Never commit secrets. Real values live only in `.env.local` (gitignored);
[`.env.example`](.env.example) is the committed template. Production data is
never used in local or dev environments.

If a secret does land in history: **rotate the credential first** — scrubbing
history is cosmetic, and a rewrite that makes you feel better while the live key
still works is the worst outcome.

Reporting a vulnerability, what the automated gates already cover, and the
triage runbook: [`SECURITY.md`](SECURITY.md).
