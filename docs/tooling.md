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
| Lint → format → typecheck → test → build | `.github/workflows/ci.yml` | PRs + pushes to `main`/`dev` |
| `pnpm audit` dependency gate | `.github/workflows/ci.yml` | PRs + pushes to `main`/`dev` |
| Playwright E2E smoke test | `.github/workflows/ci.yml` | PRs + pushes to `main`/`dev` |
| gitleaks full-history scan | `.github/workflows/security.yml` | PRs + pushes to `main`/`dev` |
| Semgrep SAST scan | `.github/workflows/security.yml` | PRs + pushes to `main`/`dev` |
| osv-scanner lockfile CVE scan | `.github/workflows/osv-scanner.yml` | weekly + PRs into `main` + manual |
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
build chore ci deps docs feat fix perf refactor revert style test wip
```

**Decision (PR #40):** the default type list is overridden in two ways —

- `deps` **added** — used for dependency bumps, and what the Dependabot commit
  prefix should be set to (see [Dependabot](#dependabot) below).
- `CI/CD` **retired** — early history used a nonstandard `CI/CD(...)` type,
  which the standard list rejects. New commits use `ci`. Old commits stay as
  they are; commitlint only checks new ones.

`wip` was added later (this change, not PR #40) for local work-in-progress
checkpoints, so a `wip:` save doesn't need `--no-verify`. We merge with merge
commits, so an un-squashed `wip` commit persists in `main`'s history — tidy
them before merging if you don't want the noise.

The config uses a named (not anonymous) default export to keep ESLint's
`import/no-anonymous-default-export` happy.

---

## CI — `.github/workflows/ci.yml`

Runs on PRs targeting `main`/`dev` and pushes to `main`/`dev` (the `dev → main`
integration flow — see the "Extend triggers to `dev`" note below).

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
first. Any failed step fails the job (and the PR check) — including the audit
step, now that it is blocking (next section).

The **unit tests** step runs Vitest under a **happy-dom** DOM environment with
React Testing Library (jest-dom matchers + `user-event`), so components — not
just plain TS — are testable. Setup rationale is in the decisions log below.

Reproduce the gate locally (everything but the audit step):

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

Add `pnpm audit --audit-level=high` to preview the audit step too.

### E2E smoke test (`e2e` job)

A second job runs **in parallel** with `verify`, on the same triggers. It boots
the app (`pnpm dev`, via `playwright.config.ts`'s `webServer`) and runs the
single Playwright smoke spec (`tests/e2e/smoke.spec.ts`) — so CI proves the app
*runs*, not just that `next build` compiles it. Chromium is installed with
`playwright install --with-deps chromium` and cached on `~/.cache/ms-playwright`
(keyed on the lockfile), and the HTML report uploads as a `playwright-report`
artifact (`if: !cancelled()`) for debugging. Only the smoke spec runs here; real
flows arrive with the Phase 3 vertical slice. Details: [playwright.md](playwright.md).

### Dependency vulnerability gate (`pnpm audit`)

The final CI step runs `pnpm audit --audit-level=high` (issue #20, PR #43):
fails on any known high/critical advisory in the dependency tree.

**Current state: blocking.** A high/critical advisory fails the step, which
fails the PR. Moderate/low advisories stay below the `--audit-level=high`
threshold and don't gate. Landed non-blocking (`continue-on-error: true`) so
pre-existing advisories could be triaged without reddening every PR; flipped to
blocking once they were cleared.

**Decision:** the flip to blocking was **manual, not date-based**. A review
suggestion proposed switching automatically on a hardcoded date; declined —
a date-triggered flip can redden an unrelated PR with no warning, and a
hardcoded date lies the moment the triage slips. A tracking issue was the
"don't forget" mechanism, and flipping was a deliberate, reviewed edit
(delete `continue-on-error: true`, rewrite the comment).

**Advisory cleared to enable the flip:** GHSA-fx2h-pf6j-xcff
(`vite`, `server.fs.deny` bypass; dev-only, pulled in transitively as a peer of
`vitest`), patched in `vite >= 8.0.16`. Cleared by pinning `vite` to `^8.0.16`
(resolves to 8.1.3) as a **direct `devDependency`**. This looks odd — we don't
import vite — but it's deliberate: `vitest` requires vite as an
**auto-installed peer**, and pnpm `overrides` do **not** govern auto-installed
peers (they rewrite the requirement but the peer installer keeps resolving the
old version). Declaring vite directly is the mechanism that actually controls
the resolved version. Remove the direct dependency once `vitest` requires
`vite >= 8.0.16` on its own.

---

## Secret scanning (gitleaks)

Two layers (issue #19, PR #41):

1. **Pre-commit** (above) — catches a secret before it ever enters history.
   Best-effort: skipped when the binary is missing.
2. **CI** (`.github/workflows/security.yml`) — `gitleaks/gitleaks-action@v2`
   scans the **full git history** (`fetch-depth: 0`) on every PR and push to
   `main`. This is the authoritative layer.

Permissions are least-privilege: the workflow grants `contents: read`, and the
gitleaks **job** adds `pull-requests: read` because on PR events the action
calls `GET /pulls/:n/commits` (discovered when the first run failed without
it — PR #41). The semgrep job (next section) shares the workflow but not the
extra permission.

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

## SAST (Semgrep OSS)

`semgrep` job in `.github/workflows/security.yml` (issue #24) — static
analysis on every PR and push to `main`/`dev`, using the official `semgrep/semgrep`
container and four registry rulesets: `p/typescript`, `p/react`, `p/nextjs`,
`p/owasp-top-ten`.

- **Semgrep OSS, not CodeQL** — CodeQL needs GHAS on private repos (see the
  decisions log). Swap to CodeQL later if the repo goes public or GHAS is
  bought.
- **Blocking from day one** (`--error`: any finding fails the job). Unlike the
  audit gate there was no pre-existing backlog: the first scan's findings
  (below) were fixed in the same PR, so the gate landed green.
- **Findings surface as PR annotations, not SARIF.** SARIF upload to the
  Security tab needs GHAS on private repos (same reason osv-scanner disables
  it). Instead the scan writes JSON (`--json-output`, text still goes to the
  job log) and `.github/scripts/semgrep-annotations.py` converts each finding
  into an `::error` / `::warning` / `::notice` workflow command, which GitHub
  renders as annotations for free. The annotate step runs
  `if: ${{ !cancelled() }}` so it still runs when the scan step fails — which
  is exactly when there are findings to annotate.
- **Container image is deliberately unpinned** (`semgrep/semgrep`, latest):
  Dependabot only bumps `uses:` references, not `container:` images, so a pin
  would go stale silently — and rulesets are fetched from the registry at scan
  time anyway, so pinning the CLI buys little reproducibility.

**The first scan flagged our own CI config** (8 findings, all fixed in the
same PR):

- `github-actions-mutable-action-tag` — a `uses: …@v4`-style tag can be
  silently repointed by the action owner (the trivy-action compromise
  pattern). All step-level action references are now **pinned to full commit
  SHAs** with a `# vX.Y.Z` comment; Dependabot bumps SHA pins just like tags.
- `dependabot-missing-cooldown` — `dependabot.yml` now waits 7 days
  (`cooldown.default-days`) before proposing a newly published version;
  compromised releases are usually caught within days.

Run the same scan locally:

```bash
pipx run semgrep scan --config p/typescript --config p/react \
  --config p/nextjs --config p/owasp-top-ten --error
```

---

## Lockfile CVE scan (osv-scanner)

`.github/workflows/osv-scanner.yml` — weekly scheduled scan (Mondays 12:30
UTC) of the lockfile against the [OSV](https://osv.dev) database, plus a scan on
every **PR into `main`** (so lockfile changes accumulating on `dev` get an OSV
pass before they merge) and `workflow_dispatch` for manual runs. The schedule +
dispatch triggers only work from the copy on `main` (a GitHub scheduling rule —
branch copies don't run); the `pull_request` trigger likewise reads its config
from the base branch (`main`).

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
  versions (the osv-scanner tag and the SHA-pinned step actions).

Both ecosystems set `cooldown.default-days: 7`: Dependabot waits a week before
proposing a newly published version, so a compromised release has time to be
caught and yanked first (flagged by the Semgrep gate — issue #24).

Tuning applied (issue #23):

- **Grouped PRs** — bumps collapse into a couple of PRs per run instead of one
  per dependency (~11 at last count). npm splits into `npm-production` /
  `npm-development` groups, github-actions into one; each group bundles
  major+minor+patch. A breaking major can hold its group PR red — accepted for
  this small solo dep set, and the prod/dev split keeps a sensitive prod major
  (React/Next) out of the dev-tooling PR.
- **House commit prefix** — `commit-message.prefix` (and `prefix-development`
  for npm) is `deps`, so bots emit `deps: …` rather than the default
  `chore(deps)`. commitlint is hook-only, so bot commits are never actually
  linted — this is about a consistent history, not a failing check.
- **`dependencies` label** on every Dependabot PR.
- **`@types/node` tracks the runtime, never leads it** — the manifest pins
  `^24` (matching Node 24 in `.nvmrc`) and the npm `ignore:` rule
  (`update-types: ["version-update:semver-major"]`) drops *any* `@types/node`
  major bump, so Dependabot never crosses a major on its own — it's
  version-agnostic, not tied to `24`.

### Moving Node to a new major (do it in this order)

The runtime pin and the types pin are two different files. Bump the **runtime
first**, then the types — bumping only `@types/node` recreates the exact
mismatch this rule exists to prevent.

1. **`.nvmrc`** → the new major (e.g. `24` → `26`). This is the runtime, and
   it is the *only* runtime pin in the repo: CI reads it via
   `node-version-file: .nvmrc` in **both** the `verify` and `e2e` jobs
   (`ci.yml`), and `nvm use` reads it locally. There is no `engines` field in
   `package.json` and no Dockerfile yet — if either is added later, they become
   runtime pins too and belong in this step.
2. **`package.json`** → `@types/node` to the matching major (`^24` → `^26`),
   then `pnpm install`.
3. **Leave the Dependabot `ignore:` rule alone.** It drops any `@types/node`
   major regardless of number, so it keeps working on the new major with no
   edit. Removing it would let the types start leading the runtime again.

Verify with `pnpm typecheck` + `pnpm build` on the new major before pushing —
that pair is what caught the `^20`-types-on-Node-24 skew in the first place.

---

## Formatting note

Prettier **intentionally ignores Markdown** (`*.md` in `.prettierignore`) —
docs are hand-formatted. The pnpm lockfile and generated Next.js output are
ignored too. So `pnpm format:check` failures are never about docs.

---

## Issues & decisions log

Running record of problems hit and calls made, newest first. (PR numbers are
the paper trail; see git history for the full diffs.)

- **2026-07 · pnpm store untracked** — `.pnpm-store/v11/index.db` (pnpm's local
  content-addressable store index) had been committed by accident. Added
  `.pnpm-store` to `.gitignore` and `git rm --cached`'d the binary so it stops
  riding along in the tree. The store is a per-machine build artifact —
  regenerated on `pnpm install` — and never belongs in git.
- **2026-07 · Unit-test DOM harness** — added **happy-dom** + React Testing
  Library (`@testing-library/react` + its `@testing-library/dom` peer +
  `jest-dom` + `user-event`) so components are testable, not just plain TS.
  `vitest.config.ts` uses Vite 8's **native** `resolve.tsconfigPaths` for the
  `@/*` alias — dropped the `vite-tsconfig-paths` plugin the backlog first
  specced, since Vite 8 resolves tsconfig paths in core. `globals: true` for
  RTL's auto-cleanup; `vitest.d.ts` types the globals (ESLint-ignored like
  `next-env.d.ts`). Rides the existing `verify` steps — no `ci.yml` change.
- **2026-07 · Audit gate flipped to blocking** — removed
  `continue-on-error: true` from the `pnpm audit` step so a high/critical
  advisory now fails the PR. Required clearing GHSA-fx2h-pf6j-xcff first: pnpm
  `overrides` can't move an **auto-installed peer** (vite via vitest), so vite
  was pinned to `^8.0.16` as a **direct `devDependency`** instead. See the
  dependency-gate section above.
- **2026-07 · Playwright smoke test wired into CI** — the existing
  `smoke.spec.ts` now runs as a parallel `e2e` job in `ci.yml`, closing the
  "builds but crashes on boot" gap (`next build` proved compilation only).
  Foundations work, pulled forward from the Phase 3/4 slot in CLAUDE.md §4;
  test scope unchanged (one spec, Chromium only). Ran against the dev server
  (Option A) — the prod-build variant (`next build && next start`) is deferred.
  New `uses:` refs are SHA-pinned per the Semgrep `github-actions-mutable-action-tag`
  gate. Making it a *required* check on `main` is a manual branch-protection
  edit (the check must run once before it's selectable).
- **2026-07 · Semgrep SAST gate added** (issue #24) — four registry rulesets
  on every PR/push, blocking from day one; findings render as PR annotations
  via workflow commands because SARIF upload is GHAS-gated. Its first run
  flagged our own CI config: step actions are now SHA-pinned
  (`github-actions-mutable-action-tag`) and Dependabot got a 7-day cooldown
  (`dependabot-missing-cooldown`).
- **2026-07 · Audit gate flip is manual** — declined an automated date-based
  switch to blocking; a tracking issue + deliberate edit beats a hardcoded
  date that can redden unrelated PRs (PR #43 review thread).
- **2026-07 · osv-scanner SARIF upload disabled** — requires GHAS/Code
  Security on private repos; misleading comments about it were fixed and an
  unnecessary `security-events` permission removed (commits `009f249`,
  `a3234e6`).
- **2026-07 · vite advisory GHSA-fx2h-pf6j-xcff** — dev-only, transitive via
  vitest; the reason the audit gate started non-blocking. Cleared by pinning
  `vite ^8.0.16` as a direct devDependency (peer overrides don't work), which
  unblocked the flip to blocking above.
- **2026-07 · gitleaks hardening** — first CI run needed `pull-requests: read`;
  the allowlist regex was anchored; the pre-commit hook made fail-safe
  (PR #41).
- **2026-07 · commitlint type list** — `CI/CD` retired in favor of `ci`;
  `deps` added for dependency bumps (PR #40).
- **2026-07 · Native GitHub security features are GHAS-gated** on private
  repos (CodeQL, push protection, dependency review) — the stack standardizes
  on free OSS tools instead (gitleaks, osv-scanner, Semgrep planned), which
  also keeps the Phase 7 self-host option mechanical.
- **2026-06 · Playwright installed without `npm init playwright`** — the init
  command writes a `package-lock.json`, example tests, and its own CI workflow;
  installed manually instead (see [docs/playwright.md](playwright.md)).
- **2026-06 · README npm references removed** — the create-next-app scaffold
  docs said `npm`; this repo is pnpm-only.
