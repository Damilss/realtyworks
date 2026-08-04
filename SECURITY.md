# Security policy

RealtyWorks is **private, proprietary, pre-1.0, and unreleased**, maintained by
one developer. This file is two things: how to report a vulnerability, and the
runbook for what happens when one is found — including the ones our own gates
find for us.

---

## Reporting a vulnerability

**Email `milii76@outlook.com`.** Put `RealtyWorks security` in the subject.

- **Do not open a public GitHub issue** for a suspected vulnerability, and do
  not put exploit detail in an issue title.
- **Do not include live credentials** in the report. Describe how to reproduce
  instead — if a key is already exposed, say which one so it can be rotated, but
  don't paste it.
- Include what you did, what happened, and what you expected. A rough report
  beats a silent one.

Expect a reply when the maintainer next opens the repo. This is a solo project
on a deadline, not a staffed security team: the commitment is an acknowledgement
and then either a fix or a written reason it isn't one. There is no bounty.

### Why email, and what replaces it later

GitHub's **private vulnerability reporting** and **repository security
advisories** are both public-repository features — per GitHub's docs, *"Owners
and administrators of public repositories can enable private vulnerability
reporting."* This repository is private, so neither is available, and the
Security tab offers no reporting path. That is the same GHAS-on-private-repos
wall already recorded in `docs/backlog.md` for CodeQL and secret-scanning push
protection.

Two triggers replace the address above:

1. **If this repository goes public** — enable private vulnerability reporting
   (Settings → Advanced Security) and make it the primary channel here.
2. **When the legal contact placeholders are filled** (`TOS.md` still carries an
   unfilled `[SECURITY OR LEGAL EMAIL — REQUIRED]`, tracked as issue #74) —
   replace the personal address here with the real one, so there is a single
   security contact rather than two that drift.

## Supported versions

None, in the release sense. The project is `0.1.0`, unreleased, with no tags and
no backports. **The current `main` is the only supported state of the code.**

---

## What already runs

Most findings here will come from automation rather than a reporter. These gates
run on every PR and push to `main`/`dev`; full detail and rationale live in
[`docs/tooling.md`](docs/tooling.md).

| Gate | Catches | Blocking? |
| --- | --- | --- |
| gitleaks — pre-commit hook + full-history CI scan | secrets committed to the repo | ✅ in CI |
| Semgrep OSS (`p/typescript`, `p/react`, `p/nextjs`, `p/owasp-top-ten`) | SAST findings, rendered as PR annotations | ✅ |
| `pnpm audit --audit-level=high` | high/critical dependency advisories | ✅ |
| osv-scanner — weekly cron + every PR into `main` | lockfile CVEs | advisory |
| pgTAP suite (`db` job) | RLS and write-guard regressions | runs, not yet a *required* check |
| Dependabot — weekly, grouped, 7-day cooldown | stale dependencies | n/a |

The local git hooks are convenience, not the gate: they can be skipped with
`--no-verify` or silently fail open when the gitleaks binary is missing. **CI is
the authoritative gate.**

## Triage

1. **Reproduce it, and write down the reproduction.** If it came from a scanner,
   confirm it is reachable in this codebase before treating it as real — a
   transitive advisory in a path we never call is a different problem from an
   exploitable one.
2. **Decide whether it is a blocking gate failure or a tracked item.** Anything
   that fails a blocking gate is fixed before merge, not deferred. Everything
   else gets an issue and a row in [`docs/backlog.md`](docs/backlog.md) at the
   priority it deserves.
3. **Fix it forward.** Schema and RLS fixes ship as *new* migrations — a
   migration already on `main` is immutable (`CLAUDE.md` §5). Add a pgTAP case
   for anything that was an authorization bug, so the regression fails CI
   instead of merging green.
4. **Write it down if it was surprising.** Notable snags get a report in
   [`docs/reports/`](docs/reports/) from `TEMPLATE_REPORT.md`. The audit trail is
   a product feature here, not a nice-to-have.

## If a secret leaks

**Rotate the credential first. Always.** Once a value has been pushed, treat it
as public. Scrubbing git history is cosmetic — a history rewrite that makes you
feel better while the live key still works is the worst available outcome.
Rotate, then decide whether the rewrite is worth doing at all. (Same rule, same
reasoning: [`docs/tooling.md`](docs/tooling.md#secret-scanning-gitleaks).)

Real values live only in `.env.local`, which is gitignored.
[`.env.example`](.env.example) is the committed template and contains no
secrets. Production data is never used in local or dev environments.

---

## The security model, in two lines

**The database is the authorization boundary.** Every table ships its RLS policy
in the same migration that creates it — retrofitting RLS is not allowed.

**Anything affecting security, money, or data integrity is enforced
server-side** — in RLS, a server action, or a database constraint. The client
may mirror a check for UX and is never the source of truth (`CLAUDE.md` §2). A
client-side-only check is a bug, not a defense.
