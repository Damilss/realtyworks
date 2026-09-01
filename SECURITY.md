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
4. **Prove the test reaches the fix — delete the guard and watch it fail.**
   A green test over a fixture that cannot reach the code under test is
   decoration, and it has happened twice here. The `/auth/confirm` redirect spec
   passed `token_hash=bogus`, so verification failed before the redirect ran and
   the guarded line never executed — deleting `safeNext()` outright left the
   spec green (issue #105). The `z.uuid()` regression was the same shape one
   layer over: fixtures were invented v4-shaped ids the seeded database would
   never produce, so the schema looked correct while it rejected every real id.
   For anything security-shaped, removing the protection for one run is the only
   cheap proof that the assertion is attached to the thing it names. It is
   cheap: turning email confirmations on (issue #93) was verified by flipping
   `enable_confirmations` back to `false`, restarting the stack, and watching
   the self-registration spec fail — about two minutes.
5. **Write it down if it was surprising.** Notable snags get a report in
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

**There is exactly one real secret in that file:** `SUPABASE_SECRET_KEY`, added
2026-08-03 with the vendor half. The two `NEXT_PUBLIC_SUPABASE_*` values are
public by design — the publishable key grants nothing beyond what RLS allows the
caller — but the secret key **bypasses RLS entirely**, so it is the one variable
whose exposure is a real incident. Two structural guards, both worth keeping:
it has no `NEXT_PUBLIC_` prefix (so `next build` never inlines it into the
browser bundle), and `src/lib/supabase/admin.ts` refuses to start if the value
it finds is a publishable key instead — a swap fails loudly rather than silently
running "privileged" writes under RLS. Rotate it from the Supabase dashboard;
locally it is whatever `pnpm exec supabase status` prints for the current stack.

---

## The security model, in two lines

**The database is the authorization boundary.** Every table ships its RLS policy
in the same migration that creates it — retrofitting RLS is not allowed.

**Anything affecting security, money, or data integrity is enforced
server-side** — in RLS, a server action, or a database constraint. The client
may mirror a check for UX and is never the source of truth (`CLAUDE.md` §2). A
client-side-only check is a bug, not a defense.

**One endpoint mints a session, and its destination is guarded rather than
trusted.** `src/app/auth/confirm/route.ts` exchanges a magic-link *or signup
confirmation* token for
session cookies, which makes the `next` it redirects to a phishing primitive —
a link that genuinely signs someone in and then lands them on an attacker's page
is exactly what makes a fake "session expired, sign in again" screen work. So
`safeNext()` **parses** that parameter with the same rules the browser will use,
compares origins, emits a bare path so no host can reach the `Location` header
at all, and re-parses what it emitted to confirm it still means the same thing
(issue #105 — parse-and-compare landed 2026-08-12, the round trip on
2026-08-24 after review on the fix's own PR). The transferable rule
is worth applying to the next value that crosses a parser boundary: **never
string-match a URL something downstream will re-parse** — `/\evil.example`
passes every prefix check and still normalizes to a foreign host. The `type`
parameter is allowlisted for the same reason the destination is parsed: it is
caller-controlled, so the endpoint redeems only `magiclink`, `invite` and
`signup`, and refuses `recovery` and `email_change` — both of which end in a
credential change this handler was never reviewed for. Reasoning:
[`docs/vendor-access.md`](docs/vendor-access.md) §6a and §6b.

**The one documented exception proves the rule.** `src/lib/supabase/admin.ts`
carries the secret key and bypasses RLS, because two writes are deliberately
unreachable from the Data API: attachment metadata (no client INSERT grant) and
`vendors.profile_id` (no client write grant). Every path that uses it
establishes the caller's access with their *own* session client first —
`can_access_work_order()` before an upload, `is_staff()` before an invite — and
only then reaches for the privileged one. `inviteVendor` is the single action
carrying its own authorization check, precisely because there is no policy left
behind it. Treat any new use of that client as a security change: it is the only
code in the repo the database will not second-guess. Design detail:
[`docs/vendor-access.md`](docs/vendor-access.md).
