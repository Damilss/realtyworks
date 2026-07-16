# Report: npm retired the audit endpoint — `pnpm audit` needs pnpm 11 or nothing

| | |
| --- | --- |
| **Date** | 2026-07-16 |
| **Area** | dependencies (pnpm) / CI / security gate |
| **Cost** | ~45m. The diagnosis was fast — the 410 body names its own cause. The time went into (a) not trusting a local green, and (b) the pnpm 10→11 fallout: three wrong turns after the version bump, none of them about auditing. |
| **Status** | Resolved |
| **Commits / PRs** | Staged, uncommitted at time of writing (`fix(ci): upgrade pnpm 9.15.9 → 11.13.1 to unblock the audit gate`) |
| **Issues** | #20 (the audit gate this breaks) |
| **Tags** | pnpm, pnpm-11, audit, npm-registry, advisories-bulk, brownout, allowBuilds, onlyBuiltDependencies, build-scripts, sharp, unrs-resolver, packageManager, CI |
| **See also** | [`2026-07-06-vite-audit-gate-peer-dep.md`](2026-07-06-vite-audit-gate-peer-dep.md) (same gate, previous fight) · [`../tooling.md`](../tooling.md) §"Why the gate requires pnpm 11" · [pnpm#11265](https://github.com/pnpm/pnpm/issues/11265) |

## TL;DR

CI's `pnpm audit --audit-level=high` started failing with a **410** — npm retired
the legacy audit endpoints. There is no config fix: pnpm hardcodes the endpoint,
and the replacement (`/-/npm/v1/security/advisories/bulk`) shipped in **pnpm 11
only** — it was a breaking response-shape change, never backported to 9.x or 10.x.
So the real choice was *upgrade or drop the gate*. Bumped `packageManager`
9.15.9 → 11.13.1. The audit fix itself was one line; the cost was pnpm 10/11's
unrelated breaking changes riding along with it.

## What I was doing

Nothing. This one arrived on its own — a red PR check on work that had nothing to
do with dependencies. That's the tell that matters: **the failure was external and
time-based**, not caused by anything in the diff.

## The roadbump

```
ERR_PNPM_AUDIT_BAD_RESPONSE  The audit endpoint (at https://registry.npmjs.org/-/npm/v1/security/audits)
responded with 410: {"error":"This endpoint is being retired. Use the bulk advisory endpoint instead.
See the following docs for more info: https://api-docs.npmjs.com/#tag/Audit"}
Error: Process completed with exit code 1.
```

Then the genuinely confusing part: **it passed locally.** Same command, same
lockfile, exit 0, three advisories reported. If I'd trusted that, I'd have called
it CI flake and hit rerun.

## What I tried (and why it didn't work)

1. **Reproduce locally: `pnpm audit --audit-level=high`** — **passed, exit 0.**
   Not a fluke and not stale cache. The retirement rolled out as a *brownout*: the
   endpoint flaps by region/POP, so my machine got a 200 while GitHub's runners got
   410. Upstream comments are literally "works again!" / "broken again XD" minutes
   apart. A local green here is evidence of nothing.
2. **`curl` the endpoints directly** — all three (`/audits`, `/audits/quick`,
   `/advisories/bulk`) returned **200** from my IP, including the "retired" ones.
   Confirmed the brownout theory, and killed any hope of reproducing locally.
3. **Test pnpm 11 by running `pnpm audit` under it** — passed, but **proved
   nothing**: the legacy endpoint still answers 200 here, so both old and new pnpm
   go green regardless of which endpoint they call. Had to verify a different way
   (below).
4. **`onlyBuiltDependencies` in package.json's `pnpm` field** (the pnpm 10 answer)
   — silently ignored:
   `[WARN] The "pnpm" field in package.json is no longer read by pnpm.`
   pnpm 11 moved settings out of package.json entirely.
5. **`pnpm run lint` after the bump** — failed with a 10-frame `execa` stack trace
   pointing into pnpm's own bundle. Useless on its face. The real cause was buried
   at the *top* of the output, not the bottom: `ERR_PNPM_IGNORED_BUILDS`. pnpm runs
   an implicit deps-status install before scripts, and that's what was dying.
6. **`pnpm install --frozen-lockfile` over a pnpm 9 `node_modules`** —
   `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. pnpm 11 wants to wipe and relay
   out `node_modules`, and won't do it unattended. Local-only; CI installs fresh.

## Root cause

Two independent things, stacked — which is why the fix is bigger than the bug.

**1. The audit break.** npm retired `/-/npm/v1/security/audits` and
`…/audits/quick` (brownout from 2026-04-15, full retirement **2026-07-15** — this
failure is one day after). pnpm ≤ 10 calls *only* those endpoints, with no flag or
setting to redirect it. The replacement bulk endpoint returns a **smaller
response** — no `cves`, `overview`, `recommendation`, `references`, and CVE-based
filtering becomes GHSA-based — so adopting it was a breaking change to pnpm's own
public types. That's why it landed in **pnpm 11 only** ([pnpm#11268]) and was
explicitly **not** backported: maintainer's call was "switch to v11, it's stable."
An intermittently-410 endpoint that is *fully* dead as of yesterday means pnpm 9
here was never going to recover on its own.

**2. The upgrade fallout** (nothing to do with auditing, everything to do with
crossing two majors). pnpm 10 made dependency build scripts **opt-in**; pnpm 11
made an unreviewed build a **hard error**, and **stopped reading the `pnpm` field
in package.json** — settings now live in `pnpm-workspace.yaml`, where
`onlyBuiltDependencies` is renamed **`allowBuilds`**. So the version bump alone
left `sharp` unbuilt (breaks `pnpm build`) and `unrs-resolver` unbuilt (breaks
`pnpm lint`) — two *different* CI steps failing for a reason that reads nothing
like "your package manager changed."

## The fix

Bump the pin; move the build-script allowlist to its new home.

```jsonc
// package.json
"packageManager": "pnpm@11.13.1"   // was pnpm@9.15.9
```

```yaml
# pnpm-workspace.yaml — NEW. pnpm 11 no longer reads the "pnpm" field in package.json.
allowBuilds:
  sharp: true          # Next.js image optimization; `next build` needs it
  unrs-resolver: true  # eslint-config-next's resolver; `pnpm lint` needs it
```

Since a passing `pnpm audit` proves nothing while the brownout flaps, I verified
the endpoint **from the shipped bundle** instead — the only check here that
actually discriminates:

```bash
grep -o "security/advisories/bulk\|security/audits/quick\|security/audits" \
  "$(find ~/.npm/_npx -path '*pnpm/dist/pnpm.mjs' | head -1)" | sort | uniq -c
#    1 security/advisories/bulk      ← and zero hits for the retired endpoints
```

Then the full gate on the real repo under 11.13.1: `lint` · `format:check` ·
`typecheck` · `test` · `build` all pass, and `audit --audit-level=high` → **exit
0** (3 advisories: 1 low + 2 moderate, below the threshold — the documented
intent).

Two things that could have been ugly and weren't: **the lockfile is untouched**
(still `lockfileVersion: 9.0`; `--frozen-lockfile` passes unchanged), and CI needs
no edit — `pnpm/action-setup` reads `packageManager`.

> Local-only: pnpm 9 does **not** self-manage versions (`manage-package-manager-versions`
> defaults false on v9, true on v10+), so plain `pnpm` keeps running as 9.15.9 even
> with the new pin — no warning. Needs `pnpm self-update 11.13.1` or corepack.
> Wipe `node_modules` first; pnpm 11 won't relay it out without a TTY.

### The option I rejected

`--ignore-registry-errors` is the popular workaround (it's all over the upstream
thread) and it is **wrong here**. It greens the step on *any* registry error — so
a blocking security gate silently passes precisely when it checked nothing, while
still reading green on the PR. That's worse than deleting the step, because
deleting it is at least honest. Dropping `pnpm audit` for osv-scanner alone was
the defensible alternative; kept both (belt-and-suspenders, per `../tooling.md`),
and the upgrade is as cheap as it will ever be at Phase 1 with three runtime deps.

## Lesson / next time

> **Rule:** A CI failure that **passes locally on the same command and lockfile**
> is a claim about *where the check runs*, not about the code. Before calling it
> flake and re-running: check whether it talks to a network service that could be
> brownout-ing. And once a service is flapping, **a green run is not evidence** —
> verify against the artifact (grep the bundle, read the diff), not the outcome.

Two corollaries worth carrying:

- **A workaround that turns a red gate green without doing the gate's work is a
  regression, not a fix.** For any security check, "how does this fail?" beats
  "how do I make it pass?" — `--ignore-registry-errors` fails *open* and silent.
- **Crossing two majors of a package manager is not a version bump.** The audit
  fix was one line; every other wrong turn came from pnpm 10/11 changing where
  config lives (`package.json` → `pnpm-workspace.yaml`), what it's called
  (`onlyBuiltDependencies` → `allowBuilds`), and how hard it fails (warning →
  error). Read the majors' notes *first* — and note the useful error is at the
  **top** of pnpm's output; the stack trace at the bottom is noise.

This is the second time the audit gate has cost real time
([2026-07-06](2026-07-06-vite-audit-gate-peer-dep.md) was the first). Neither was
the gate being wrong — it's a security check with a live dependency on the npm
registry's API surface, so it will keep having weather. That's the price of the
gate, and it's still worth paying; it just shouldn't be a surprise next time.

## References

- [pnpm#11265](https://github.com/pnpm/pnpm/issues/11265) — `pnpm audit` fails with 410 (opened 2026-04-15, closed 2026-04-20)
- [pnpm#11268](https://github.com/pnpm/pnpm/pull/11268) — `fix: adapt audit client to npmjs /advisories/bulk endpoint`; released in [v11.0.0-rc.1](https://github.com/pnpm/pnpm/releases/tag/v11.0.0-rc.1)
- [community#192768](https://github.com/orgs/community/discussions/192768) — GitHub confirms the brownout + **2026-07-15** retirement date ("We are not able to bring the old endpoint back up temporarily")
- npm Audit API docs (the bulk endpoint) — <https://api-docs.npmjs.com/#tag/Audit>
- pnpm settings, incl. `allowBuilds` — <https://pnpm.io/settings> · migration codemod: `pnpx codemod run pnpm-v10-to-v11`
- [`../tooling.md`](../tooling.md) — decisions log: audit gate + why the pin is 11
