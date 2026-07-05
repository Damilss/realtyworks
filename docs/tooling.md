# Tooling — CI, security scanning, git hooks

How the quality and security gates work, why they're configured the way they
are, and the known issues / decisions behind them. The quick summary lives in
the [README](../README.md#quality-gates); this is the detail.

**The gate stack, outside-in:**

| Gate | Where | When |
| --- | --- | --- |
| lint-staged (ESLint + Prettier) | `.husky/pre-commit` | every commit |
| gitleaks staged scan | `.husky/pre-commit` | every commit (best-effort) |
| commitlint | `.husky/commit-msg` | every commit |
| Lint → format → typecheck → test → build | `.github/workflows/ci.yml` | PRs + pushes to `main` |
| `pnpm audit` dependency gate | `.github/workflows/ci.yml` | PRs + pushes to `main` |
| gitleaks full-history scan | `.github/workflows/security.yml` | PRs + pushes to `main` |
| osv-scanner lockfile CVE scan | `.github/workflows/osv-scanner.yml` | weekly + manual |
| Dependabot version updates | `.github/dependabot.yml` | weekly |

Local hooks are convenience; for linting, formatting, and secret scanning,
**CI is the authoritative gate** — hooks can be skipped (`--no-verify`,
missing gitleaks binary), CI can't. One exception: commit-message linting is
hook-only today; there is no commitlint step in CI.

---

## Git hooks (Husky)

Installed automatically by `pnpm install` via the `prepare` script. Hooks live
in `.husky/`.

### `pre-commit`

1. **lint-staged** — runs on staged files only (config in `package.json`):
   - `*.{ts,tsx}` → `eslint --fix` + `prettier --write`
   - `*.{json,css,md}` → `prettier --write`
2. **gitleaks** — scans the staged changes for secrets
   (`gitleaks git --pre-commit --staged --redact`). Runs **after** lint-staged
   so it sees the final content. If the binary isn't installed, the hook prints
   a warning and continues — CI re-runs gitleaks as the authoritative gate.
   Install locally: `brew install gitleaks`.

### `commit-msg`

`pnpm exec commitlint --edit "$1"` — rejects the commit if the message isn't a
valid conventional commit (see next section).

## Commit convention (commitlint)

Config: `commitlint.config.mjs`, extending `@commitlint/config-conventional`
(lower-case, non-empty type + subject, 100-char header, no trailing period).

Allowed types:

```
build chore ci deps docs feat fix perf refactor revert style test
```

**Decision (PR #40):** the default type list is overridden in two ways —

- `deps` **added** — used for dependency bumps, and what the Dependabot commit
  prefix should be set to (see [Dependabot](#dependabot) below).
- `CI/CD` **retired** — early history used a nonstandard `CI/CD(...)` type,
  which the standard list rejects. New commits use `ci`. Old commits stay as
  they are; commitlint only checks new ones.

The config uses a named (not anonymous) default export to keep ESLint's
`import/no-anonymous-default-export` happy.

---

## CI — `.github/workflows/ci.yml`

Runs on PRs targeting `main` and pushes to `main`.

- **Concurrency** — a newer push to the same ref cancels the in-progress run.
- **Permissions** — least privilege: `contents: read` only.
- **Toolchain** — pnpm version comes from `packageManager` in `package.json`
  (no version drift between local and CI); Node comes from `.nvmrc`.
- **Caching** — the pnpm store (via `actions/setup-node`) and `.next/cache`
  (keyed on the lockfile + source hashes) persist across runs.
- **Install** — `pnpm install --frozen-lockfile`: CI installs exactly the
  committed lockfile and fails on drift.

One `verify` job runs, in order:

```
lint → format:check → typecheck → unit tests → build → audit
```

Every step after the first carries `if: ${{ !cancelled() }}`, so a failing
step doesn't stop the rest — **one run reports every problem**, not just the
first. Any failed step still fails the job (and the PR check), except the
audit step while it remains non-blocking (next section).

Reproduce the gate locally (everything but the audit step):

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

Add `pnpm audit --audit-level=high` to preview the audit step too.

### Dependency vulnerability gate (`pnpm audit`)

The final CI step runs `pnpm audit --audit-level=high` (issue #20, PR #43):
fails on any known high/critical advisory in the dependency tree.

**Current state: non-blocking** (`continue-on-error: true`) to allow triage of
pre-existing advisories without turning every PR red.

**Decision:** the flip to blocking is **manual, not date-based**. A review
suggestion proposed switching automatically on a hardcoded date; declined —
a date-triggered flip can redden an unrelated PR with no warning, and a
hardcoded date lies the moment the triage slips. Flipping is a deliberate,
reviewed edit: delete the `continue-on-error: true` line, update the comment.
A tracking issue is the "don't forget" mechanism. (The comment in `ci.yml`
still carries the original "non-blocking until 2026-07-08" wording from PR
#43; rewriting it is part of the flip — tracked in
[docs/backlog.md](backlog.md).)

**Known finding (as of 2026-07-04):**

| Advisory | Package | Exposure | Fix |
| --- | --- | --- | --- |
| [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | `vite@8.0.13` | dev-only, transitive via `vitest` | patched in `vite >= 8.0.16` — clear by bumping vitest/vite |

---

## Secret scanning (gitleaks)

Two layers (issue #19, PR #41):

1. **Pre-commit** (above) — catches a secret before it ever enters history.
   Best-effort: skipped when the binary is missing.
2. **CI** (`.github/workflows/security.yml`) — `gitleaks/gitleaks-action@v2`
   scans the **full git history** (`fetch-depth: 0`) on every PR and push to
   `main`. This is the authoritative layer.

Workflow permissions are least-privilege with one addition: on PR events the
action calls `GET /pulls/:n/commits`, which needs `pull-requests: read`
(discovered when the first run failed without it — PR #41).

Config: `.gitleaks.toml` —

- Baseline is gitleaks' **built-in default rule set** (`[extend] useDefault`).
- Global allowlist excludes `pnpm-lock.yaml` (integrity hashes trip entropy
  rules). The path regex is **anchored** (`(^|/)pnpm-lock\.yaml$`) so it can't
  accidentally match, say, `not-pnpm-lock.yaml.js`.
- Add new allowlist entries here as false positives surface (e.g. future
  `.env.example` placeholders, test fixtures).

Licensing note: gitleaks-action is free for personal accounts and public
repos; only GitHub **organizations** need a `GITLEAKS_LICENSE` secret.

**If a real secret ever lands in history:** rotating the credential is the
fix; scrubbing history is cosmetic. Rotate first, always.

---

## Lockfile CVE scan (osv-scanner)

`.github/workflows/osv-scanner.yml` — weekly scheduled scan (Mondays 12:30
UTC) of the lockfile against the [OSV](https://osv.dev) database, plus
`workflow_dispatch` for manual runs. Both triggers only work from the copy on
`main` (a GitHub scheduling rule — branch copies don't run).

- Uses Google's **reusable workflow**, pinned to a full release tag
  (`osv-scanner-reusable.yml@v2.3.8`); Dependabot's `github-actions` ecosystem
  keeps the pin bumped.
- **`upload-sarif: false`** — SARIF upload to the Security tab requires GitHub
  Code Security (GHAS) on private repos and would fail here. Findings appear
  in the job log instead; `fail-on-vuln` (default `true`) fails the job, which
  emails the repo owner on scheduled runs. Flip to `true` if the repo goes
  public or Code Security is enabled (then also add `security-events: write`).

Overlap with `pnpm audit` is intentional: audit gates every PR against the npm
advisory feed; osv-scanner sweeps weekly against the broader OSV database.
Belt and suspenders, both free.

---

## Dependabot

`.github/dependabot.yml` — weekly version updates for two ecosystems:

- **npm** (`open-pull-requests-limit: 10`)
- **github-actions** — also serves as the auto-bumper for pinned workflow
  versions (e.g. the osv-scanner tag).

### Known gaps (tracked in [docs/backlog.md](backlog.md), not yet done)

- **Ungrouped PRs** — every bump is its own PR (~11 open at last count).
  Fix: `groups:` to bundle minor+patch.
- **Commit prefix vs house convention** — Dependabot currently emits
  `chore(deps)` / `chore(deps-dev)` prefixes (valid conventional commits, and
  `chore` passes the type list) rather than the house `deps` type. Fix:
  `commit-message: { prefix: "deps" }` to align. (Note commitlint is hook-only,
  so bot commits are never actually linted — this is about consistency, not a
  failing check.)
- **`@types/node` leads the runtime** — an open Dependabot PR bumps
  `@types/node` to 26 while the runtime is pinned to Node 24 (and the manifest
  still says `^20`). Types should **track** the runtime major, not lead it:
  pin to `^24` and `ignore:` majors beyond it.

---

## Formatting note

Prettier **intentionally ignores Markdown** (`*.md` in `.prettierignore`) —
docs are hand-formatted. The pnpm lockfile and generated Next.js output are
ignored too. So `pnpm format:check` failures are never about docs.

---

## Issues & decisions log

Running record of problems hit and calls made, newest first. (PR numbers are
the paper trail; see git history for the full diffs.)

- **2026-07 · Audit gate flip is manual** — declined an automated date-based
  switch to blocking; a tracking issue + deliberate edit beats a hardcoded
  date that can redden unrelated PRs (PR #43 review thread).
- **2026-07 · osv-scanner SARIF upload disabled** — requires GHAS/Code
  Security on private repos; misleading comments about it were fixed and an
  unnecessary `security-events` permission removed (commits `009f249`,
  `a3234e6`).
- **2026-07 · vite advisory GHSA-fx2h-pf6j-xcff** — dev-only, transitive via
  vitest; the reason the audit gate started non-blocking. Cleared by
  `vite >= 8.0.16`.
- **2026-07 · gitleaks hardening** — first CI run needed `pull-requests: read`;
  the allowlist regex was anchored; the pre-commit hook made fail-safe
  (PR #41).
- **2026-07 · commitlint type list** — `CI/CD` retired in favor of `ci`;
  `deps` added for dependency bumps (PR #40).
- **2026-07 · Native GitHub security features are GHAS-gated** on private
  repos (CodeQL, push protection, dependency review) — the stack standardizes
  on free OSS tools instead (gitleaks, osv-scanner, Semgrep planned), which
  also keeps the Phase 6 self-host option mechanical.
- **2026-06 · Playwright installed without `npm init playwright`** — the init
  command writes a `package-lock.json`, example tests, and its own CI workflow;
  installed manually instead (see [docs/playwright.md](playwright.md)).
- **2026-06 · README npm references removed** — the create-next-app scaffold
  docs said `npm`; this repo is pnpm-only.
