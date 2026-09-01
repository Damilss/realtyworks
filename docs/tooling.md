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
| Playwright E2E vertical slice (boots its own Supabase stack) | `.github/workflows/ci.yml` | PRs + pushes to `main`/`dev` |
| pgTAP RLS/write-guard suite (`db` job) | `.github/workflows/ci.yml` | PRs + pushes to `main`/`dev` |
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

### E2E auth loop (`e2e` job)

A second job runs **in parallel** with `verify`, on the same triggers. Chromium
is installed with `playwright install --with-deps chromium` and cached on
`~/.cache/ms-playwright` (keyed on the lockfile), and the HTML report uploads as
a `playwright-report` artifact (`if: !cancelled()`) for debugging.

**Since the Phase 3 auth loop landed (2026-07-27) this job boots a real
Supabase stack** — `supabase start -x …` → `db reset` → write `.env.local` from
`supabase status -o env` — and then boots the app (`pnpm dev`, via
`playwright.config.ts`'s `webServer`) and runs every spec in `tests/e2e/`
against it: smoke, `auth.spec.ts`, and — since the slice closed on
2026-08-03 — `work-orders.spec.ts` and `vendor-loop.spec.ts`. So CI now proves
the app *runs*, authenticates, and enforces RLS through a real session — not
just that `next build` compiles it.

The job is still **named** "E2E (Playwright auth loop)" even though it now runs
the whole slice. That is deliberate: branch protection matches required checks
by name, so renaming it silently drops any rule selecting the old name. Rename
it only alongside re-selecting the check in Settings → Branches.

Three consequences worth knowing before editing the job:

- **It deliberately sets no `NEXT_PUBLIC_SUPABASE_*` env.** It used to set
  placeholders, which were sufficient while nothing logged in (with no session
  cookie the proxy's refresh short-circuits before any network call). They had
  to be **removed**, not updated: process env outranks `.env.local` in Next, so
  a leftover placeholder silently wins over the values written from
  `supabase status`, and the app addresses a stack that isn't there — a
  connection error that reads like an application bug. **`verify` keeps its
  placeholders** and should: `next build` never executes the proxy, and the
  values exist there only so `next.config.ts` can prove the build environment
  is complete.
- **Its env-writing `grep` is an allowlist, not a filter.** `supabase status -o
  env` prints `SERVICE_ROLE_KEY` and `JWT_SECRET` too, and neither belongs in a
  file `next build` reads. `SECRET_KEY` *is* admitted deliberately and renamed
  by a `sed` to `SUPABASE_SECRET_KEY` (2026-08-03): the vendor invite and the
  attachment-metadata insert are service-role writes with no client grant, so
  `vendor-loop.spec.ts` cannot run without it. It is safe there only because it
  has no `NEXT_PUBLIC_` prefix and is therefore never inlined into the bundle —
  and it is a `sed` rather than a third `--override-name` because the CLI
  documents no override for that key, and a wrong one emits nothing rather than
  failing.
- **It is the slow job now.** Eight containers pulled cold, against `db`'s
  three — the `timeout-minutes: 20` backstop is the same as `db`'s and for the
  same reason, but the weight behind it is not.

The `-x` exclusion list **no longer mirrors the `db` job below, and must not be
synced to it.** This job drives the app over HTTP, so it genuinely needs Kong,
PostgREST and Realtime — the containers `db` now drops. What both jobs still
share is the rule about never excluding `storage-api`.

**The ignored names are gone (2026-08-25).** This list used to carry
`analytics`, `inbucket` and `functions`, none of which is a valid `-x` value (see
the trap under `db` below), so logflare booted on every run despite appearing
excluded. It is now
`studio,imgproxy,edge-runtime,logflare,vector`, and the correction landed
alongside issue #93 exactly as planned: the mailbox was the conditional part.
**Mailpit is now absent from the list on purpose.** With `[auth.email]
enable_confirmations` on, signup sends real mail and
`tests/e2e/auth.spec.ts` reads the confirmation link out of the mailbox
(`tests/e2e/mailbox.ts`), so the mail container is a dependency of this job.
That is what makes the count eight: postgres, gotrue, kong, postgrest, realtime,
storage-api, postgres-meta, mailpit. Details:
[playwright.md](playwright.md).

### Database suite (`db` job)

A third parallel job (issue #72) boots the local Supabase stack and runs the
pgTAP suite in `supabase/tests/` — the RLS policies and write guards that are
the database authorization boundary. Before it existed the suite ran only when
invoked by hand, so a policy regression could merge with every Node and E2E
check green.

It reuses `verify`'s Node 24 + pnpm prelude and the **pinned CLI
devDependency** (`pnpm exec supabase`), so CI runs the same version as local
rather than a floating action-installed one. Then: `supabase start` →
`supabase db reset` → `supabase test db`.

Three deliberate choices:

- **`-x` excludes containers the SQL suite never touches**
  (`studio,imgproxy,edge-runtime,logflare,vector,mailpit,postgrest,realtime,postgres-meta,kong`),
  trading image pulls for wall-clock. What boots is exactly three containers:
  Postgres, gotrue, and storage-api. **Never exclude `storage-api`** — it creates
  the `storage` schema that `20260717120800_create_storage_bucket.sql` writes its
  bucket and object policies into, so excluding it fails the migration outright.
  (`db` is not on the excludable list at all.) gotrue stays because the suite
  asserts on `auth.users`. Everything else is dead weight: `supabase test db`
  runs pg_prove against Postgres directly over 54322 and never makes an HTTP
  request, and the tests reference only `auth.*` and `storage.*`.

  Two traps, both found the hard way (2026-08-10):

  **The valid `-x` names are not the ones `--help` prints.** `supabase start
  --help` advertises `analytics`, `inbucket`, `functions`, `rest` and `meta`; the
  runtime validator accepts `logflare`, `mailpit`, `postgrest` and
  `postgres-meta`, and has no `functions` at all. A name from the wrong list is
  **silently ignored, not rejected** — so the original list's `analytics`,
  `inbucket` and `functions` entries did nothing, and logflare (930MB) plus
  mailpit (48MB) were pulled on every run despite appearing to be excluded. The
  authoritative list is the one the CLI echoes when a name misses: `edge-runtime,
  gotrue, imgproxy, kong, logflare, mailpit, postgres-meta, postgrest, realtime,
  storage-api, studio, supavisor, vector`. This also retires the 2026-08-03
  finding that `inbucket` was "still valid because `--help` lists it" — `--help`
  listing it is exactly the thing that misleads. Worth knowing when reading
  `docker ps`: the container is still *named* `supabase_inbucket_<project>`
  even though its image is `mailpit`, so the old name survives in three places
  (`--help`, the container name, and stale notes) and is correct in none of
  them.

  **`kong` and `postgrest` must be excluded together.** The CLI health-checks
  PostgREST *through* Kong (`HEAD 127.0.0.1:54321/rest-admin/v1/ready`), so
  dropping Kong on its own fails the boot with a connection refused and stops
  every container it just started.

  Net effect: ~6.2GB of images pulled → ~3.3GB, a **47% cut**. Verified locally
  before landing — 3 containers healthy, all 14 migrations applied, 94/94
  assertions passing.
- **`db reset` is redundant and kept anyway.** `start` already applies
  migrations and the seed; running reset asserts that the documented
  one-command known-good state actually works, and costs seconds once the
  containers are up.
- **No path filtering.** A policy regression can arrive via a migration, a
  `config.toml` change, or a CLI bump, so gating on changed paths would miss
  cases.

Cold image pulls still make `e2e` — eight containers to this job's three — the
slow job in the matrix; both keep `timeout-minutes: 20` as a backstop against a
container that never reaches healthy. A `docker ps -a` + `supabase status` step
runs `if: failure()` for triage.

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

**Clearing a transitive advisory — try a lockfile refresh first.** Three highs
landed at once on 2026-07-20 (GHSA-3jxr-9vmj-r5cp `brace-expansion` ×2 ranges,
GHSA-52cp-r559-cp3m `js-yaml`), all dev-only and all transitive under `eslint` /
`@commitlint` / `eslint-config-next`. No `overrides` and no manifest change were
needed: every patched version was already inside a range its parent declared
(`brace-expansion` 1.1.14→1.1.16 under `minimatch@3`, 5.0.6→5.0.7 under
`minimatch@10`, `js-yaml` 4.1.1→4.3.0), so the old versions were just stale
lockfile pins. `pnpm update <pkg> --depth Infinity` moved them and the diff
touched those three packages only.

Reach for `overrides` (in `pnpm-workspace.yaml` — pnpm 11 ignores the
`pnpm` field in package.json) **only** when the patched version falls outside
the parent's declared range, and prefer the range-scoped key form
(`"brace-expansion@<1.1.16": "1.1.16"`) so one major line's fix isn't forced
onto a consumer expecting another. If the package is an auto-installed peer,
neither works — declare it directly, per the vite case above.

**Both paths in one pass (2026-07-21).** Two highs landed together and split
across exactly that rule, which is why they're worth keeping as the worked
example:

| Advisory | Package | Patched | Parent's range | Fix |
|---|---|---|---|---|
| GHSA-v2hh-gcrm-f6hx | `fast-uri` 3.1.3 | `>=3.1.4` | `ajv` wants `^3.0.1` — **in range** | `pnpm update fast-uri --depth Infinity` |
| GHSA-f88m-g3jw-g9cj | `sharp` 0.34.5 | `>=0.35.0` | `next` wants `^0.34.5` — **out of range** | `overrides: sharp@<0.35.0` |

`fast-uri` was the `brace-expansion` case again: a stale pin, patched inside
ajv's range, cleared by a refresh with a 4-line lockfile diff and no manifest
change. `sharp` is the repo's **first real `overrides` entry** — it reaches the
tree as `next > sharp`, and next still declares `^0.34.5` as of **16.2.11**
(the current latest), so there is no upstream release to upgrade into. The
override deliberately forces past next's caret range; delete it once next's
floor reaches `>=0.35.0`.

Forcing a dependency past its parent's declared range is the case that actually
warrants verification, because nothing upstream has vouched for the pairing.
What was checked, and what's worth re-checking next time:

- `next` `require`s sharp with **no version guard** — `image-optimizer.js` does a
  bare `require('sharp')`, so nothing rejects 0.35 on sight.
- Every API that file touches still exists and runs on 0.35.3, exercised as a
  real pipeline: `concurrency()`, `rotate` → `resize` → `webp`/`avif`/`png`/
  `jpeg` → `toBuffer`, plus `metadata()`.
- The native binary resolves and encodes — sharp **0.35.3 on libvips 8.18.3**,
  the patched libvips the four CVEs called for. Note a transitive dep isn't at
  the root under pnpm's strict layout; resolve it from the parent
  (`require.resolve('sharp', {paths: [require.resolve('next/package.json')]})`),
  since a root `require('sharp')` fails with `MODULE_NOT_FOUND` whether or not
  the install is healthy.
- `@img/sharp-libvips-*` moved 1.2.4 → **1.3.2 for every platform** in the
  lockfile, `linux-x64` included — CI builds there, not on darwin-arm64.

**When the override *is* the blocker (2026-08-03).** Three advisories landed at
once — two high, one moderate — and every one was a follow-up to an advisory
this file already records:

| Advisory | Package | Patched | Parent's range | Fix |
|---|---|---|---|---|
| GHSA-7p8r-x3mc-p8w7 | `fast-uri` 3.1.4 | `>=3.1.5` | `ajv` wants `^3.0.1` — **in range** | `pnpm update fast-uri --depth Infinity` |
| GHSA-rgw5-rvv9-x895 | `brace-expansion` 5.0.8 | `>=5.0.9` | `minimatch@10` wants `^5.0.5` — **in range** | delete the stale override, then refresh |
| GHSA-fxqj-rqcc-2cmp | `postcss` 8.5.22 | `>=8.5.23` | `next` exact-pins 8.4.31 — **out of range** | raise the override floor to `postcss@<8.5.23: ^8.5.23` |

`fast-uri` was the stale-pin case for a third time — a refresh, no manifest
change. The other two carry the new lesson: **an override with an exact version
becomes the thing pinning the vulnerable release in place.**
`brace-expansion@<5.0.8: 5.0.8` was written when 5.0.8 was the only patched
build. GHSA-rgw5-rvv9-x895 then landed as a *bypass of that very fix*, and
because the key `<5.0.8` no longer matched and the value was an exact `5.0.8`,
`pnpm update --depth Infinity` had nothing it was allowed to move. Every
consumer declares `^5.0.5`, which 5.0.9 satisfies, so the override had outlived
its reason: deleting it and refreshing was the fix, not bumping it. Its
companion `minimatch@<9: ^10.0.0` stays — that one is still out of range and is
what keeps the CJS `minimatch@3` line off 5.x's ESM-only export.

Two habits follow. Prefer a **range** value (`^5.0.9`) over an exact one unless
the exact version is genuinely the only patched build, so the next patch can
flow in on a refresh. And when an advisory names a package already in
`overrides`, re-check whether the override is still *needed* before raising it —
if the patch is in the parent's range, the entry should be deleted, not bumped.

**A cleared advisory does not stay cleared (2026-08-07, then 2026-08-24).** Two
more rounds, both stale pins, and it is the repetition that carries the lesson:

| Advisory | Package | Patched | Parent's range | Fix |
|---|---|---|---|---|
| GHSA-5p4m-2wfm-xmqj | `js-yaml` 4.3.0 | `>=4.3.1` | `cosmiconfig` `^4.1.0` / `@eslint/eslintrc` `^4.1.1` — **in range** | `pnpm update js-yaml --depth Infinity` |
| GHSA-2v37-7h3g-55p8 | `nanoid` 3.3.16 | `>=3.3.17` | `postcss` wants `^3.3.16` — **in range** | `pnpm update nanoid --depth Infinity` |
| GHSA-2v37-7h3g-55p8 *(again)* | `nanoid` 3.3.17 | `>=3.3.18` | `postcss` wants `^3.3.16` — **in range** | `pnpm update nanoid --depth Infinity` |

The third row is the **same advisory** as the second, seventeen days later
(issue #110). Nothing regressed in the tree and nothing of ours changed: the
advisory's **patched floor moved 3.3.17 → 3.3.18**, so the exact version that
closed it became the flagged one. An advisory is a moving target rather than a
fact with a clearance date, and the blocking audit step is the only thing in the
stack that notices — which means a red gate on a dependency nobody touched is an
expected shape here, not evidence that someone broke something. Re-run the
refresh before concluding an override is needed: the parent's declared range is
what decides, and `^3.3.16` admits the new floor just as it admitted the old one.

Two reading habits from the same round, both cheap and both easy to get
backwards. **Verify in `pnpm-lock.yaml`, not `node_modules`** — CI installs with
`--frozen-lockfile`, so the lockfile is what it actually reads, and pnpm does
not prune its virtual store on update, leaving stale `nanoid@3.3.16` directories
under `node_modules/.pnpm` that are unreferenced rather than live. And **the
audit table's path count is paths, not copies**: nanoid's "5 paths" is one
deduped copy under `postcss`, shared by next / `@tailwindcss/postcss` / vite,
which `pnpm why nanoid` reports as "Found 1 version".

### Why the gate requires pnpm 11 (`packageManager` pin)

npm retired the legacy audit endpoints (`/-/npm/v1/security/audits` and
`…/audits/quick`), which now return **410 Gone** — a brownout from 2026-04-15,
fully retired 2026-07-15. The endpoints flap during a brownout, so a green run
proves nothing; the failure mode is an intermittently red PR, not a clean break.
pnpm ≤ 10 only ever calls the retired endpoints, so `pnpm audit` on the old pin
was unfixable — no flag, no config. The replacement is
`/-/npm/v1/security/advisories/bulk`, adopted in
[pnpm#11268](https://github.com/pnpm/pnpm/pull/11268) and shipped in **pnpm 11**
only: the bulk response drops fields the old contract returned, so it was a
breaking change and was **never backported to 9.x or 10.x**
([pnpm#11265](https://github.com/pnpm/pnpm/issues/11265)). Hence the jump
`pnpm@9.15.9 → pnpm@11.13.1`. Do not pin back below 11 without also replacing
this gate — the lockfile itself is unaffected (still `lockfileVersion: 9.0`).

**Decision:** upgrade rather than `--ignore-registry-errors`. That flag greens
the step on *any* registry error, which converts a blocking security gate into
one that silently passes exactly when it fails to check anything — strictly
worse than no gate, because it still reads green. Dropping `pnpm audit` for
osv-scanner alone was the other option; kept both per the belt-and-suspenders
rationale above, and the upgrade is cheapest now (Phase 1, three runtime deps).

**Fallout — dependency build scripts are now opt-in.** pnpm 10 stopped running
dependency install scripts by default and pnpm 11 made an unreviewed build a
hard **error**, so this is not cosmetic: `sharp` (unbuilt → `pnpm build` fails),
`unrs-resolver` (unbuilt → `pnpm lint` fails), and `supabase` (its postinstall
fetches the platform CLI binary — Phase 2) must be allowed explicitly.
pnpm 11 also **stopped reading the `pnpm` field in package.json**; settings moved
to `pnpm-workspace.yaml` (present at the repo root for exactly this reason, and
its `allowBuilds` replaces v10's `onlyBuiltDependencies`). Anything not listed
there is blocked by default — that default is the supply-chain win, so add
entries deliberately, one reviewed package at a time.

Long form — including why a *passing* local `pnpm audit` proved nothing during
the brownout: [`reports/2026-07-16-pnpm-audit-endpoint-retired.md`](reports/2026-07-16-pnpm-audit-endpoint-retired.md).

---

## Secret scanning (gitleaks)

Two layers (issue #19, PR #41):

1. **Pre-commit** (above) — catches a secret before it ever enters history.
   Best-effort: skipped when the binary is missing.
2. **CI** (`.github/workflows/security.yml`) — `gitleaks/gitleaks-action`
   (SHA-pinned, v2.3.9) scans the **full git history** (`fetch-depth: 0`) on
   every PR and push to `main`/`dev`. This is the authoritative layer.

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
- **Container image is digest-pinned** (`semgrep/semgrep@sha256:…` with a
  version comment). This reverses the original "deliberately unpinned" call:
  the mutable-tag risk won. The tradeoff is real — Dependabot only bumps
  `uses:` references, not `container:` images, so this pin is bumped
  **manually** when upgrading Semgrep; rulesets are still fetched from the
  registry at scan time either way.

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

**What it does not cover, on the evidence (2026-08-24).** Neither nanoid
clearance arrived as a Dependabot security PR — both were transitive and
lockfile-only (no manifest entry to bump), and the red `pnpm audit` step was the
notification both times. Grouped weekly version updates are what this config
buys; a transitive advisory reaching us before CI does is not something to plan
around. Open question, filed in [`backlog.md`](backlog.md): whether that is the
lockfile-only shape or the moved floor being a revision rather than a new
advisory.

### Moving Node to a new major (do it in this order)

The runtime constraints and the types pin are separate settings. Bump both
**runtime constraints first**, then the types — bumping only `@types/node`
recreates the exact mismatch this rule exists to prevent.

1. **`.nvmrc`** → the new major (e.g. `24` → `26`). CI reads it via
   `node-version-file: .nvmrc` in **both** the `verify` and `e2e` jobs
   (`ci.yml`), and `nvm use` reads it locally.
2. **`package.json` `engines.node`** → the matching major range (e.g.
   `>=24 <25` → `>=26 <27`). Package managers read this constraint and warn
   when a local install uses the wrong Node major.
3. **`package.json`** → `@types/node` to the matching major (`^24` → `^26`),
   then `pnpm install`.
4. **Leave the Dependabot `ignore:` rule alone.** It drops any `@types/node`
   major regardless of number, so it keeps working on the new major with no
   edit. Removing it would let the types start leading the runtime again.

Verify with `pnpm typecheck` + `pnpm build` on the new major before pushing —
that pair is what caught the `^20`-types-on-Node-24 skew in the first place.

---

## Formatting note

Prettier **intentionally ignores Markdown** (`*.md` in `.prettierignore`) —
docs are hand-formatted. The pnpm lockfile and generated Next.js output are
ignored too. So `pnpm format:check` failures are never about docs.

**`.editorconfig` is the layer below Prettier, and nothing enforces it.**
It sets UTF-8, LF, two-space indent, a final newline, and trailing-whitespace
trimming for every file, so an editor gets the house style right in file types
Prettier never sees — SQL migrations, `.env.example`, `.nvmrc`, shell scripts,
the Husky hooks. There is no CI step for it and there is not meant to be: it
steers editors as you type, while Prettier remains the gate for the extensions
it owns. Where the two overlap they already agree, and `pnpm format:check`
stays authoritative if they ever drift.

Two overrides earn their place. **`[*.md] trim_trailing_whitespace = false`** —
Markdown's hard line break *is* two trailing spaces, so trimming would silently
rewrite docs; this is also why the setting cannot simply mirror the global
block. **`[*.py] indent_size = 4`** covers the one Python file in the repo,
`.github/scripts/semgrep-annotations.py` (PEP 8, not the JS two). Prettier
formats neither extension, so in both cases `.editorconfig` is the only thing
expressing the convention at all.

**YAML is the opposite case, and it has a blind spot.** Prettier *does* format
`*.yml`/`*.yaml` (only `pnpm-lock.yaml` is exempt), and its glob traverses
dot-directories — that is why `supabase/.temp/` needs an explicit ignore entry,
and it means everything under `.github/` is checked. But `lint-staged` in
`package.json` covers `*.{ts,tsx,json,css,md}` and **not `*.yml`**, so a
mis-formatted workflow or issue-form file passes the pre-commit hook and only
fails in CI. Run `pnpm format` after touching any YAML.

Useful side effect: Prettier is the repo's YAML parser. A syntax error in an
issue form surfaces as a Prettier parse error, so `pnpm format:check` doubles as
a validity check — there is no `yamllint` or `actionlint` here, and neither is
worth adding (`actionlint` doesn't understand the issue-forms schema anyway).

---

## Issues & decisions log

Running record of problems hit and calls made, newest first. (PR numbers are
the paper trail; see git history for the full diffs.)

- **2026-08 · a cleared advisory came back on its own** (issue #110) —
  GHSA-2v37-7h3g-55p8's patched floor moved 3.3.17 → 3.3.18, so the blocking
  audit step went red on every branch seventeen days after that same advisory
  was cleared, with no dependency change of ours in between. Another
  `pnpm update nanoid --depth Infinity` was the whole fix — still inside
  `postcss`'s declared `^3.3.16`, so still no override. Worth recording because
  the instinct on a red gate is to hunt for what *we* changed; here the answer
  was that the advisory moved. Detail in the dependency-gate section above.
- **2026-08 · the `e2e` job carries a real secret now** — closing the vertical
  slice put two service-role writes in the app (the vendor invite and the
  attachment-metadata insert), so the job's `.env.local` step gained
  `SECRET_KEY`, renamed to `SUPABASE_SECRET_KEY` by a `sed`. The grep stayed an
  **allowlist** rather than becoming a filter, which is the whole safety
  argument: `SERVICE_ROLE_KEY` and `JWT_SECRET` are still excluded by not being
  named, so the failure mode of a future CLI field is "missing", not "leaked".
  The same command is what the README and `CONTRIBUTING.md` now tell you to run
  locally, so there is one recipe rather than two that drift. Related: the job
  runs the whole slice but keeps the name "E2E (Playwright auth loop)", because
  branch protection matches required checks by name.
- **2026-07 · `e2e` job placeholders removed, not updated** — the job now boots
  a real Supabase stack because the auth-loop specs sign in. The non-obvious
  half was deleting its `NEXT_PUBLIC_SUPABASE_*` env: **process env takes
  precedence over `.env.local`**, so leaving placeholders there would have
  outranked the values written from `supabase status` and pointed the app at
  nothing, failing as a network error that reads like an application bug.
  Playwright's `baseURL` also moved `localhost` → `127.0.0.1` to match
  `[auth] site_url` (cookies are per-host, so an auth redirect across the two
  strands the session), with a matching `allowedDevOrigins` in
  `next.config.ts`. Detail: [playwright.md](playwright.md).
- **2026-07 · CODEOWNERS is a record, not a required review** (issue #31) —
  added `.github/CODEOWNERS` (`* @Damilss`) with **"Require review from Code
  Owners" deliberately left off**. GitHub never requests a review from a PR's
  own author, so a solo code owner can never satisfy the rule on their own PR;
  enabling it would make every self-authored merge an admin override and turn
  branch protection into noise. The one live effect is a review request on each
  Dependabot PR (author `dependabot[bot]`, so the owner *is* requested).
  Two adjacent gotchas from the same work. **Every template renders from the
  default branch only** — issue forms, `config.yml`, *and*
  `pull_request_template.md` alike do nothing while they sit on `dev`
  ("templates are available to collaborators when they are merged into the
  repository's default branch"). `CODEOWNERS` is the one exception in this set
  and works the other way round: it is read from a PR's **base** branch, so it
  takes effect on `dev` a merge before the templates do. Second, a label named
  in a form that doesn't exist in the repo is **silently dropped** — the issue
  opens unlabeled with no error anywhere.
- **2026-07 · Private vulnerability reporting is unavailable here** (issue #31)
  — GitHub's private vulnerability reporting *and* repository security
  advisories are both public-repository features ("Owners and administrators of
  public repositories can enable private vulnerability reporting"). This repo is
  private, so the Security tab offers no intake path — the same GHAS-on-private
  wall as CodeQL, push protection, and dependency review. `SECURITY.md` uses an
  email channel instead and records the two switch-over triggers: the repo going
  public, or issue #74 filling the `TOS.md` contact placeholder.
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
- **2026-07 · sharp forced past next's declared range** (GHSA-f88m-g3jw-g9cj) —
  the libvips CVEs are patched in sharp `>=0.35.0`, but `next` declares
  `sharp: ^0.34.5` and still does at 16.2.11, so waiting for upstream wasn't an
  option. First real `overrides` entry in `pnpm-workspace.yaml`, range-scoped
  (`sharp@<0.35.0`). Verified rather than assumed: next has no sharp version
  guard, and every optimizer API works on 0.35.3 / libvips 8.18.3. The
  same-day `fast-uri` high needed no override — patched in ajv's range, so a
  lockfile refresh cleared it. Both in the dependency-gate section above.
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
