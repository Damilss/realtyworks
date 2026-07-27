# Report: PR #81 — `@supabase/ssr` clients + session-refresh proxy (Phase 2 completion) and its review

| | |
| --- | --- |
| **Date** | 2026-07-22 (opened) → 2026-07-25 (merged) |
| **Area** | runtime / auth / config / CI / deps / security |
| **Cost** | 3 review passes over ~3 days · 12 review findings triaged (7 fixed, 4 rejected-with-reason, 1 unmerged) · 7 high-severity advisories cleared · 10 commits merged · +853 / −189 across 21 files |
| **Status** | **Merged** to `dev` (rebase-merge, ref `9986c70`, 2026-07-25 08:25 UTC, 5 checks passed). The final `[P2]` getClaims returned-error fix did **not** land in these 10 commits — it ships as follow-up **PR #82** (rebased on top of #81); see [Open items](#open-items--follow-ups). |
| **Commits / PRs** | PR **#81** `supabase-ssr` → `dev` · 10 merged commits `1cd7baa` … `2e32235` (rebased onto `dev` as `ed2b4ed` … `9986c70`) · getClaims fix `cd5bc6d` follows in **PR #82** |
| **Issues / links** | closes **#37** (Phase 2 runway) · refs **#78** (schema→local stack, makes the `db` check selectable) · follow-ups **#82** (getClaims returned-error clear) · **#64** (postcss → 8.5.10, `GHSA-qx2v-qp2m-jg93`) |
| **Participants / labels** | 1 participant (Damilss, author + self-review) · label `backend logic` · self-assigned |
| **See also** | `CLAUDE.md` §2 (trust rule), §5 (audit trail), §8 (no speculative changes) · [`../backlog.md`](../backlog.md) · [`2026-07-17-phase-2-schema-review-hardening.md`](2026-07-17-phase-2-schema-review-hardening.md) (the schema half of Phase 2) |

> **What this is.** A whole-PR record: what #81 shipped, the full review that
> hardened it, every finding and its verdict, the dependency-security work, and the
> merged outcome. Reconstructed from the PR page (conversation, timeline, checks —
> the authoritative source for the review narrative) cross-checked against the
> branch's commit history and trees. Where the two disagree, it's called out.
> Depth is weighted toward the auth findings, which share one root shape.

---

## TL;DR

PR #81 completes **Phase 2** on the application side: the three `@supabase/ssr`
clients (browser, per-request server, session-refresh), a validated env module, and
session refresh wired to the Next.js 16 **`proxy`** convention. The feature landed
in one commit, then went through **three review passes** driven by an AI "10 angles"
code review the author ran and **triaged against `node_modules` source** before
touching anything. Outcome: **7 findings fixed**, **4 rejected with a documented
reason** (speculative or already-mitigated), plus **7 high-severity dependency
advisories** cleared to satisfy the blocking audit gate. It merged to `dev` on
2026-07-25 with 5 checks green.

The auth findings rhyme: `@supabase/ssr` / `auth-js` fails in ways that **don't
throw** — config inlined at build time, `getClaims()` *returning* `AuthError`s,
cookie writes partially failing — so several bugs were "green build / silent runtime
break." The final `[P2]` (getClaims returning invalid-JWT errors instead of
throwing) is documented in full below; note it was **not** carried into the merge.

---

## What the PR ships (feature — `1cd7baa`)

From the PR description: *"Completes the Phase 2 runway (issue #37) — the last piece
before the Phase 3 vertical slice."* Nothing calls these clients yet — deliberately;
the first consumer is the Phase 3 login route.

| File | Role |
| --- | --- |
| `src/lib/supabase/client.ts` | Browser client for Client Components |
| `src/lib/supabase/server.ts` | Per-request server client (async `cookies()`) |
| `src/lib/supabase/proxy.ts` | `updateSession()` — session refresh, called by the root proxy |
| `src/lib/supabase/env.ts` | Validated `NEXT_PUBLIC_SUPABASE_*` config |
| `src/proxy.ts` | Next 16 root convention; wires up the refresh |

**Decisions worth reviewing (author's own framing):**

- **Next.js 16 renamed `middleware` → `proxy`.** The root `middleware` file
  convention is deprecated; every `@supabase/ssr` guide still says "create
  `middleware.ts`" and is wrong for this repo — that file is never invoked, and the
  failure is *silent* (sessions quietly stop refreshing, users log out at random
  once the access token expires). Refresh lives in `src/proxy.ts` exporting `proxy`,
  delegating to `src/lib/supabase/proxy.ts`. `next build` confirms pickup:
  `ƒ Proxy (Middleware)`. `CLAUDE.md` §3's tree was updated so a future session
  doesn't reintroduce `middleware.ts`.
- **Publishable key, not the legacy anon JWT.** Both clients read `sb_publishable_…`
  (what a new Supabase project issues), so Phase 4 (Cloud) needs no rename. Both use
  the caller's session → **RLS applies identically on server and client; neither is
  privileged.** The `service_role` / secret key appears nowhere and must never land
  in a `NEXT_PUBLIC_` var.
- **`env.ts` reads `process.env.NEXT_PUBLIC_*` as literal member expressions** so
  Next's static analysis inlines them; a dynamic `process.env[name]` lookup would be
  `undefined` in the browser bundle. Validated at call time, not module load.
- **The proxy does session refresh only — no route protection.** The Next proxy
  guide scopes it to optimistic checks; RLS + server-side checks stay the trust
  boundary (§2). Auth redirects belong to Phase 3.
- **`.gitignore` now negates `.env*` for `.env.example`** — the blanket rule would
  otherwise swallow the committed template §3/§5 requires.

**CI fix bundled in:** the proxy runs on every request and fails loudly on missing
config, so the `e2e` job (which boots the app but runs no Supabase stack) served
500s and the smoke test timed out — *reproduced locally, not assumed*. That job now
sets placeholder `NEXT_PUBLIC_SUPABASE_*` values (with no session cookie the refresh
short-circuits before any network call; neither value is secret). `verify` needs
nothing — `next build` doesn't execute the proxy.

**Verification (against the running local stack, not just typecheck):**

| Check | Result |
| --- | --- |
| Anonymous read on `properties` | Refused — permission denied |
| Seeded manager | 2 properties, 5 work orders |
| Seeded vendor | 3 work orders (scoped) |

The vendor also seeing 2 properties "looked like a leak on first read" — it's the
dedicated `properties_select_assigned_vendor` policy in
`20260717120500_create_work_orders.sql`, and the pgTAP suite asserts exactly 2.
Behavior matches existing assertions. Full local gate green in CI order
(lint → format:check → typecheck → test → build → audit → test:e2e).

---

## Files touched (net, merged)

`+853 / −189 across 21 files.`

| Area | Files |
| --- | --- |
| Supabase clients | `src/lib/supabase/{client,server,env,proxy}.ts` + `{server,env,proxy}.test.ts` |
| Proxy entry | `src/proxy.ts` + `src/proxy.test.ts` |
| Build config | `next.config.ts`, `tests/unit/next-config.test.ts` |
| CI | `.github/workflows/ci.yml` |
| Deps / security | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` |
| Docs / config | `README.md`, `CLAUDE.md`, `docs/backlog.md`, `docs/playwright.md`, `.env.example`, `.gitignore` |

---

## How the review ran

This was a **solo-developer self-review** (1 participant) using an AI code-review
tool the author invoked as *"the 10 angles,"* run over the `@supabase/ssr` commit.
The distinguishing feature — and the reason it produced a strong paper trail — is
that the author **validated every finding against the installed library source
before acting**, explicitly stating checks like: *"verified the load-bearing library
behaviors against `node_modules` source rather than assuming."* Findings that held
up got fixes; findings that didn't got a written rejection (and, where they pointed
at genuinely non-obvious code, a clarifying comment). Three passes:

### Timeline (UTC)

| When | Event |
| --- | --- |
| 07-22 10:32 | PR #81 opened; self-assigned; `backend logic` label |
| 07-22 10:42 | **Pass 1** — `[P2]` Document required Supabase env (`src/proxy.ts:13`) |
| 07-22 21:51 | **Pass 2** — "Second Review complete": 10-angle review over the feature commit (12 files, 355 insertions); **10 findings** posted |
| 07-22 22:06 | pushed `d8648c8` (docs) + `c588a7c` (corrupted-cookie recovery) |
| 07-22 23:06 | resolved Pass-1 `[P2]` (→ `d8648c8`) |
| 07-22 23:08 | addressed corrupted-cookie throw (→ `c588a7c`) |
| 07-22 23:20 | addressed CI build-gate blindness (→ `ad3c8ed`) |
| 07-22 23:35 | addressed browser-leaked env message (→ `3a245ee`) |
| 07-22 23:39 | addressed server-cookie bare catch (→ `d08b662`) |
| 07-23 00:01 | addressed static-asset matcher (→ `669aac8`) |
| 07-23 02:28 | **"Review round — 5 comments triaged"**: 2 real (fixed), 3 didn't hold (→ `35b51c5`) |
| 07-24 22:33 | dependency security: `next` bump note (→ `0cc280f`) |
| 07-25 07:37 | dependency security: `pnpm` overrides note (→ `2e32235`) |
| 07-25 07:44 | *"Let's do one last review to make sure that everything is extra sound"* |
| 07-25 08:01 | **Pass 3** — `[P2]` Clear invalid JWTs returned by getClaims (`proxy.ts:77-84`) |
| 07-25 08:21 | "Addressed: `[P2]` …" (fix written up; commit `cd5bc6d` — see caveat) |
| 07-25 08:25 | **Merged** `9986c70` into `dev`; **5 checks passed**; PR closed |
| 07-25 08:27 | referenced in follow-up **#64** (postcss → 8.5.10, XSS in stringify) |

Two library facts the author verified during Pass 2, and which turned out to be
load-bearing for later findings:

- `setAll(cookiesToSet, headers)` routes through the response path
  (`cookies.js:428`) with the real no-store headers — so the security comment in
  `proxy.ts` holds; the `{}`-header call sites are browser-storage paths only.
- **`AuthRetryableFetchError extends AuthError`, so it is *returned*, not thrown** —
  and `getClaims()` does trigger refresh via `getSession() → _useSession →
  __loadSession`. This is exactly the return-vs-throw contract that Pass 3's `[P2]`
  later turned on.

---

## Findings & resolutions

### Fixed (7)

| # | Finding | Where | Fix | Commit |
| --- | --- | --- | --- | --- |
| P1 | **[P2]** Required env undocumented — a fresh clone following the README 500s on every route (README still said no env needed) | `src/proxy.ts:13` | Reordered README *Install & run* (install → `supabase start` → write `.env.local` → `pnpm dev`); one-liner `supabase status -o env` filtered `^NEXT_PUBLIC_` to avoid emitting `SERVICE_ROLE_KEY`/`SECRET_KEY`/`JWT_SECRET`/`DB_URL`; matching `test:e2e` prereq in `playwright.md` | `d8648c8` |
| 1 | Corrupted cookie **throws** a native `SyntaxError` → `updateSession` had no try/catch → 500s every route incl. `/login`, so the user can't sign out to clear it | `proxy.ts:57` | Wrap `getClaims()`; on throw `clearAuthCookiesAtScopes` + continue unauthenticated; `private, no-store` on cookie-writing responses; regression test (malformed JWT + stale chunk) | `c588a7c` |
| 2 | CI **build gate proves nothing** — `verify` runs `pnpm build` with no `NEXT_PUBLIC_SUPABASE_*`, inlining `undefined` into the client bundle (the Phase-4 Vercel failure mode) | `.github/workflows/ci.yml:69` | `next.config.ts` calls `supabaseEnv()` at config load so an unusable bundle is never emitted; `verify` gets non-secret placeholders; `next-config.test.ts` asserts config load throws when a var is missing | `ad3c8ed` |
| 3 | Developer-remediation error message inlined into the **browser bundle** and shown to end users | `env.ts:14` | Default/browser path throws generic `"Application configuration is unavailable."`; the actionable `.env.local`/`pnpm` message stays build-only via a handler `next.config.ts` passes; test asserts no `.env.local`/`pnpm` leak to the browser | `3a245ee` |
| 4 | Bare `catch {}` wraps the whole cookie-write loop — one failing chunk silently skips the rest (a partial write is exactly finding #1's poison input), real errors indistinguishable from the expected read-only case | `server.ts:31` | Detect and ignore **only** the known Server-Component read-only error; rethrow unexpected failures before attempting later chunks; tests cover both directions | `d08b662` |
| 5 | Proxy matcher excluded only six image extensions → `/robots.txt`, `/sitemap.xml`, fonts, and Phase-5 `/manifest.webmanifest` + `/sw.js` each trigger a Supabase Auth round-trip (HS256 → `getUser()`); `no-store` on static responses breaks SW update semantics | `src/proxy.ts:24` | Extend the negative lookahead (robots/sitemap/manifest/sw + `avif,ico,woff,woff2,ttf,otf,eot`); `proxy.test.ts` pins skip-vs-match via `unstable_doesMiddlewareMatch` | `669aac8` |
| 6 | `getClaims()` **returned** error discarded (result unbound) → a persistent refresh failure (revoked token / `AuthRetryableFetchError`) silently logs every user out with no signal | `proxy.ts:57` | Bind the result and `console.error` it (§5 audit trail; Sentry in Phase 4). *Deliberately did **not** clear cookies on a returned error — that would sign everyone out during a transient outage.* | `35b51c5` |

### Rejected with a documented reason (4) — the "5 comments triaged" round (`35b51c5`)

The author's own triage table, verbatim in spirit:

| # | Location | Verdict | Action |
| --- | --- | --- | --- |
| 6 | `proxy.ts` getClaims | ✅ Valid | dropped auth-error now bound + logged *(fix above)* |
| 7 | `env.ts required()` | ❌ Invalid — already tested | added a happy-path assertion (the one real gap) |
| 8 | `proxy.ts` setAll response | ❌ Invalid — speculative | doc comment only, no behaviour change |
| 9 | `ci.yml` placeholder URL | ❌ Invalid — already mitigated | no change |
| 10 | `.env.example` tracked | ⚠️ Fair, low-sev | strengthened the tracked-file warning |

The reasoning, preserved because *why a finding was rejected* is the part a changelog
throws away:

- **#7 `required()` empty-string logic untested — rejected.** It's pinned in two
  places: `env.test.ts` stubs `URL=""` and asserts the throw, and
  `next-config.test.ts` does the same over both vars via the config path. Both
  refactors the comment feared (`value == null`, `'name' in process.env`) turn the
  suite red. The one genuinely unasserted thing — the happy-path return values — got
  a new test.
- **#8 `setAll` discards prior response headers — rejected (speculative).** The
  reassignment is real, but nothing is set on `response` before the auth call, and
  recreating it is the required `@supabase/ssr` pattern (re-snapshots `request`
  after cookie mutation). A future footgun, not a current bug (§8 — no speculative
  changes). Documented the constraint in a comment instead.
- **#9 CI placeholder looks like a real endpoint (`127.0.0.1:54321`) — rejected.**
  No CI job dials it: `verify` build-validates only, `e2e`'s proxy short-circuits
  with no session cookie, `db` runs on a separate runner without these vars. Worst
  case is `ECONNREFUSED` — already fail-fast.
- **#10 `.env.example` is tracked — fair, low-sev.** A warning existed but was easy
  to skim; made it explicit that the file is git-tracked and must hold no real
  values (gitleaks would catch a key-shaped secret but not a plain URL/endpoint).

### Raised but not merged (1)

| # | Finding | Where | Status |
| --- | --- | --- | --- |
| P3 | **[P2]** Invalid JWTs **returned** by `getClaims()` (non-retryable `AuthError`) only logged → bad cookie persists → redirect loops until expiry | `proxy.ts:77-84` | Fixed in `cd5bc6d`, **outside** #81's 10 merged commits; ships as follow-up **PR #82** (rebased on #81) — see deep dive + [Open items](#open-items--follow-ups) |

---

## Dependency security (the blocking `pnpm audit` gate)

Newly-published advisories tripped `pnpm audit --audit-level=high` (a blocking CI
gate) mid-PR. Two commits cleared **7 high-severity** advisories:

| Commit | Change | High advisories cleared |
| --- | --- | --- |
| `0cc280f` | `next` 16.2.6 → 16.2.11 (+ `eslint-config-next` lockstep) | proxy/middleware bypass `GHSA-6gpp-xcg3-4w24`; App-Router Server-Actions DoS `GHSA-m99w-x7hq-7vfj`; SSRF in Server Actions `GHSA-89xv-2m56-2m9x`; SSRF in rewrites `GHSA-p9j2-gv94-2wf4` — **+ 5 moderate** (cache confusion ×2, unbounded Edge Server-Action payload, image-optimization DoS, internal-data disclosure) |
| `2e32235` | `pnpm` range-scoped overrides in `pnpm-workspace.yaml`: `postcss ^8.5.18` (→ 8.5.22), `brace-expansion 5.0.8`, `minimatch ^10` (→ 10.2.5) | `GHSA-6g55-p6wh-862q`, `GHSA-r28c-9q8g-f849` (postcss), `GHSA-mh99-v99m-4gvg` (brace-expansion) |

Two non-obvious mechanics, both documented on the PR:

- **postcss needs an *override*, not an update:** `next` exact-pins `postcss@8.4.31`,
  outside the patched `>=8.5.18` range, so `pnpm update` can't move it; the
  range-scoped override also lifts `vite`'s copy (mirrors the existing `sharp`
  override).
- **brace-expansion drags minimatch to v10:** the advisory is patched only in
  `brace-expansion@5.0.8`, which drops the callable CommonJS default export that
  `minimatch@3.x` (reached via eslint) calls — so bumping it alone would crash
  eslint; `minimatch` is forced to `^10` (named export) in the same change.

**Knowingly left below the gate** (framework-owned transitives, not directly
declarable): `postcss@8.4.31` moderate `GHSA-qx2v-qp2m-jg93` (tracked as follow-up
**#64**) and `@babel/core` low `GHSA-4x5r-pxfx-6jf8` (via styled-jsx / eslint
tooling). Total across the PR: **11 → 2** advisories; the gate exits 0.

---

## Cross-cutting theme: failures that don't throw

Findings 1, 2, 3, 4, 6, and P3 are one shape in different clothes — an **invisible
failure** in the SSR/auth layer:

- **Build time:** missing `NEXT_PUBLIC_*` inlines `undefined` and the build
  *passes* (#2) — caught only by validating at config load. The error you then show
  must be safe once it reaches the browser (#3).
- **Cookie writes:** a bare catch turns a partial write into silent corruption
  (#4), which is the poison input for the cookie-recovery paths (#1, P3).
- **`getClaims()`:** reports auth failures by **return value** for `AuthError`s and
  by **throw** for native parse errors. Miss either channel and the request "just"
  degrades to unauthenticated with no signal (#6) or loops on a dead session (P3).

The consistent fix pattern: **surface it** (log/throw at the right layer) and
**recover deterministically** (clear the session, fail the build, rethrow the
unexpected) — never let it pass silently. Note the symmetric restraint in #6 and P3:
*clear on a permanent error, but preserve the session on a retryable outage.*

---

## Deep dive — Pass 3's `[P2]`: `getClaims()` returns invalid JWTs, it doesn't throw

The last and subtlest finding, and the one worth not re-learning.

**The trap.** After finding #1, the proxy already had a "clears corrupted cookies"
test that *passed* — but it fed a JWT whose header decodes to a non-JSON string,
i.e. a `JSON.parse` `SyntaxError`, which is the **thrown** path (the `catch`). It
proved nothing about the far more common corruption.

**The mechanism.** In `@supabase/auth-js@2.110.7`, `getClaims()`'s internal
`catch (e) { if (isAuthError(e)) return { error: e }; throw e; }` **returns** any
`AuthError` and only re-throws non-Auth errors. Since
`AuthInvalidJwtError extends CustomAuthError extends AuthError`, a structurally
invalid JWT, a non-base64url token, a bad signature, and an expired token all come
back as `{ error }` — never thrown. Only `JSON.parse`/UTF-8 failures throw. Confirmed
empirically against the installed library:

| Session cookie | `getClaims()` | `isAuthRetryableFetchError` | action |
| --- | --- | --- | --- |
| structurally invalid JWT (`not-a-jwt`) | **returns** `AuthInvalidJwtError` | `false` | **clear** |
| header decodes to non-JSON | **throws** `SyntaxError` | — | clear (via `catch`, already handled by #1) |
| expired → refresh fetch fails | **returns** `AuthRetryableFetchError` | `true` | **preserve** |

So the returned-error branch only logged: the browser kept a cookie it believed was
a live session while every server check rejected it → redirect loops until expiry.

**The fix (`cd5bc6d`).** In the returned-error branch, after logging, clear the
session unless the error is retryable:

```ts
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

const clearSession = () =>
  clearAuthCookiesAtScopes({ getAll, setAll, storageKey, scopes: [{}] });

if (error) {
  console.error("[proxy] Supabase session refresh failed", error);
  if (!isAuthRetryableFetchError(error)) await clearSession(); // outage → keep cookies
}
```

Preserving cookies on `AuthRetryableFetchError` is load-bearing: clearing on a
transient Auth outage would sign every user out mid-blip — the opposite failure.
Two tests were added (a real-library invalid-structure clear + an injected
retryable-outage preserve), and the invalid-JWT test was confirmed to **fail against
the pre-fix code**. Local gate green (typecheck · lint · format:check · 23/23 unit
tests · build).

**But:** this fix (`cd5bc6d`) was **not** pushed before #81 merged. The PR was
rebase-merged from the state ending at `2e32235` (→ `9986c70` on `dev`), whose
`proxy.ts` contains only the *thrown*-path `clearAuthCookiesAtScopes` from finding
#1. The returned-error clear therefore reaches `dev` not through #81 but through
**follow-up PR #82**, which rebases the fix on top of #81.

---

## Verification & merged state

- **Merge:** rebase-merge of 10 commits into `dev`, ref `9986c70`, 2026-07-25
  08:25 UTC. GitHub: *"5 checks passed"* · *"Pull request successfully merged and
  closed."* The 10 commits were replayed onto `dev` with new hashes
  (`ed2b4ed` … `9986c70`).
- **Checks (5):** the standard gate — `verify` (lint/format/typecheck/test/build/
  audit), `e2e` (Playwright smoke), `db` (pgTAP), plus the security workflows
  (gitleaks + Semgrep) and osv-scanner — all green at merge.
- **Coverage the PR added:** `env.test.ts`, `next-config.test.ts`, `server.test.ts`,
  `proxy.test.ts` (lib), `src/proxy.test.ts` (matcher) — the auth layer went from
  untested to covering the corrupt-cookie, missing-env, read-only-cookie, matcher,
  and dropped-error paths.

---

## Open items / follow-ups

1. **The Pass-3 `[P2]` getClaims returned-error fix — tracked in PR #82.** As merged,
   #81's `9986c70` `proxy.ts` lacks the `isAuthRetryableFetchError` / `clearSession`
   branch (finding #1's thrown-path clear only); the fix (`cd5bc6d`) was authored
   after the merged state and now ships as **PR #82**, rebased on top of #81, so a
   structurally invalid or bad-signature JWT is cleared rather than looping until
   expiry. Item resolved once #82 merges.
2. **Make the `db` job a required check** in Settings → Branches (author follow-up).
   It has reported a run since #78, so it's selectable — that's what makes the pgTAP
   RLS assertions actually gate a merge.
3. **Below-gate advisories:** `postcss` `GHSA-qx2v-qp2m-jg93` (follow-up **#64**) and
   `@babel/core` `GHSA-4x5r-pxfx-6jf8`, both framework-owned; revisit on the next
   `next` bump.
4. **Phase 3 vertical slice** is unblocked: `src/app/(auth)/` and the first server
   action (the first real consumer of these clients), plus the `src/server/` ESLint
   import-boundary restriction.

---

## Lessons / next time

> **1 — `getClaims()`/`getUser()` are dual-signal.** A returned `{ error }` (any
> `AuthError`, e.g. invalid/expired JWT) and a thrown native error are *both* failure
> modes. Handle the returned path explicitly and branch on
> `isAuthRetryableFetchError` so you clear unusable sessions but never sign users out
> during an outage.

> **2 — `NEXT_PUBLIC_*` fails silently.** Missing public env inlines `undefined` and
> the build *succeeds*. Validate at config load, give CI non-secret placeholders so
> the gate actually gates, and keep the browser-facing error generic.

> **3 — A symptom-named passing test can guard the wrong path.** "clears corrupted
> cookies" asserted only the thrown path. When validating a review claim, reproduce
> the *specific* mechanism, not a look-alike.

> **4 — Config that becomes load-bearing must update the documented fresh-clone
> path.** The moment env went mandatory, the README's "no env required" turned every
> fresh clone into a 500. Wiring and docs ship together.

> **5 — Rejecting a review finding is a first-class outcome — write down why.** Four
> of twelve findings didn't hold; the value is the recorded reasoning (already
> tested / speculative per §8 / already mitigated), so the same "fix" isn't
> relitigated next time.

> **6 — "Addressed" in a comment ≠ "merged."** The Pass-3 fix was written up and
> acknowledged, but the branch merged without it. Confirm the commit is in the
> merged range, not just that a reply was posted.

---

## References

- **PR #81** `supabase-ssr` → `dev` — merged `9986c70`, 2026-07-25; 3 review passes,
  12 findings, 5 checks. Closes **#37**; refs **#78**; follow-up **#64**.
- Merged commits (PR-visible hashes): `1cd7baa` (feature) · `d8648c8` · `c588a7c` ·
  `ad3c8ed` · `3a245ee` · `d08b662` · `669aac8` · `35b51c5` · `0cc280f` · `2e32235`
  (rebased onto `dev` as `ed2b4ed` … `9986c70`).
- Follow-up **PR #82** (rebased on #81): `cd5bc6d` — `fix(auth): clear unusable sessions returned by getClaims`.
- `@supabase/auth-js@2.110.7`: `GoTrueClient.js` `getClaims()` (return-vs-throw
  catch); `lib/errors.js` (`AuthError` → `CustomAuthError` → `AuthInvalidJwtError`;
  `isAuthRetryableFetchError`); `lib/helpers.js` `decodeJWT` / `validateExp`.
- Next.js 16 `proxy` file convention:
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.
- `CLAUDE.md` §2 (server-side trust rule), §5 (audit trail), §8 (no speculative changes).
