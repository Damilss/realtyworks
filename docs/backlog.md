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

## State verified (2026-08-07, auth section re-verified 2026-08-25)

- `next 16.2.11` / `react 19.2.4` / `pnpm@11.13.1`, Node pinned to 24 (`.nvmrc`
  and `engines.node`, added 2026-08-25).
- CI runs `lint → format:check → typecheck → test → build → audit` — with
  `!cancelled()`, concurrency-cancel, `permissions: contents: read`, and
  pnpm + Next build caching. The audit step is **blocking** (fails on any
  high/critical advisory; see `docs/tooling.md`). A parallel **`e2e` job** now
  boots its own Supabase stack, resets it to the seed, and runs the Playwright
  specs on every PR/push to `main`/`dev` (Chromium only, HTML report artifact) —
  so RLS is gated through the UI, not just through pgTAP. Since 2026-08-03 that
  job's `.env.local` also carries `SUPABASE_SECRET_KEY` (renamed from the CLI's
  `SECRET_KEY`); the step's grep stays an **allowlist**, so `SERVICE_ROLE_KEY`
  and `JWT_SECRET` still never reach a file `next build` reads.
- Security workflows live: **gitleaks** on PR/push to `main`/`dev`
  (+ pre-commit layer), **Semgrep SAST** (blocking, PR annotations), weekly
  **osv-scanner** lockfile scan (+ a scan on every PR into `main`). Every
  `uses:` is SHA-pinned; the semgrep container is digest-pinned.
- Dependabot on (npm + github-actions, weekly), **tuned** — grouped, `deps`
  prefix, `dependencies` label, `@types/node` pinned to `^24` (issue #23; see ✅).
- Husky **pre-commit** (lint-staged + gitleaks) **and `commit-msg`**
  (commitlint, conventional types + `deps`, `CI/CD` retired → `ci`).
- Prettier configured (markdown intentionally ignored), with `.editorconfig`
  under it for the file types Prettier never sees (2026-08-25, issue #32).
- **Phase 2 schema is on `main`** — merged 2026-07-21 (PR #78): `supabase/`
  (9 migrations, seed, pgTAP suite via `pnpm exec supabase test db`), generated
  `src/lib/database.types.ts`, supabase CLI pinned as a devDependency. See ✅.
  `main` is now the migration baseline — every schema change from here is a new
  forward migration, never an edit to a merged file. Five such forward
  migrations now exist: the 2026-07-27 last-landlord delete guard and signup-phone
  metadata fix, two 2026-08-01 migrations narrowing `service_role` to row
  DML and making the activity trail append-only even for the service key, and the
  2026-08-02 non-blank-note constraint. pgTAP is up to **94 assertions** across
  three files, including `03_signup_defaults.test.sql`. The 2026-08-03 vendor
  half added **no** migration — the Phase 2 schema already carried every policy
  and grant it needed, which is the clearest evidence so far that shipping RLS
  with its table was the right call.
- **pgTAP `db` job** running in CI on `main`/`dev` (issue #72) — not yet a
  *required* check. See ✅.
- **Branch protection on `main`** enabled 2026-07-20 (web UI). See ✅.
- `pnpm audit --audit-level=high` **clean** as of 2026-08-24 (fast-uri + sharp
  cleared 2026-07-21; js-yaml + nanoid cleared 2026-08-07; nanoid cleared *again*
  2026-08-24 after GHSA-2v37-7h3g-55p8's patched floor moved 3.3.17 → 3.3.18 —
  see ✅ and `docs/tooling.md`). The rest of this block was last swept
  2026-08-07.
- **UI toolkit installed 2026-07-27** — Tailwind CSS v4 (`@tailwindcss/postcss`,
  no `tailwind.config.js`) + shadcn/ui (zinc base, new-york) scaffolded from the
  registry's zinc tokens (the current `shadcn` CLI dropped the classic base
  colors for named presets); `components.json`, `postcss.config.mjs`,
  `src/lib/utils.ts`, and `src/components/ui/button.tsx` added; class order
  enforced by `prettier-plugin-tailwindcss`. **Phase 3 has started.** See ✅.
- **Auth loop shipped 2026-07-27** — `/login`, `/signup`, the session-gated
  dashboard, and the work-order list, over `src/schemas/`, `src/server/queries/`
  (server-only DAL) and `src/server/actions/`. Both folders now exist. Of
  `CLAUDE.md` §3, only `supabase/functions/` is still unbuilt (Phase 5 SMS) —
  `src/app/api/` is too, but the route handler that arrived on 2026-08-03 landed
  at `src/app/auth/confirm/route.ts`, since it is an auth endpoint rather than an
  API surface. See ✅.
- **Signup is open** (`[auth] enable_signup = true`, 2026-07-27) — reverses the
  2026-07-17 invite-only call. Every self-registration is an unlinked `vendor`
  that can read nothing; roles come only from server-set `raw_app_meta_data`.
  Reversal + reasoning: `docs/schema/my_schema_writeup.md`, last section. Its
  two costs were filed as 🟠 (email confirmations) and 🟡 (CAPTCHA); **the first
  is paid** as of 2026-08-25 and CAPTCHA is now the only one left.
- **Email confirmations on** (`[auth.email] enable_confirmations = true`,
  2026-08-25, issue #93) — a self-registration cannot sign in until it follows
  an emailed link, redeemed by our own `/auth/confirm`. No migration; the seeded
  users already carry `email_confirmed_at`. The local mailbox is **mailpit**
  (`[local_smtp]`, port 54324, container still named `supabase_inbucket_*`), and
  the CI `e2e` job now boots it deliberately — **eight containers, not nine**,
  with the three inert `-x` names finally corrected in the same change. Verified
  by deleting the flag and watching the spec fail. See ✅.
- **`[auth.email.smtp]` written but disabled** — Resend, `enabled = false`, with
  `env()` values documented in `.env.example`. Turning it on is a Phase 4
  hosted-project step; flipping it in `config.toml` would route local dev and
  the CI mailbox spec through a real provider.
- **Cross-checked against the GitHub issue list 2026-08-07** (15 open). Four
  filed issues had no entry here and were added to 🟡: the Tailwind v4 full-height
  regression (#86/#89), the prettier-plugin-tailwindcss v4 options (#87), the
  `minimatch` override (#84), and the `vitest.config.ts` alias path (#102). Every
  other visible open issue already had an entry, now cross-referenced by number.
  **Caveat:** the check was made against a screenshot of the first page of
  *Open*, so roughly three of the fifteen sat below the fold and were not
  compared — re-run the comparison on those before treating this file as a
  complete mirror of the tracker.

### Sharp edges these issues address
- Native GitHub security features (CodeQL, secret-scanning push-protection,
  dependency-review) are **GHAS-gated on private repos**. Security issues below default
  to **OSS CI tools** (gitleaks, Semgrep, osv-scanner) — free, vendor-neutral, and they
  keep Phase 7 self-host mechanical per `CLAUDE.md` §5.

---

## ✅ Done (kept for the paper trail)

### ✅ `.editorconfig` + package.json `engines` (2026-08-25, issue #32)
Done. `.editorconfig` mirrors the repository's whitespace conventions while
preserving Markdown's significant trailing spaces, and `package.json` declares
`"engines": { "node": ">=24 <25" }`. Wrong-Node installs now warn, while the
existing `packageManager` field remains the pnpm version source of truth.
### ✅ Email confirmations on — the last Phase 4 gate (2026-08-25, issue #93)
`[auth.email] enable_confirmations` is `true`. A self-registration now gets an
account it cannot sign in to until it follows a link that only exists in an
email, which closes the address-squatting vector that came with opening signup
on 2026-07-27. **No migration** — `seed.sql` already inserts all three fixtures
with `email_confirmed_at`, so every seeded login and all 94 pgTAP assertions
were untouched.

Cheaper than filed, for the reason the entry predicted: `/auth/confirm` already
did the `verifyOtp({ token_hash, type })` exchange, so this was `"signup"` added
to `ALLOWED_TYPES` rather than a new endpoint. What shipped:

- `supabase/templates/confirmation.html` + `[auth.email.template.confirmation]`.
  The default body is `{{ .ConfirmationURL }}`, which is GoTrue's implicit flow
  and unusable by a cookie-session app, so the link is built the same way
  `buildInviteUrl()` builds the invite:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`.
- `signUp()` returns `{ confirmationSent: true }` instead of redirecting —
  there is no session to redirect *with* — and the form swaps itself for a
  "check your email" panel.
- `signIn()` names the `email_not_confirmed` case instead of collapsing it into
  "Invalid email or password."
- `tests/e2e/mailbox.ts` reads mailpit, and the self-registration spec asserts
  the refusal *before* the success: no `/dashboard`, then a refused sign-in,
  then the emailed link, then the pending-access state.
- The CI `e2e` `-x` list corrected in the same change (see the 🟡 below).
- `[auth.email.smtp]` written for **Resend** with `enabled = false`, and
  `[auth.rate_limit] email_sent` raised 2 → 30.

**Four things that were wrong in the plan and right on the stack.** Every one
came from running it rather than reading about it (`AGENTS.md`).

1. **A duplicate signup still errors.** The Supabase docs imply the response is
   obfuscated once confirmations are on; CLI 2.109.1 returns
   `user_already_exists` / 422 for a *confirmed* address exactly as before. The
   unit test written against the "obfuscated" shape would have passed forever
   while testing a response the server never sends — the `z.uuid()` failure mode
   again. What *did* change: re-submitting an **unconfirmed** address succeeds
   and resends the link (two messages in the mailbox for two submissions), which
   is why no "resend" control was built.
2. **`content_path` under `[auth.email.template.*]` resolves from the project
   root**, while `[auth.email.notification.*]` resolves from `supabase/`. The
   CLI's two commented examples differ for that reason; it reads like a typo and
   is not. Confirmed by reading the resolver out of the CLI bundle
   (`projectRoot` vs `supabaseDir`) *and* by the template actually being served
   at `http://supabase_kong_<project>:8088/email/confirmation.html`.
3. **The mail container is named `supabase_inbucket_<project>` and runs the
   `mailpit` image.** Three places carry the old name — `--help`, the container
   name, and stale notes — and none of them is right.
4. **`supabase status -o env` does print `MAILPIT_URL`**, contrary to the first
   sweep for it. It is still not what the helper uses: the CI job writes
   `.env.local`, which Next reads and the Playwright runner does not.

**Verified by deleting it.** Per `CLAUDE.md` §5, `enable_confirmations` was
flipped back to `false`, the stack restarted, and the self-registration spec
re-run: it fails on the "Check your email" heading. The spec covers the gate.

**Still owed at the Phase 4 deploy** (moved to the Phase 4 entry, not dropped):
flip `[auth.email.smtp] enabled = true` on the hosted project with a verified
sender domain, point `site_url` / `additional_redirect_urls` at the deployed
origin, and confirm the custom template actually applied remotely.

### ✅ nanoid high advisory cleared again — the patched floor moved (2026-08-24, issue #110)
The blocking `pnpm audit` gate went red on **GHSA-2v37-7h3g-55p8**, the *same*
advisory the 2026-08-07 entry below cleared. Nothing regressed in the tree: the
advisory's **patched floor moved from 3.3.17 to 3.3.18**, so the exact version
that closed this three weeks ago became the flagged one. That is the transferable
part — a cleared advisory is not permanently cleared, and the audit gate is the
only thing that notices.

**Another stale lockfile pin, so again no override.** `postcss@8.5.25` declares
`nanoid: "^3.3.16"`, which admits 3.3.18, and 3.3.18 is published — so the
`pnpm-workspace.yaml` rule (force a transitive version only when the patched one
falls *outside* the parent's declared range) says update, not override.
`pnpm update nanoid --depth Infinity` was the whole fix; `pnpm-workspace.yaml`
and `package.json` are unchanged. Third clearance of this shape, after fast-uri
(2026-07-21) and js-yaml + nanoid (2026-08-07). Ignore the audit table's "5
paths": it is one deduped copy under `postcss`, shared by next /
`@tailwindcss/postcss` / vite, and `pnpm why nanoid` still reports "Found 1
version".

Verified in `pnpm-lock.yaml` rather than `node_modules`, since
`--frozen-lockfile` is what CI actually reads — both the `packages:` and
`snapshots:` entries resolve `nanoid@3.3.18` and nothing else. The lockfile diff
carries one unrelated line: pnpm recorded a `deprecated:` note on `eslint@9.39.4`
that the registry has since added. No version moved with it. Full gate green
afterwards: lint → format:check → typecheck → 181 tests across 17 files → build →
audit ("No known vulnerabilities found", exit 0). Note that `next build` needs
`NEXT_PUBLIC_SUPABASE_*` set; the CI `verify` job's non-secret placeholders
reproduce it locally without a stack.

**Left open deliberately:** whether the moved floor is a revision of the original
advisory or a separate incomplete-fix follow-up (the way GHSA-fxqj-rqcc-2cmp was
for postcss), and why Dependabot did not open a security PR for a transitive,
lockfile-only bump. Finding out from a red CI gate is worse than finding out from
a Dependabot PR, and this is the second nanoid occurrence.

### ✅ `/auth/confirm` open redirect closed (2026-08-12, finished 2026-08-24, issue #105)
`safeNext()` string-matched a value a URL parser was about to reinterpret:
`next=%2F%5Cevil.example` decodes to `/\evil.example`, which starts with `/`,
does not start with `//`, and therefore passed — then normalized to
`//evil.example` in the browser, because `\` is equivalent to `/` in the
authority position (WHATWG URL). It now resolves `next` with `new URL(next,
origin)`, compares origins, returns **only** `pathname + search + hash`, and
then parses *that* result a second time and requires it to still be the same
same-origin path.

**Parse-and-compare closes the class, not the reported instance.** The tab and
carriage-return variants (`/%09/evil.example`, `/%0d/evil.example`) were the
proof that another prefix case was never the fix: the parser *strips* those
characters, so any string check approves the value before the thing that makes
it dangerous has happened. Emitting a bare path is the other half — with no
authority in the `Location`, the guard still holds if `nextUrl.origin` were ever
influenced by a spoofed `Host`.

**One parse was not enough, and review on the fix's own PR caught it
(2026-08-24).** `${origin}//evil.example` is same-origin by every measure `URL`
reports — the host is `evil.example` only in the **pathname** — so the origin
check passes and the bare path handed to `redirect()` is `//evil.example`, which
is protocol-relative the instant the browser reads the `Location`. Next.js sets
that header verbatim, so nothing downstream was going to catch it. Runs of
leading slashes and the backslashes the parser folds into them are the same
family. The round trip is the general answer rather than a longer denylist:
**whatever we emit has to re-parse into what we think it is**, and a genuine
destination is already a fixed point of that reduction, so nothing legitimate is
refused. Both hostile spellings were added to the payload tables at both layers.

**The test that appeared to cover this could not reach it.** The old e2e spec
passed `token_hash=bogus`, so `verifyOtp` failed, the handler redirected to
`/login?error=invalid-link`, and `next` was never read — it asserted we stayed
on our own host for reasons unrelated to the guard. Confirmed the way the issue
asked for: with `safeNext()` neutered, the rewritten spec fails on
`net::ERR_NAME_NOT_RESOLVED at .../evil.example` — the browser genuinely leaves
the site — and 9 of the then-14 unit cases go red. Same shape as the `z.uuid()`
regression: a green test over a fixture that cannot reach the code under test.

Two layers, deliberately duplicating one list (each table carries a comment
pointing at the other). `src/app/auth/confirm/route.test.ts` (new, 16 cases once
the round trip landed) mocks `createClient` and `redirect` — the
`src/server/actions/auth.test.ts` idiom — and covers every hostile shape plus the
contract around it: a failed verification never reads `next`, a `type` outside
`ALLOWED_TYPES` never reaches Supabase, and no accepted *or* refused destination
ever carries a host. `tests/e2e/vendor-loop.spec.ts` redeems a **real, unspent
token per case** (eight hostile, then a legitimate `/work-orders/<id>` to prove
deep-linking survives), which is what proves the redirect line executes at all.
`mintInviteLink()` now waits for the link field's value to *change* before
reading it — re-minting otherwise hands back the token just spent. 181 unit
tests across 17 files; the vendor-loop suite is 7 specs, and the redirect case
mints nine invites, which is why it is the one spec calling `test.slow()`.

### ✅ js-yaml + nanoid high advisories cleared (2026-08-07)
Two highs broke the blocking `pnpm audit` gate in CI: **js-yaml**
(GHSA-5p4m-2wfm-xmqj — quadratic CPU consumption resolving `!!omap`, patched in
4.3.1, reached through `cosmiconfig` under commitlint and through
`@eslint/eslintrc`, 28 paths) and **nanoid** (GHSA-2v37-7h3g-55p8 — custom
generators loop indefinitely at size zero, patched in 3.3.17, reached through
`postcss` under next / `@tailwindcss/postcss` / vite, 5 paths).

**Both were stale lockfile pins, so neither took an override.** This is the
`docs/tooling.md` rule doing its job: the patched version has to fall *outside*
the parent's declared range to justify forcing it. Here every consumer already
declared a range that admits the fix — `cosmiconfig` at `js-yaml: ^4.1.0` and
`@eslint/eslintrc` at `^4.1.1` both admit 4.3.1; `postcss` declares
`nanoid: ^3.3.16`, which admits 3.3.17 — and the lockfile was simply pinned one
patch short at 4.3.0 and 3.3.16. `pnpm update js-yaml nanoid --depth Infinity`
was the whole fix; `pnpm-workspace.yaml` is unchanged. Same shape as the
2026-07-21 fast-uri clearance, and the opposite of sharp, where next's declared
`^0.34.5` genuinely had no patched version to move into.

Verified in the lockfile rather than in `node_modules`: `pnpm-lock.yaml` now
resolves `js-yaml@4.3.1` and `nanoid@3.3.17` and nothing else, which is what the
CI `--frozen-lockfile` install actually reads. Stale `js-yaml@4.3.0` /
`nanoid@3.3.16` directories survive under `node_modules/.pnpm` — pnpm does not
prune the virtual store on update, and they are unreferenced, not live. Full
gate re-run green afterwards: lint → format:check → typecheck → 165 tests →
build → audit.

### ✅ Phase 3 — the vendor half, closing the vertical slice (2026-08-03)
Magic-link invite → vendor session → status update → photo upload → activity
trail, plus the `/vendors` page staff needed to add a vendor at all (the
`vendors_insert_staff` policy had shipped with no form behind it). New:
`src/lib/supabase/admin.ts`, `src/lib/attachments.ts`, `src/schemas/vendor.ts`,
`src/server/actions/vendors.ts`, `updateWorkOrderStatus` + `recordAttachment`,
`src/app/auth/confirm/route.ts`, `/vendors`, and
`tests/e2e/vendor-loop.spec.ts` (6 specs; 22 e2e total, 150 unit tests).

**No migration.** Every policy, grant, trigger and constraint this needed was
already on `main` from Phase 2 — the stage was application code finally using
them. pgTAP is unchanged at 94 assertions, and the vendor guard and attachment
invariants were already covered there.

**`generateLink` sends no email, and its token is single use** — both verified
against the running stack before any UI was written, because the design leans
on both. The no-email finding is what lets the CI `e2e` job keep excluding the
mail container. Related correction: `inbucket` *is* still a valid `-x` name in
CLI 2.109.1 (`supabase start --help` lists it), so the exclusion lists in both
jobs were left alone.

> **Superseded 2026-08-10** — left above as written, because *how* it was wrong
> is the useful part. `--help` does list `inbucket`, but `--help` is not the list
> the CLI validates against: the runtime accepts `mailpit`, and silently ignores
> `inbucket` instead of rejecting it. So the mail container was never actually
> excluded from either job, and "the exclusion lists were left alone" was the
> wrong call reached by plausible reasoning from the wrong source. Checking
> `--help` was the mistake; the authoritative list is the one the CLI echoes back
> when a name misses. See the `db` job section in `docs/tooling.md`.
>
> **And superseded again 2026-08-25** — the *other* half aged out too. "The
> no-email finding is what lets the CI `e2e` job keep excluding the mail
> container" stopped being true the moment `enable_confirmations` went on: the
> invite still sends no email, but **signup does**, and the job now boots mailpit
> deliberately so the spec can read the link. The finding was right; the
> conclusion drawn from it had a dependency nobody wrote down.

**The admin client reads `SUPABASE_SECRET_KEY` lazily, inside the factory.** At
module scope it would break `next build` in the `verify` job, which has no
stack and no secret — pinned by a test asserting the module imports cleanly with
both variables unset, and confirmed by building with the key removed.

**`inviteVendor` carries an explicit `is_staff()` check**, the only action in
the repo that does. `vendors.profile_id` has no client write grant, so the write
goes through the service role and there is no policy left to lean on;
`vendors_select_staff_or_self` is not a substitute because its
`or profile_id = auth.uid()` arm means a successful read proves nothing.

### ✅ Phase 3 — the staff write path (2026-08-02)
Create a work order → assign a vendor → activity trail, over real RLS.
`src/schemas/work-order.ts`, `src/server/actions/work-orders.ts`
(`createWorkOrder` · `assignVendor` · `addNote`), `src/server/queries/`
(`properties.ts`, `vendors.ts`, plus `getWorkOrder` / `listWorkOrderActivity`),
`/work-orders/new` and `/work-orders/[id]`, and
`src/components/features/work-orders/` (`activity-trail`, shared `labels`). New
primitives: `textarea` and `native-select`; `form-feedback` moved out of the
`(auth)` route group to `src/components/ui/` now that both halves use it.

**A `<select>`, not shadcn's Radix Select.** The Radix one renders divs and
needs a hidden native control to take part in a form POST at all. A real
`<select>` submits with the server action, works before hydration, and gives
phone users their platform picker — which matters for the vendor half.

**`z.guid()`, not `z.uuid()` — this one cost an e2e run to find.** Zod v4's
`uuid()` enforces RFC 9562 version and variant nibbles; Postgres's `uuid` type
enforces neither and stores any 128-bit value. Every id in `seed.sql`
(`10000000-0000-0000-0000-000000000001`) has version/variant nibbles of `0`, so
`uuid()` rejected the whole fixture set and the create form could not be
submitted at all against a seeded stack. The unit tests passed throughout,
because their fixtures were invented v4-shaped ids — so those fixtures are now
the real seeded ones, with a regression case pinning all three shapes.

**Actor names resolve through `staff_directory`, never a `profiles` embed.** A
vendor has no SELECT policy on staff profile rows, so an embed renders every
staff action anonymously for exactly the person who needs to know who assigned
them the job. Pinned by an e2e assertion on the specific trail entry.

`assignVendor` moves status to `assigned` only from `open`, so reassigning a
job mid-repair changes the vendor and not the state. 115 unit tests across 12
files; `tests/e2e/work-orders.spec.ts` adds 5 specs (14 e2e total).
**The vendor half followed on 2026-08-03 — see the ✅ entry above.**

### ✅ Reject empty/whitespace notes on the activity trail (2026-08-02, issue #76)
Forward migration `20260802143000_require_non_blank_activity_note.sql` tightens
`activity_note_requires_text` from `note is not null` to
`note is not null and char_length(trim(note)) > 0`. Landed with the note form —
the first client that could ever write one — and mirrored in `addNoteSchema` so
the form says so before the round trip.

**The null arm has to stay in the predicate.** A CHECK evaluating to NULL
passes, and `char_length(trim(null))` is NULL, so testing the trimmed length
alone would have let a null note through on a `note_added` row — the exact case
the constraint exists to prevent. pgTAP covers empty, whitespace-only, and null
separately (89 assertions, up from 86).

### ✅ Auth forms survive a failed submit (2026-08-01)
Both `useActionState` forms lost every field whenever the action came back with
an error — a mistyped phone on `/signup` cost the user all four. Not a Next.js
behaviour but a React one, and unconditional: in `react-dom@19.2.4`,
`startHostTransition` calls `requestFormReset` **before** running a function
action, and the commit that renders the error state is the same one that calls
`form.reset()`. Success paths were never affected — `redirect()` throws
`NEXT_REDIRECT`, so the form unmounts instead of returning.

`src/server/actions/auth.ts` now echoes the non-sensitive submitted values
(`fullName` · `email` · `phone`) back in `AuthFormState.values` from all four
error returns, and the inputs read them as `defaultValue`. That works *because*
of the same commit ordering: React writes the new default to the DOM during the
mutation phase, and the reset then restores each input to it. Values are echoed
**as typed**, not from `parsed.data` — which does not exist when validation is
what failed, and which has already normalized the phone number the user is being
asked to fix — bounded at 256 characters (past every field's own maximum) since
the action is a public POST endpoint, and skipped for any entry that is not a
string, so a file part cannot come back as `"[object File]"`.

**Passwords are never echoed** and that field alone clears — round-tripping a
credential through the action response to save retyping one field is the wrong
trade. Controlled inputs were the other option and are worse here: a programmatic
`reset()` schedules no re-render, so React state and the DOM can desync.

Covered at three levels: the action tests, an RTL suite per form (new
`signup-form.test.tsx`), and Playwright — the only place the real reset runs —
where the wrong-password spec now asserts the address survives, plus a new spec
signing up with a seeded address (fails on the duplicate, writes nothing, keeps
its fields). 78 unit tests across 10 files; `auth.spec.ts` is up to 8 specs.
**The convention holds for the Phase 3 write-half forms** — see `CLAUDE.md` §0.

### ✅ Phase 3 — Auth loop + self-service signup (2026-07-27)
Login → signup → session-gated shell → work-order list, end to end over real
RLS. `src/schemas/auth.ts` (zod v4 `loginSchema` / `signupSchema` /
`normalizePhone`), `src/server/queries/session.ts` (the DAL: `getSession`,
`requireSession`, `getCurrentProfile`, `isStaff` — `cache()`-memoized behind
`import "server-only"`), `src/server/queries/work-orders.ts`
(`listWorkOrders()`), `src/server/actions/auth.ts` (`signIn` · `signUp` ·
`signOut`), the `(auth)` and `(dashboard)` route groups with `useActionState`
client forms, `work-order-table.tsx`, and five more shadcn primitives (`input`,
`label`, `card`, `table`, `badge`). `/` is now `redirect("/dashboard")`. New
deps: `zod`, `server-only`.

**Auth checks live in pages and the DAL, never in a layout.** Next.js Partial
Rendering means a layout does not re-render on client-side navigation, so a
check placed there silently stops running as the user moves between sibling
routes. The dashboard layout still calls the DAL for the header — convenience,
not the gate.

**Signup was opened in the same change** (`[auth] enable_signup` `false` →
`true`), reversing the 2026-07-17 invite-only decision; the paper trail is the
last section of `docs/schema/my_schema_writeup.md`. Safe because
`handle_new_user()` takes the role only from server-set `raw_app_meta_data` — a
client's `signUp({ options: { data } })` lands in `raw_user_meta_data`, which is
never consulted for role. So every self-registration is an unlinked `vendor`,
`current_vendor_id()` resolves to NULL, and every vendor-scoped policy arm
returns nothing; staff roles still come only from a server-side admin
create/invite or `set_user_role()`. Pinned by
`supabase/tests/03_signup_defaults.test.sql` (9 assertions — the headline one
registers a user claiming `"app_role": "landlord"` in client metadata and
asserts the profile comes out `vendor`).

Forward migration `20260727140000_handle_new_user_phone_from_metadata.sql`: the
trigger read phone from `new.phone` — the `auth.users.phone` column, which only
SMS signup populates — so a phone typed into the email signup form was accepted
and silently dropped. It now falls back to `raw_user_meta_data ->> 'phone'`
(`auth.users.phone` still wins when set), and `nullif(trim(...), '')` stops a
whitespace-only name or phone from satisfying the length CHECKs.

**CI changed with it.** The `e2e` job — now *E2E (Playwright auth loop)*,
`timeout-minutes: 20` — boots a real stack (`supabase start -x …` → `db reset` →
`.env.local` written from `supabase status -o env | grep '^NEXT_PUBLIC_'`). Its
placeholder `NEXT_PUBLIC_SUPABASE_*` env was **removed, not updated**: process
env outranks `.env.local` in Next, so a leftover placeholder would have
outranked the real values and pointed the app at a stack that isn't there.
`tests/e2e/auth.spec.ts` (7 specs) covers both seeded roles, self-registration,
a wrong password, the signed-out redirect, the root redirect, and sign-out;
`smoke.spec.ts` stays. `playwright.config.ts` `baseURL` moved
`localhost` → `127.0.0.1` to match `[auth] site_url` (cookies are per-host, so
an auth redirect across the two hostnames would strand the session), with a
matching `allowedDevOrigins` in `next.config.ts`. On the unit side,
`tests/unit/harness.test.tsx` was deleted — real component tests replaced the
placeholder — and `tests/unit/server-only-stub.ts` is aliased in
`vitest.config.ts` so Vitest can import modules guarded by `server-only`
without switching React to its server build.

**Two accepted risks came with opening signup**, both filed above. Email
confirmations were the first, and are **closed as of 2026-08-25** (issue #93 —
see ✅ below). CAPTCHA (🟡) is still open.

### ✅ Typed env vars + committed `.env.example` — closed, solved another way (2026-07-27)
Closed rather than completed as written. The ask was `@t3-oss/env-nextjs` + zod;
what shipped instead (2026-07-21, issue #37) is `src/lib/supabase/env.ts` plus a
`supabaseEnv()` call at the top of `next.config.ts` — a missing variable throws
while the config loads, so an unusable bundle is never emitted, and the key is
additionally rejected unless it is specifically `sb_publishable_…` (a secret key
on a `NEXT_PUBLIC_*` var would be inlined into the browser bundle and bypass
RLS — stricter than "is it set?"). `.env.example` is committed, via the
`!.env.example` negation in `.gitignore`.

Adding t3-env now would be a second mechanism for a solved problem, over two
environment variables. `zod` **is** installed as of 2026-07-27 — as a direct
dependency for `src/schemas/`, which is what the §3 half of the original line
was actually about. Revisit only if the env surface grows past a handful of
vars.

### ✅ Narrow `service_role` table privileges (2026-08-01)
Two forward migrations replace the seven application tables' `GRANT ALL`
surface with their documented row operations. `work_order_activity` is now
strictly `SELECT, INSERT` for `service_role`, with `UPDATE, DELETE, TRUNCATE`
explicitly revoked so the append-only audit guarantee no longer depends on RLS
that the service key bypasses. The coordinated work-order hard delete still
works: the privilege on the parent authorizes its `ON DELETE CASCADE` activity
cleanup without any direct child `DELETE` grant.

The required six-table sweep found the same administration-level overgrant on
every sibling table. A separate migration keeps their ordinary
`SELECT, INSERT, UPDATE, DELETE` lifecycle surface while removing `TRUNCATE`,
`REFERENCES`, `TRIGGER`, `MAINTAIN`, and future privileges implied by `ALL`.
`DELETE` remains deliberate on `work_orders` and `work_order_attachments` for
the coordinated cleanup flows; `TRUNCATE` never was, and on attachment metadata
it could orphan Storage objects. pgTAP pins each exact grant set, explicitly
checks that the activity trail cannot be deleted or truncated through
`service_role`, and exercises the parent cascade. `db reset` and all 86 database
assertions pass locally.

### ✅ Guard deletion of the final landlord profile (2026-07-27)
A forward migration chose the database hard-block semantics from the review:
`BEFORE DELETE` now refuses to remove the final landlord profile with a loud
`42501`, including when the delete reaches `profiles` through the
`auth.users` cascade. Landlord deletes take the same transaction advisory lock
as demotions before checking for a replacement, so concurrent removals are
serialized against each other. An administrator must promote another landlord
before deleting the current final one. pgTAP exercises a successful non-final
direct delete, a refused final direct delete, and the `auth.users` cascade while
confirming the auth user and profile both survive the failed transaction.

### ✅ GitHub repo scaffolding (2026-07-27, issue #31)
`.github/pull_request_template.md`, three issue forms (`bug` · `feature` ·
`chore`) plus `config.yml`, `.github/CODEOWNERS`, `CONTRIBUTING.md`, and
`SECURITY.md`. Issue forms mirror this file's **Why / Do / Done when** shape, so
a block here copies straight across.

Three things worth keeping. **Every template renders from the default branch
only** — the issue forms, `config.yml`, *and* `pull_request_template.md` all do
nothing until they are on `main`, so "it's on `dev`" is not done. GitHub's
wording for the PR template is the same as for the issue forms: "available to
collaborators when they are merged into the repository's default branch."
`CODEOWNERS` is the lone exception and works the other way round — it is read
from a PR's **base** branch, so it takes effect on `dev` a merge earlier than
the templates do. **A label named in a form
that doesn't exist is silently dropped** — the issue just opens unlabeled, no
error anywhere; the forms only auto-apply `bug` and `enhancement`, both GitHub
defaults, and `chore.yml` ships label-free on purpose.

And **`CODEOWNERS` is a record, not a gate.** GitHub never requests review from
a PR's own author, so `* @Damilss` is inert on self-authored PRs and only fires
on Dependabot's. "Require review from Code Owners" stays **off**: it could never
be satisfied solo, so every merge would become an admin override and branch
protection would stop meaning anything.

`SECURITY.md` names an email channel because **GitHub private vulnerability
reporting and repository security advisories are both public-repository
features** — per GitHub's docs, "Owners and administrators of public
repositories can enable private vulnerability reporting." Same GHAS-on-private
wall as CodeQL and push protection. The switch-over triggers (repo goes public,
or issue #74 fills the `TOS.md` contact placeholder) are written into the policy
itself.

### ✅ Supabase clients — Phase 2 complete (2026-07-21, issue #37)
`@supabase/ssr` + `@supabase/supabase-js` installed; `src/lib/supabase/`
(`client.ts` · `server.ts` · `proxy.ts` · `env.ts`) wired to a root `src/proxy.ts`,
plus a committed `.env.example` (`.gitignore` now negates `.env*` for it).

**Next.js 16 renamed the root `middleware` convention to `proxy`** — every
`@supabase/ssr` guide still says `middleware.ts` and is wrong for this repo. The
file is `src/proxy.ts` exporting `proxy`; `next build` reports it as
`ƒ Proxy (Middleware)`.

Two decisions worth keeping: the clients read the **publishable** key
(`sb_publishable_…`), not the legacy anon JWT — it is what a new Supabase project
issues, so Phase 4 needs no rename; and `env.ts` reads
`process.env.NEXT_PUBLIC_*` as literal member expressions, because Next inlines
those by static analysis and a dynamic `process.env[name]` lookup would silently
be `undefined` in the browser bundle.

**The proxy does session refresh only** — no route protection. The Next proxy
guide scopes it to optimistic checks, not authorization; RLS plus server-side
checks stay the trust boundary (`CLAUDE.md` §2). Auth redirects belong to Phase 3.

Verified against the running local stack, not just typecheck: anonymous reads on
`properties` are refused, the seeded manager sees 2 properties / 5 work orders,
and the vendor sees 3 work orders — matching the pgTAP expectations.

**CI needed a fix:** the proxy runs on every request and fails loudly on missing
config, so the `e2e` job (which boots the app but runs no Supabase stack) served
500s on every page. It now sets placeholder `NEXT_PUBLIC_SUPABASE_*` values —
confirmed sufficient because with no session cookie the refresh short-circuits
before any network call. The `verify` job needs nothing; `next build` does not
execute the proxy.

### ✅ First migrations merged to `main` (2026-07-21, PR #78)
The Phase 2 schema batch — 9 migrations, `seed.sql`, the pgTAP suite, the CI
`db` job, and the generated `database.types.ts` — went `dev` → `main` through
branch protection with CI green. **`main` is now the migration baseline:**
every schema change from here is a new timestamped forward migration, never an
edit to a merged file, because the merged ones have been applied to trees other
than the local one. Phase 2's remaining runway is the `@supabase/ssr` clients
(issue #37); the schema-review findings below are follow-up migrations, not
re-writes.

### ✅ fast-uri + sharp high advisories cleared (2026-07-21)
Two highs were failing the blocking `pnpm audit` gate and split across the
`docs/tooling.md` rule for when an override is warranted, so they were fixed
differently: **fast-uri** (GHSA-v2hh-gcrm-f6hx) was a stale lockfile pin inside
ajv's declared `^3.0.1` range — cleared with `pnpm update fast-uri --depth
Infinity`, lockfile-only. **sharp** (GHSA-f88m-g3jw-g9cj, libvips
CVE-2026-33327/33328/35590/35591) is patched in `>=0.35.0`, but `next` still
declares `sharp: ^0.34.5` as of 16.2.11 — no upstream release to move into, so
it took the first `overrides` entry in `pnpm-workspace.yaml`, range-scoped to
`sharp@<0.35.0`. **Remove that override once Next's floor reaches `>=0.35.0`.**
Supersedes the "1 low + 1 moderate remain" snapshot in the 2026-07-20 entry
below.

### ✅ pgTAP database suite in CI (2026-07-21, issue #72)
Parallel `db` job in `ci.yml`: pinned CLI devDependency, `supabase start -x …` →
`db reset` → `test db`, on the existing `main`/`dev` PR/push triggers with no
path filtering. The `-x` list must never include `db` or `storage` — reasoning,
and the rest of the design, in `docs/tooling.md`.
**Two halves — only the first is done.** The job runs; making it *blocking*
needs it added to `main`'s required checks in Settings → Branches, which GitHub
only allows once the job has reported at least one run. It has now reported —
PR #78 ran it — so **the setting is unblocked and this is a one-click todo**.
Until it's flipped, a red `db` job does not stop a merge.

### ✅ Branch protection on `main` (2026-07-20)
Configured in Settings → Branches, closing the `CLAUDE.md` §4/§5 Phase-1
requirement. GitHub repo settings aren't version-controlled, so this entry is
the only in-repo record — the authoritative rule (required checks, approvals,
force-push/deletion blocks, administrator inclusion) is whatever Settings →
Branches shows. Note for new checks: a job must run **once** before it becomes
selectable as required, so adding a workflow job does not make it blocking on
its own (see `docs/tooling.md` on the `e2e` job).

### ✅ Three high-severity advisories cleared (verified 2026-07-20, issues #62/#63/#64)
`@babel/core` (GHSA-4x5r-pxfx-6jf8), `js-yaml` (GHSA-h67p-54hq-rp68), and
`postcss` (GHSA-qx2v-qp2m-jg93) are all resolved in the current lockfile —
`pnpm audit --audit-level=high` exits clean (1 low + 1 moderate remain, both
below the gate). `js-yaml` sits at 4.3.0, past the 4.2.0 the issue asked for.
A `postcss@8.4.31` still resolves under Next's own bundled dependency block
alongside 8.5.16; the audit does not flag it, so it needs no action, but it is
the thing to re-check if that advisory is ever re-scored.

### ✅ Phase 2 — Supabase local + schema + RLS + seed + pgTAP (2026-07-17, merged to `main` 2026-07-21, issues #34/#35)
Supabase CLI pinned as a devDependency (`supabase` ^2.109.1, install script
allow-listed in `pnpm-workspace.yaml`). Nine migrations create the seven §7
tables — RLS + grants + triggers in the **same file** as each table: landlord =
manager superset (deletes + role management via `set_user_role()`); all staff
see all properties; vendors scoped to assigned work orders with a fail-closed
column-guard trigger (status only → `in_progress`/`completed`); append-only
`work_order_activity` auto-logged from work-order changes; private
`work-order-attachments` bucket with path-derived object policies. `seed.sql`:
3 login-able users (`landlord|manager|vendor@realtyworks.test`), 2 properties,
3 units, a linked vendor, 5 work orders covering every status —
`pnpm exec supabase db reset` = one-command known-good state. pgTAP suite in
`supabase/tests/` (`pnpm exec supabase test db`). `database.types.ts`
generated. Post-review hardening (same day, two rounds — 44 pgTAP tests
final): composite FK ties a work order's unit to its property;
`staff_directory` view gives vendors staff **names only** (no whole-row
profile reads); attachment `storage_path` CHECK enforces the exact
`<work_order_id>/<attachment_id>.<ext>` shape; last-landlord demotions
serialize on an advisory lock (concurrent-demotion race); attachment deletes
have **no client surface** on either layer — coordinated Phase 3 server
action only (`storage.protect_delete()` makes a transactional DB-side revoke
impossible, so one-sided deletes are simply removed). Signup shipped
invite-only (`[auth] enable_signup = false`) — **reversed 2026-07-27, see the
auth-loop entry above**; the surviving gotcha is that
`[auth.email].enable_signup` must stay `true`, since turning it off disables the
whole email provider including logins (documented in `config.toml`). Full
design + decisions: `docs/schema/my_schema_writeup.md`.

### ✅ SAST in CI (Semgrep OSS) — verified in place 2026-07-17
`security.yml` runs a blocking `semgrep` job (digest-pinned container,
`p/typescript` + `p/react` + `p/nextjs` + `p/owasp-top-ten`) on PR/push to
`main`/`dev`, findings rendered as PR annotations. Was still listed as an open
🟠 item long after landing — the "Recommended order" footer already counted it
done.

### ✅ Harden GitHub Actions supply chain — verified in place 2026-07-17
Every `uses:` in `ci.yml` / `security.yml` / `osv-scanner.yml` is pinned to a
full commit SHA with a version comment; workflows carry least-privilege
`permissions:`; the semgrep `container:` image is digest-pinned (Dependabot
bumps `uses:` SHAs; the container pin is bumped manually — `docs/tooling.md`).

### ✅ Wire Playwright into CI — verified in place 2026-07-17
`ci.yml` has the parallel `e2e` job exactly as specced: installs Chromium,
caches the browser, runs `pnpm test:e2e`, uploads the HTML report artifact, on
every PR/push to `main`/`dev`. (Supersedes the old "local-only by design"
note.)

### ✅ Tune Dependabot + pin `@types/node` to Node 24 (2026-07-08, issue #23)
`.github/dependabot.yml`: both ecosystems now **group** bumps (npm splits into
`npm-production` / `npm-development`, github-actions into one; each bundles
major+minor+patch), carry the house `deps` commit prefix (`prefix` +
`prefix-development` on npm) instead of `chore(deps)`, and get a `dependencies`
label. `@types/node` is pinned to `^24` in `package.json` (matches Node 24 in
`.nvmrc`) and an npm `ignore:` rule drops any `@types/node` major beyond 24.x,
so the types track the runtime instead of leading it. `open-pull-requests-limit`
kept at 10 (grouping already cuts the real PR count). `pnpm typecheck` +
`pnpm build` green on `@types/node@24`. Rationale: `docs/tooling.md` §Dependabot.

### ✅ Untrack the committed pnpm store (2026-07-07)
`.pnpm-store/v11/index.db` (pnpm's local content-addressable store index) had
been committed by mistake. Added `.pnpm-store` to `.gitignore` and `git rm
--cached`'d the binary so it stops riding along in the tree. It's a per-machine
build artifact regenerated on `pnpm install` — never versioned.

### ✅ Vitest DOM environment + Testing Library
`happy-dom` environment + React Testing Library wired into Vitest. Dev deps:
`happy-dom`, `@testing-library/react` (+ its required `@testing-library/dom`
peer), `@testing-library/jest-dom`, `@testing-library/user-event`.
`vitest.config.ts` sets `environment: "happy-dom"`, `globals: true` (RTL's
automatic per-test cleanup), `setupFiles: ["./tests/unit/setup.ts"]`, and
`resolve: { tsconfigPaths: true }` — Vite 8's **native** `@/*` alias resolution,
so **no** `vite-tsconfig-paths` plugin (the recipe below first specced one;
Vite 8 does it in core). `tests/unit/setup.ts` imports
`@testing-library/jest-dom/vitest`; `vitest.d.ts`
(`/// <reference types="vitest/globals" />`, ESLint-ignored like `next-env.d.ts`)
types the globals without a tsconfig `types: [...]` array. Proof:
`tests/unit/harness.test.tsx` (render + jest-dom matcher + user-event) is green.
No `ci.yml` change — rides the existing `verify` steps. `@vitejs/plugin-react`
not needed (no `act()` warnings). happy-dom over jsdom per speed/footprint.

### ✅ Secret scanning (gitleaks) in CI + pre-commit — issue #19, PR #41
CI job on push + PR (full-history scan), `gitleaks git --pre-commit --staged`
in `.husky/pre-commit` (fail-safe when the binary is missing), committed
`.gitleaks.toml` (default rules + anchored `pnpm-lock.yaml` allowlist).
Follow-up hardening: `pull-requests: read` permission for the action.

### ✅ Dependency vulnerability gate — issue #20, PR #43
`pnpm audit --audit-level=high` in CI + weekly `osv-scanner` reusable workflow
(SARIF upload off: GHAS-gated on private repos). Landed **non-blocking** to
triage pre-existing advisories, then flipped to **blocking** (deliberate manual
edit, not date-based) once the one high finding — GHSA-fx2h-pf6j-xcff
(`vite`, dev-only peer of vitest) — was cleared by pinning `vite ^8.0.16` as a
direct devDependency (pnpm overrides don't move auto-installed peers).
Web-UI half (enable Dependabot **alerts** + **security updates** in Settings →
Security) — verify it's on.

### ✅ Flip the `pnpm audit` gate to blocking
Removed `continue-on-error: true` from the **Audit dependencies** step; a
high/critical advisory now fails CI. Cleared the blocking `vite` advisory
(GHSA-fx2h-pf6j-xcff) first by pinning `vite ^8.0.16` as a direct devDependency
(pnpm `overrides` don't move auto-installed peers). Comment de-staled.

### ✅ Enforce conventional commits (commitlint + commit-msg hook) — PR #40
`@commitlint/cli` + `config-conventional`, `commitlint.config.mjs` with the
decided type list (standard set + `deps`; `CI/CD` retired in favor of `ci`),
`.husky/commit-msg` running `commitlint --edit`.

### ✅ Extend CI/security/testing triggers to `dev` (2026-07-07)
`dev → main` integration flow went live. Added `dev` to the `push`/`pull_request`
`branches:` lists in `ci.yml` (verify + e2e) and `security.yml` (gitleaks +
Semgrep), so CI, secret, and SAST scans now run on `dev` pushes and PRs into
`dev`. `osv-scanner.yml` gained a `pull_request: [main]` trigger (chosen over
dev-push triggers — lowest noise, scans right before merge), keeping the weekly
cron + `workflow_dispatch`. No job renamed, so `main` branch-protection
required-check names are unchanged; the OSV scan surfaces as a non-required
(advisory, emails-on-fail) check on `dev → main` PRs. Docs synced: `tooling.md`,
`README.md`, `CLAUDE.md` §0.

---

## 🟠 High

### 🟠 Emailed tokens are redeemed on GET, so a mail scanner spends them (2026-08-28, PR review, P2)
**Why:** `/auth/confirm` calls `verifyOtp` from its `GET` handler, so *fetching*
the link is redeeming it. Mail security gateways — Defender Safe Links,
Proofpoint, Mimecast — follow URLs in a message before the recipient sees it.
Reproduced against the local stack with plain `curl`, no browser and no JS:

```
1st GET (the scanner):    307 → /account-setup
2nd GET (the recipient):  307 → /login?error=invalid-link
```

The recipient is locked out of their own link. Against a deterministic corporate
scanner this is not a flake — every replacement link burns the same way, so
signup and recovery both dead-end for that user, permanently.

**Worse than losing the token:** the same GET mints the session, so the scanner
is handed `sb-…-auth-token=…; Max-Age=34560000; SameSite=lax` — a ~400-day
session for someone else's account. Most scanners discard cookies; nothing here
should depend on that, and `signOut` is `scope: "local"`, so nothing revokes it.

**Not introduced by email confirmations.** `/auth/confirm` has redeemed
`magiclink` and `invite` on GET since the vendor half (2026-08-03); issue #93
widened the same mechanism to `signup` and `recovery`. All four are exposed.
The repo already holds the principle this breaks — `src/app/(dashboard)/layout.tsx`
uses a form POST for sign-out precisely because "a GET logout gets fired by link
prefetching and by anything that crawls the page."

**There is no cheap mitigation.** `Cache-Control: no-store` does not deter a
scanner, User-Agent sniffing is unreliable in exactly the direction that matters,
and "redeem only on POST" *is* the interstitial. Real fix or nothing.

**Sized 🟠, like the two gates before it:** nothing is exposed today, because
nothing is deployed and local mail goes to mailpit, which follows nothing. It
goes live the moment real mail leaves Resend — and it fails *closed for
legitimate users*, which is the worst kind of onboarding bug, because the people
it locks out are the corporate recipients this product is sold to.

**Do:** land the emailed link on a non-mutating page that renders an explicit
"Confirm your email" / "Sign in" button, and redeem through a POST that carries
`token_hash` and `type` into a server action running `verifyOtp`. Apply it to all
four types — leaving `invite` on GET keeps the vendor path exposed and makes one
endpoint behave two ways. `safeNext()` moves across unchanged; it constrains the
destination, not the method.

**Expect the tests to be most of the work.** `src/app/auth/confirm/route.test.ts`
(8 cases) and the redirect-guard loop in `tests/e2e/vendor-loop.spec.ts` (8
hostile payloads, one browser context each) both drive the endpoint by
navigation. Carry that coverage across intact, and re-check it the way §5
demands — delete `safeNext()` once and watch the specs fail. That suite exists
because the redirect hole (#105) shipped green under a test that never reached
the guarded line.

**Done when:** a bare `GET` of an emailed link leaves the token unspent and sets
no cookie; a spec proves it by fetching the link first and *then* redeeming it in
a browser and landing signed in; and the redirect-guard table still fails when
`safeNext()` is removed.

---

## 🟡 Medium

### 🟡 Trim required text fields before the length CHECK (issues #75, #77)
**Why:** Round 5 fixed `city`/`state`/`postal_code` with `char_length(trim(...)) > 0`
but left the neighbouring `between 1 and N` checks untrimmed, so a whitespace-only
value still satisfies them: `'   '` is length 3. Same root cause as the round 4/5
empty-string findings — `NOT NULL` is not non-blank
(`docs/reports/2026-07-17-phase-2-schema-review-hardening.md`).
**Do:** new migration wrapping the required-text CHECKs in `trim()`:
`properties.name` / `address_line1`, `units.label`, `vendors.name`,
`work_orders.title`. Sweep `work_order_attachments.file_name` in the same pass —
the issue omits it but it carries the identical `between 1 and 255` check (the
insert is service-role-only, so the exposure is a buggy server action, not a
client). Add pgTAP coverage per field.
**Note:** #75 (the defect) and #77 (the fix) describe the same problem — close
one as a duplicate.
**Done when:** a whitespace-only value is rejected on every required text column,
with a pgTAP assertion each.

### ✅ Sign-out scoped to the current session (2026-08-25, issues #92, #98)
Rode along with the email-confirmations change, which is what this entry asked
for: "fold it into the next change that touches `src/server/actions/auth.ts`
rather than letting it take a session of its own."

`signOut()` now passes `{ scope: "local" }`. Previously it passed nothing, and
`@supabase/auth-js` declares the default as `{ scope: 'global' }` — so clicking
a button labeled "Sign out" revoked **every** refresh token the account held.
The failure was delayed rather than visible: global scope kills the refresh
token while the other device's access-token JWT stays valid until `jwt_expiry`
(3600s), so that device worked normally for up to an hour and then bounced off
`src/proxy.ts` to `/login`. An apparently random logout an hour later is what
made this worth fixing rather than documenting.

The unit assertion moved from `toHaveBeenCalledOnce()` to
`toHaveBeenCalledWith({ scope: "local" })` — an arity-only assertion would let
the global default creep back silently. A deliberate "sign out everywhere"
control is still **not** in scope; that is a Phase 5 account-settings affordance,
and `scope: "others"` exists for it. Close #98 as a duplicate of #92.

### 🟡 Reassignment does not revoke an outstanding invite link (PR review, P2)
**Why:** `docs/playwright.md` and `README.md` both listed "revocation on
reassignment" among the vendor-loop guarantees, and neither the code nor the test
delivers one. `assignVendor` (`src/server/actions/work-orders.ts`) writes
`vendor_id` — and a status bump from `open` — and touches nothing else; nothing in
GoTrue, nothing in `vendors.profile_id`. The spec it leaned on discards the URL it
minted and asserts only `getByLabel("Sign-in link")` is gone from the *manager's*
page, which is the `key={assignedVendor.id}` remount dropping the panel's
`useActionState`. So a link copied before the reassignment still redeems and still
signs its holder in as the **outgoing** vendor. RLS does hide the reassigned job
from them; their other assigned jobs are exactly as visible as before.

**The overclaim is fixed** (2026-08-12) — both docs now say "clears the stale
link from the page", the caveat is spelled out under the spec table in
`docs/playwright.md`, and the spec is renamed to what it asserts. What is left is
the product question, filed here rather than silently closed.

Sized Medium, not High, deliberately: the token grants precisely the access the
manager *intended* to grant that vendor minutes earlier, it is single use, and it
dies in an hour (`[auth.email] otp_expiry = 3600`). The defect was the promise,
not the exposure. Move it up if the intended semantics turn out to be "reassign =
cut off", which is the call below.

**Decide first, then build:** does reassignment mean "this job moved" or "that
vendor is out"? Today it means the first, and the second already has a lever —
unlink `vendors.profile_id` and `current_vendor_id()` resolves NULL on the very
next request, mid-session (`docs/vendor-access.md` §6). No UI exposes it, which is
the more useful gap. Note also that token revocation alone would be theatre: if
the outgoing vendor already *redeemed* the link they hold a live session, and only
the `profile_id` unlink touches that.

**Do (in order):** (1) add the deliberate "revoke vendor access" control that
unlinks `profile_id`, with an activity-trail entry — that is the real requirement
§3c asked for; (2) only if reassignment should imply it, call that same path from
`assignVendor` and say so in the UI, since silently cutting a vendor off from
their *other* jobs because one moved would be worse than the current behaviour.
Do **not** resurrect the rejected `vendor_access` table for this
(`docs/vendor-access.md` §6) — per-invite `revoked_at` buys nothing the
`profile_id` unlink does not already give.

**Done when:** whichever semantics is chosen, an e2e spec mints a link, triggers
the revocation path, *replays the URL it kept*, and asserts the holder does not
end up with a working session — the assertion the current spec skipped.

### 🟡 A sign-in failure blames the password even when Supabase is unreachable
**Why:** `signIn()` in `src/server/actions/auth.ts` collapses every non-429
failure into one string:

```ts
return { error: isRateLimited(error) ? RATE_LIMITED : INVALID_CREDENTIALS, values };
```

So a wrong password, an unknown account, a typo'd domain **and a dead auth
service** all render as `Invalid email or password.` The first two have to be
merged — distinguishing them turns the form into an account-enumeration oracle,
and that reasoning is sound. It does not extend to the third: a transport
failure carries no enumeration signal at all, because it happens before any
account is looked up.

**The mechanism is specific.** `@supabase/auth-js` (2.110.7) throws
`AuthRetryableFetchError` with status **0** when the fetch itself fails
(`lib/fetch.js:38` and `:124`), or the upstream status when there is one
(`:42`). `isRateLimited()` tests `status === 429 || code ===
"over_request_rate_limit"`, so status 0 falls straight through to the
credential message. `signUp()` has the same shape one branch down — an
unreachable stack reports `Could not create that account. If you already have
one, sign in.`

**This is not hypothetical; it cost a session on 2026-08-08.** A vendor login
was investigated as a credentials problem, then as an RLS linkage problem,
before the local stack turned out to have been killed by Docker. The form had
said the password was wrong. Every layer below it was fine, and the one
component positioned to say so said the opposite.

**The precedent for fixing it is already in the file.** `RATE_LIMITED` exists
because 429 is *actionable* and deserves its own message, and
`auth.test.ts` pins it with a test named "distinguishes rate limiting, which is
actionable". An unreachable backend is equally actionable and equally free of
enumeration risk; this only extends a principle the module already applies.
**Do:** branch on transport failure before falling through to the credential
message. Prefer auth-js's exported `isAuthRetryableFetchError()` over sniffing
`status === 0` — it is the library's own predicate, and it survives the status
being 0 in one code path and upstream in another. Add a third constant
(something like `Can't reach the sign-in service. Try again in a moment.` —
generic, no host, no stack detail) and mirror the branch in `signUp()`. Cover
both with unit tests alongside the existing rate-limit one.
**Done when:** with the local stack stopped, `/login` reports that the service
is unreachable rather than that the password is wrong, and a seeded account
still gets `Invalid email or password.` for a genuinely wrong password — both
pinned in `src/server/actions/auth.test.ts`.
**Ride-along:** lands in the same file as the sign-out scope fix above; do them
together.

### 🟡 Finish the ToS + Privacy Policy drafts (issue #74)
**Why:** Required before any public or multi-tenant launch; both are currently
banner-marked **DRAFT — NOT FOR PUBLICATION** and unusable for customer
acceptance.
**Do:** the drafts landed as `TOS.md` and `privacy_policy.md`. Remaining: fill
every `[BRACKETED]` placeholder (effective date, legal email, mailing address),
verify the described features and subprocessors against what actually ships,
remove the internal publication checklist, then get qualified U.S./California
counsel review.
**Done when:** both documents are placeholder-free, counsel-approved, and linked
from the app.

### 🟡 Extract the thrice-copied `submittedValues()` form-echo helper
**Why:** `CLAUDE.md` §0 requires every `useActionState` form to echo its
non-sensitive submitted values back, because React resets an uncontrolled form
after *every* function action. The helper that does it now exists in **three**
action modules — `auth.ts`, `work-orders.ts`, and (since 2026-08-03)
`vendors.ts` — which is exactly the "3+ real things" threshold §3 names for
extracting. It was left duplicated deliberately while the vendor half was in
flight: the copies differ (one is typed to `AuthFormValues`, the others to
`Record<string, string>`; `MAX_ECHOED_LENGTH` is 256 in two and 2100 in the
other, tracking each module's longest field), and unifying them mid-stage would
have widened a feature diff into a refactor of two files it did not otherwise
touch.
**The actual risk is drift**, not the duplication itself: three copies of a rule
about *not losing user input* will eventually disagree about which fields are
sensitive, and the failure is silent — a password echoed back, or a field
quietly dropped on error.
**Do:** one `submittedValues(formData, names, maxLength)` in a shared module
(`src/server/actions/form-state.ts` is the obvious home), generic over the value
shape, with the per-module maximum passed in rather than baked in. Keep the
three `FormState` types where they are — they are genuinely different shapes.
**Done when:** one implementation, all three modules using it, and the existing
action tests still pass unchanged.

### 🟡 Restore the full-height page shell dropped by the Tailwind v4 scaffold (issues #86, #89)
**Why:** The pre-Tailwind root layout sized the document:
`<html className="… h-full antialiased">` with
`<body className="min-h-full flex flex-col">`. The v4 scaffold commit (8263085)
rewrote both lines and kept neither — `src/app/layout.tsx` is now
`<html lang="en" className={…}>` over `<body className="font-sans antialiased">`.
The pair was load-bearing together: `min-h-full` on the body resolves against a
sized parent, so dropping `h-full` from `<html>` would have neutered it even if
the body class had survived.

**The blast radius is smaller than it looks, which is exactly why it has sat
here.** Both route groups size themselves — `src/app/(auth)/layout.tsx:10` and
`src/app/(dashboard)/layout.tsx:22` each open with `min-h-svh` — so every page a
user can currently reach looks right. What has no height context is anything
rendering *outside* those groups, and `src/app/` today has no `not-found.tsx`,
`error.tsx`, or `global-error.tsx` at any level, so Next's built-in versions
render straight under the root layout. `src/app/page.tsx` is a bare `redirect()`
and never paints. So the regression is real but currently invisible, and it
becomes visible the moment a root-level error or 404 surface is added — likely
during Phase 4, when a deployed app starts producing real 404s.
**Do:** restore `h-full` on `<html>` and `min-h-full flex flex-col` on `<body>`.
**Keep `font-sans`** — it arrived later (5f7efc5) and is deliberate; the comment
above it in `layout.tsx` explains that `globals.css` maps `--font-sans` to Geist
via `@theme inline` but nothing applied it, so removing the class silently
reverts the app to the browser default font. Then decide whether the two
route-group `min-h-svh` wrappers stay or become redundant; leaving both is
harmless, so prefer leaving them unless one demonstrably fights the other.
**Note:** #89 carries the `duplicate` label against #86 — close one as a
duplicate, same as the #75/#77 pair above.
**Done when:** a surface rendered outside both route groups fills the viewport —
add a root `not-found.tsx` and check it, since that is the page most likely to
expose this in production — and both route groups render unchanged.

### 🟡 Configure prettier-plugin-tailwindcss for Tailwind v4 (issue #87)
**Why:** `.prettierrc` loads `prettier-plugin-tailwindcss` (0.8.1) with no
options. Under Tailwind v3 the plugin found the theme through
`tailwind.config.js`; v4 has no such file — this repo's theme lives in
`@theme inline` inside `src/app/globals.css` (`CLAUDE.md` §0) — so the plugin
resolves no theme at all and treats **every theme-derived utility as unknown**.
Unknown classes sort to the front, which is why class strings across the repo
lead with tokens instead of layout. Confirmed by probe:

```
# as configured today
<div className="bg-background border-input flex p-4 text-sm" />
# with the stylesheet resolved
<div className="flex border-input bg-background p-4 text-sm" />
```

That is not a cosmetic difference — the second is Tailwind's real order (layout,
then border, then background, then spacing, then type) and the first is the
plugin failing to recognize `bg-background` and `border-input` as utilities at
all. `pnpm format:check` is green either way, because the gate only enforces
*consistency* with whatever the plugin currently believes; it cannot tell that
the plugin is running blind. **19 files reflow** once the option is set.

Second half of the same fix: `tailwindFunctions`. The plugin already sorts
strings inside a `className` attribute — including `className={cn("…")}` — but
a `cva(…)` or a bare `cn(…)` assigned to a variable is left untouched, verified
by the same probe. `src/components/ui/button.tsx` is the case that matters,
since every variant string there is a `cva` argument.
**Do:** add `"tailwindStylesheet": "./src/app/globals.css"` and
`"tailwindFunctions": ["cn", "cva"]` to `.prettierrc` (confirm the exact option
names against the installed plugin's docs — 0.8.x renamed some of them), then
`pnpm format` and commit the reflow. **Land it as its own commit**, separate from
any behaviour change: it touches 19 files and reviewing a real diff buried in a
repo-wide reformat is how a regression gets waved through.
**Done when:** `pnpm format:check` is green with the options set, the probe above
produces the second ordering, and a `cva` argument in `button.tsx` sorts.

### 🟡 Re-check (or drop) the `minimatch@<9` override — the reported crash does not reproduce (issue #84)
**Why:** The issue reads as a live bug: the `minimatch@<9: ^10.0.0` override in
`pnpm-workspace.yaml` forces v3-era consumers onto v10, and v10's CJS entry
exports a plain object rather than the callable v3 `module.exports`, so any
consumer doing `require("minimatch")(path, pattern)` gets
`TypeError: minimatch is not a function`. The mechanism is real —
`typeof require(".../minimatch/dist/commonjs/index.js")` is `"object"`, not
`"function"`.

**It does not reproduce on this tree, and the entry exists to record why.** Only
two runtime packages declare a `<9` range and are therefore forced:
`@eslint/config-array@0.21.2` and `@eslint/eslintrc@3.3.5`, both at
`minimatch: ^3.1.5`. Neither calls it as a function. `config-array` reads
`minimatch.Minimatch` off the namespace (`dist/cjs/index.cjs:224`), which v10
provides. `eslintrc` looks riskier — `dist/eslintrc.cjs:1043` destructures
`const { Minimatch } = minimatch__default["default"]` through Rollup's
`_interopDefaultLegacy` — but that helper checks for a `default` key, v10's CJS
module has none, so it wraps the namespace as `{ default: ns }`, the
destructure finds the class, and `new Minimatch()` constructs. Verified by
running that exact interop against the installed 10.2.5, and `pnpm lint` is
green. (The other `<9` declarations the grep turns up — `fast-glob`,
`micromatch`, `dom-accessibility-api` — are devDependencies of those packages
and are never installed transitively.)

So the override is currently harmless, and the risk is **latent**: a future
plugin that calls the v3 default export directly would break at lint time with a
confusing error pointing at a package nobody edited.
**Do:** keep the override, and add a comment beside it in `pnpm-workspace.yaml`
recording the two forced consumers and that both were checked — the existing
comment explains why the override exists but not what it lands on. Re-check
whenever a new ESLint plugin is added. The override becomes removable once
nothing declares `<9`; `pnpm why minimatch` answers that in one command.
**Done when:** the comment names the forced consumers, and the issue is closed as
not-reproducing with the interop check recorded on it rather than left open as a
suspected crash.

### 🟡 Use `fileURLToPath()` for the `server-only` alias in `vitest.config.ts` (issue #102)
**Why:** The alias is built with `new URL("./tests/unit/server-only-stub.ts",
import.meta.url).pathname`. `.pathname` is a **URL** component, not a filesystem
path: it stays percent-encoded, and on Windows it keeps a leading slash before
the drive letter. Under the current checkout
(`/Users/emilio/vsprojects/realtyworks`) the two forms are identical, which is
why every test passes — but a clone into a directory containing a space or any
non-ASCII character resolves to `…/my%20projects/…`, the alias silently fails to
match, and every `src/server/queries/**` test dies on the real `server-only`
import instead. Verified:

```
pathname     : /Users/emilio/my%20projects/realtyworks/tests/unit/server-only-stub.ts
fileURLToPath: /Users/emilio/my projects/realtyworks/tests/unit/server-only-stub.ts
win pathname : /C:/dev/app/x.ts
```

Latent, environment-dependent, and it fails in the worst way — as a confusing
`server-only` import error rather than a path error — which is why it is worth
fixing while it costs one line.
**Do:** `import { fileURLToPath } from "node:url"` and wrap the URL:
`fileURLToPath(new URL("./tests/unit/server-only-stub.ts", import.meta.url))`.
**Done when:** `pnpm test` passes from a checkout whose absolute path contains a
space.

### ✅ The `e2e` job's silently-ignored `-x` names, corrected (2026-08-25)
Landed with issue #93, exactly as the entry said it should — the mailbox was the
conditional part, so the two decisions were made together.

**Was:** `studio,imgproxy,edge-runtime,functions,analytics,vector,inbucket`, of
which `functions`, `analytics` and `inbucket` are not valid `-x` values and were
silently ignored rather than rejected. Logflare (930MB) and mailpit (48MB) were
pulled on every run despite appearing excluded — nine containers, not seven.

**Now:** `studio,imgproxy,edge-runtime,logflare,vector`. `analytics` → the name
the validator actually accepts, `functions` dropped (it has no valid spelling),
and **mailpit deliberately kept** — signup sends real mail now and
`tests/e2e/auth.spec.ts` reads the confirmation link out of it, so the mail
container is a dependency of this job rather than dead weight. Eight containers:
postgres, gotrue, kong, postgrest, realtime, storage-api, postgres-meta,
mailpit.

The `db` job's list is untouched and must stay untouched: it drops Kong,
PostgREST and Realtime, which this job needs. The "ignored names" caveat is gone
from all four places that carried it — `docs/tooling.md`, `docs/playwright.md`,
the comment above the `e2e` job's `Start Supabase stack` step, and
`CLAUDE.md` §0 — along with the container counts stated alongside them.

### 🟡 Coverage visibility (not a gate)
**Why:** See what's tested without chasing a %.
**Do:** `pnpm add -D @vitest/coverage-v8`; `pnpm test -- --coverage`; report in CI, no threshold yet.
**Done when:** a coverage summary prints in CI logs.

### 🟡 ESLint import boundary for `src/server/queries/`
**Why:** `CLAUDE.md` §3: `src/server/` is the trust boundary. **Amended
2026-07-27 — the original wording of this item was wrong** and would now break
the app. It said "block `@/server/*` from client components"; but client
components are *supposed* to import server actions — `"use server"` swaps the
body for an RPC reference, so the implementation never ships — and the login and
signup forms do exactly that. Blocking all of `@/server/*` would fail lint on
working, correct code. The boundary that needs enforcing is
`src/server/queries/**` only.
**Do:** `no-restricted-imports` (or `eslint-plugin-boundaries`) blocking
`@/server/queries/*` from files carrying `"use client"`; leave
`@/server/actions/*` alone.
**Note:** mostly solved already — every module in `src/server/queries/` opens
with `import "server-only"`, which fails the **build** if client code pulls it
in. Lint would move that failure earlier and give it a better message, so this
is now DX polish, not a hole. (Vitest imports those modules via the
`server-only` alias in `vitest.config.ts` — don't let a lint rule catch the
test files.)
**Done when:** importing `@/server/queries/...` into a client component fails
lint, and the login form still builds.

### 🟡 CAPTCHA on signup
**Why:** With self-registration open, `[auth.rate_limit] sign_in_sign_ups` — 30
per 5 minutes per IP — is the *only* brake on automated account creation. That
is a speed bump, not a defense: every bot account becomes a row in `auth.users`
and `profiles` that a human eventually has to look at and decide about. Low
urgency while the app is unlisted; do it before or with the Phase 4 public
deploy. It is now the *last* of the two costs of opening signup — email
confirmations closed 2026-08-25 — and confirmations raise the cost of a bot
account without removing it: a throwaway-mailbox service defeats them, and the
row still lands in `auth.users` either way.
**Do:** Supabase Auth supports hCaptcha and Cloudflare Turnstile natively — the
`[auth.captcha]` block is already in `config.toml`, commented out. Enable it
with the secret read from an env var (`CLAUDE.md` §5, never a literal), render
the widget on the signup form, and pass the token through
`signUp({ options: { captchaToken } })`. Keep it off locally so the e2e suite
still runs unattended. Login probably does not need it — the rate limit plus
the deliberately opaque failure message already cover credential stuffing.
**Done when:** a signup submission without a valid captcha token is rejected in
a captcha-enabled environment, and `pnpm test:e2e` still passes locally.

### 🟡 Optional hygiene: `knip`
**Why:** Catches dead deps/exports early — cheap signal for a solo dev.
**Do:** `pnpm add -D knip`; add a `knip` script; run occasionally (not a CI gate yet).
**Done when:** `pnpm knip` reports a clean (or triaged) baseline.

---

## 🟢 Low — general-development runway (Phase 2+, phase-gated)

### ✅ Phase 3 — Tailwind + shadcn/ui installed (2026-07-27, issue #38)
Done. Tailwind CSS v4 + `prettier-plugin-tailwindcss` + shadcn/ui (zinc base,
new-york) scaffolded into `src/components/ui/` (button seeded); `components.json`,
`postcss.config.mjs`, and `src/lib/utils.ts` (`cn`) in place. The current `shadcn`
CLI replaced the classic base colors with named presets, so the toolkit was built
from the registry's zinc tokens directly — add further primitives with
`pnpm dlx shadcn@latest add <name>`.

### ✅ Phase 3 — The one vertical slice *(complete 2026-08-03)*
manager logs in → creates work order → assigns vendor → vendor updates status + uploads photo →
activity log reflects it → manager sees it. Exercised auth, RLS, mutations, storage, audit once.

Landed in three parts, each with its own ✅ entry above: the auth half
(2026-07-27), the staff write path (2026-08-02), and the vendor half
(2026-08-03). Every layer the slice was meant to prove has now been exercised
from the app rather than only from SQL — including Storage and the vendor
column-guard trigger, which were the last two.

One §3 folder is still unbuilt and that is correct: `supabase/functions/` waits
for Phase 5 SMS. `src/app/api/` is also still absent — the magic-link redemption
route landed at `src/app/auth/confirm/route.ts` instead, since it is an auth
endpoint rather than an API surface. The SSO callback will sit beside it.

### 🟢 Phase 3 — SSO (Google first, then Microsoft, then Apple)
**Why:** Password auth works, but staff sign-in is the friction that gets a tool
abandoned, and "sign in with Google" removes both the password and the reset
flow we would otherwise have to build. Prioritized Google → Microsoft (`azure`)
→ Apple by who our users actually have accounts with. Queued as the **next PR**
after the auth loop.
**Do:** `src/app/auth/callback/route.ts` calling `exchangeCodeForSession` (the
PKCE code arrives as a query param; the SSR client needs the route handler, not
a client-side hash parse); `[auth.external.google]` / `.azure` / `.apple` blocks
in `config.toml` with `client_id` and `secret` read from env vars via `env(...)`
— **never literals**, the file is committed; extend `additional_redirect_urls`
to cover the callback; and `skip_nonce_check = true` for the local Google
provider only. Roles are unaffected: an SSO signup is a self-registration like
any other, so it lands as an unlinked `vendor` (the fail-safe in
`03_signup_defaults.test.sql` covers it).
**Blocked on:** the maintainer registering an OAuth app with each provider — one
per provider, and none of it is code. Apple additionally needs a **paid
developer account** and its client secret **expires every 6 months**, so it is a
recurring operational chore; weigh that against how many users would actually
use it before doing Apple at all.
**Done when:** a Google account can sign in and reach `/dashboard`, with the
callback covered by an e2e spec or, if provider auth can't run in CI, a
documented manual check.

### 🟢 Phase 3 — First real unit tests *(auth half done — still open)*
Work-order state transitions + permission checks — the "test what matters" targets (`CLAUDE.md` §5).

**Done 2026-07-27:** the permission-check half. `src/server/queries/session.test.ts`
(fail-closed behaviour, including that a live session with no profile row returns
null rather than redirecting into a loop), `src/server/actions/auth.test.ts`
(invalid input never reaches Supabase; one message for wrong-password and
unknown-account alike; nothing role-shaped in the signup metadata), plus
`src/schemas/auth.test.ts` and a `LoginForm` RTL suite. 66 unit tests across 9
files; `tests/unit/harness.test.tsx` retired.

**Done 2026-08-02:** the staff-side state transitions.
`src/schemas/work-order.test.ts` (the DB CHECKs mirrored, plus the `guid`/`uuid`
regression) and `src/server/actions/work-orders.test.ts` (invalid input never
reaches Supabase; the insert carries only the granted columns; `assignVendor`
leaves a non-`open` status alone; a note never sets `action` or `actor_id`).
115 unit tests across 12 files.

**Done 2026-08-03:** the vendor-side transition and the privileged path.
`src/schemas/vendor.test.ts` (the contact-method rule mirrored, including the
whitespace cases `nullif(trim(...), '')` exists to catch),
`src/server/actions/vendors.test.ts` (a non-staff caller never reaches the admin
client; a NULL `is_staff()` is denied like a false one; a non-`vendor` role is
never linked; the returned link points at our own `/auth/confirm`), and
`src/lib/supabase/admin.test.ts` (missing key, publishable key in the secret's
place, and no environment read at import time). 150 unit tests across 15 files.
The `in_progress`/`completed` transition itself is covered where it is actually
enforced — pgTAP for the trigger, and `tests/e2e/vendor-loop.spec.ts` for the
form only offering those two.

### 🟢 Phase 4 — Observability & deploy (issue #36)
`@sentry/nextjs`, Vercel PR preview deploys, prod deploys only from `main`. Keep a working
Dockerfile so self-host stays `docker run` away (`CLAUDE.md` §5/§7).

**Auth tail inherited from issue #93** — the code is done, these are hosted-project
settings and nothing else:
- **Turn SMTP on for the hosted project through the dashboard.** Provider is **Resend**;
  `SUPABASE_AUTH_SMTP_PASS` is the API key and `SUPABASE_AUTH_SMTP_ADMIN_EMAIL` the
  sender (`.env.example`). The `[auth.email.smtp]` block ships **commented out** in
  `config.toml` — not `enabled = false` — and the difference is the whole point
  (changed 2026-08-25). Locally the two are identical: the CLI's schema default for
  that key is already `false`, and mail goes to mailpit either way. Remotely they are
  opposites. `supabase config push` sends the entire auth block as one Management API
  body, and the CLI maps a *present* smtp table with `enabled = false` to
  `smtp_host = ""` — which is how you **disable** custom SMTP, not how you leave it
  alone. So a present-and-false block makes any later routine push (a rate-limit tweak,
  a new template, a CLI bump) ship "wipe custom SMTP" in the same request as
  `mailer_autoconfirm = false`, dropping the hosted project to the built-in 2/hour
  mailer while confirmation mail is mandatory: signups succeed, no link arrives, and
  every new account is locked out with nothing in the logs. Commented out, the CLI
  emits no `smtp_*` field and a push cannot touch hosted SMTP. **If you would rather
  drive it from the file, uncomment with `enabled = true` on the deploy branch only and
  never merge that branch back.**
- **Verify the sender domain** with the provider first. An unverified domain drops
  every message silently, and the symptom is "confirmation emails never arrive",
  which reads like an application bug.
- **Point `site_url` and `additional_redirect_urls`** at the deployed origin. They
  are what `{{ .SiteURL }}` interpolates into the confirmation link, so a stale
  `127.0.0.1:3000` mails every new user a link to their own laptop.
- **Confirm the custom template applied remotely.** A hosted project that falls back
  to the default `{{ .ConfirmationURL }}` sends the implicit flow, which this app
  cannot consume — the link would appear to work and then land nowhere.
- **Set `email_sent` in the dashboard as well** (raised 2 → 30 here). Same mechanism as
  the SMTP bullet, quieter: the CLI only sends `rate_limit_email_sent` when the *local*
  config has SMTP enabled, so with the block commented out the `30` in `config.toml`
  never reaches the hosted project on its own. It only bites once custom SMTP is on,
  which is to say: on the hosted project, the first time it matters.

### 🟢 Phase 5 — PWA install layer (manifest + service worker)
Bolt-on to the already-responsive app — never a second codebase (`CLAUDE.md` §2). `src/app/manifest.ts`
(`MetadataRoute.Manifest`) + `public/sw.js` + icons; HTTPS required (`next dev --experimental-https`
locally). Platform constraints, per-OS install/push matrix, and the open decisions live in
`docs/pwa.md` — read it before building.
**Two decisions to settle first:** (1) do we need **web push** at all, given SMS already covers vendor
notification (§6) and iOS push only reaches users who *manually* installed the app? If yes, it's a §6
channel — logs to `messages`, respects `notification_preferences`, and needs a **push-subscriptions
table** (design it with the Phase 2 schema, not later). (2) **Offline** support means Serwist, which
per the Next.js guide needs **webpack** — but Next 16 defaults to **Turbopack**. Verify compatibility
before assuming offline is cheap; default is to skip offline writes entirely.
**Done when:** the app installs to an Android and an iOS home screen and launches standalone.

### 🟢 Phase 6 — Accounting & rent tracking (late stage, not a non-goal)
Promoted out of the MVP non-goals list (2026-07-09): rent roll, payments/expense ledger, cost
rollups. Gated behind Phase 5 breadth — don't start it early, and don't design it out either.
Money is the §2 trust rule at its strictest: amounts and balances computed server-side, ledger
append-only with reversing entries, never mutated history. Rent **collection** (payment rails,
PCI surface) is a separate go/no-go at the start of the phase.

---

## Suggested dependencies (quick reference)

| Package | Why | When |
|---|---|---|
| ~~`@commitlint/cli` + `@commitlint/config-conventional`~~ | ✅ Installed (PR #40) | Done |
| ~~`@testing-library/react` + `dom` + `jest-dom` + `user-event` + `happy-dom`~~ | ✅ Component test DOM harness (Vite 8 native `@/*` paths, no plugin) | Done |
| `@vitest/coverage-v8` | Coverage visibility | Medium |
| ~~`zod`~~ | ✅ Installed 2026-07-27 — shared client+server schemas per §3 (`src/schemas/auth.ts`) | Done |
| ~~`@t3-oss/env-nextjs`~~ | ❌ Declined — `env.ts` + `next.config.ts` already fail fast and reject a non-publishable key (see ✅) | Closed |
| `knip` | Dead deps/exports detector | Medium (optional) |
| ~~`@supabase/ssr` + `@supabase/supabase-js`~~ | ✅ Installed 2026-07-21 — server-side auth + DB client | Done |
| ~~`tailwindcss` + `prettier-plugin-tailwindcss` + shadcn/ui~~ | ✅ Installed 2026-07-27 — the decided UI stack | Done |
| ~~`server-only`~~ | ✅ Installed 2026-07-27 — build-time guard on `src/server/queries/` | Done |
| `@sentry/nextjs` | Error monitoring | Phase 4 |

*Not npm packages, but part of the plan:* `gitleaks`, `semgrep`, `osv-scanner` (CI actions).
The `supabase` CLI is ✅ installed as a pinned devDependency (2026-07-17).

---

## Recommended order for the next few sessions

*(Done so far: commitlint → gitleaks → `pnpm audit` gate + osv-scanner → Semgrep
→ audit gate flipped to blocking → Dependabot tuning + `@types/node` pin →
branch protection → pgTAP in CI → first migrations merged to `main` →
**Supabase clients: Phase 2 complete** → **Tailwind + shadcn/ui: Phase 3
started** → **auth loop + open signup: the read half of the slice** →
**service-role table grants narrowed** → **the staff write path** → **the vendor
half: Phase 3 complete**, merged to `main` 2026-08-04 as PR #94 → the
`/auth/confirm` open redirect → **email confirmations: the last gate cleared**,
2026-08-25.)*

**One gate is open again, and it is on the same endpoint.** The two that closed
both landed on `/auth/confirm` — the open redirect on 2026-08-12 and email
confirmations on 2026-08-25 — and PR review reopened a third there on
2026-08-28: emailed tokens are redeemed on `GET`, so a mail scanner spends them
before the recipient clicks (🟠 above). It is invisible locally, because mailpit
follows nothing, and live the moment real mail leaves Resend. **Phase 4 is still
the critical path**, and the deploy's *auth tail* now has one code change in it
rather than settings alone.

1. **Phase 4 itself** (🟢 above, issue #36) — Supabase Cloud project + pushed
   migrations, Vercel project + env vars, PR preview deploys, prod deploys only
   from `main`, Sentry, and a working Dockerfile so §7 stays mechanical. Read
   that entry's **auth tail** before starting: SMTP, the sender domain,
   `site_url`, and confirming the custom email template applied remotely are
   settings work that the #93 code deliberately left for the deploy, and they
   are exactly what you do not want to discover mid-deploy.
2. **Make the `db` job blocking** — the job has reported a run (PR #78), so it
   is now selectable in Settings → Branches. Two minutes of web UI, and it's
   what makes the pgTAP assertions actually gate a merge. While in there: the
   `e2e` job's display name is **"E2E (Playwright auth loop)"**, and branch
   protection matches required checks **by name** — so if it was ever selected as
   required, re-select it under the new name or it silently stops gating.
3. **CAPTCHA on signup** (🟡 above) — now the *only* remaining cost of opening
   signup, and the one that confirmations did not pay off: a throwaway-mailbox
   service defeats an email gate, and the row still lands in `auth.users`.
   Do it before or with the public deploy.
4. **SSO (Google)** (🟢 above) — blocked on registering the OAuth app, which is
   not code, so start that registration before you need it. It smooths the door;
   it does not block the deploy. Note that its callback will be the second route
   handler, and unlike `/auth/confirm` it *will* send the user out through
   Supabase and back — which is the case `playwright.config.ts`'s
   `127.0.0.1`-not-`localhost` rule was written for.

*No ride-alongs outstanding.* The sign-out scope fix (#92/#98) was the last one
and rode along with #93, exactly as its entry asked.

The security + CI + commit-hygiene foundation is green, the Phase 2 schema is on
`main`, and as of 2026-08-04 so is the whole Phase 3 vertical slice. What shifted
with the Phase 3 close: the open items stopped being "wire the plumbing" or
"write the mutations" and became **"make it real for someone other than you"** —
and both 🟠 gates plus CAPTCHA existed because signup is open to the public. They
were the price of that call, not surprises. Two of the three are now paid.
The 🟡 bucket is now mostly latent defects and DX debt; none of it should
displace Phase 4, and the four items added 2026-08-07 (#86/#89, #87, #84, #102)
are explicitly fill-in work around it.
