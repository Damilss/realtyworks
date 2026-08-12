# Vendor access — links, not accounts (magic-link auth over SMS)

How vendors/handymen get into RealtyWorks to do their part of a work order —
put in receipts, take photos, write descriptions, update status — **without a
signup flow**. Captured from a design discussion (2026-07-14) and reconciled
with `CLAUDE.md` §§2/5/6 and `docs/schema/schema-brainstorming.md`. This
resolves the first "open question" that doc left for Phase 2 — *vendors: contact
rows, auth users, or both?*

**The decision in one line:** vendors get a **real Supabase auth user**, created
silently when a manager adds them; the "unique link" the manager sends is a
**magic-link login** for that user, delivered over SMS. There is **no separate
no-account / bearer-token subsystem.**

From the vendor's side this is exactly the frictionless thing we want: a text,
a link, a tap, no password, no signup form, ever. From our side, nothing about
the architecture bends — `auth.uid()` exists, RLS works uniformly, and the
activity trail names a person, not "someone with a valid link."

**Update (2026-07-27): self-service signup is open, and this design is
unchanged.** A vendor *can* now create their own account at `/signup` — but an
account is not access. Signup produces a `vendor` profile with **no
`vendors.profile_id` link**, so `current_vendor_id()` is NULL and every
vendor-scoped policy arm returns nothing: no jobs, no properties, no
attachments. The row that grants access is still created by staff, and the link
below is still how the vendor reaches it. Read "no signup flow" throughout this
doc as *no signup flow the vendor is ever asked to complete* — which is the
claim that mattered. The one new wrinkle for the invite flow (§6): the auth user
may already exist when staff go to invite, so the invite has to link an existing
account as readily as it creates one.

---

## 1. Why links, not signups

Vendor adoption is the whole ballgame. A handyman who does four jobs a year for
you will not create an account, will not remember a password, will not install
anything. Every friction step between "got the text" and "uploaded the receipt"
is a step where we lose the data — and that data **is** the product.

`CLAUDE.md` §5 calls the audit trail a product feature, not a nice-to-have. An
audit trail that depends on a vendor completing a signup flow is an audit trail
with holes in it. Remove the signup; keep the record complete.

## 2. Why real auth users, not bearer tokens

The tempting build is a bearer token: a random string in the URL, a lookup
table, and vendor writes going through the Supabase **service-role** key because
there's no `auth.uid()` to hang RLS on. That's the tempting one and it's the
worse one. It costs three things:

- **Two security models instead of one.** Managers/landlords go through RLS;
  vendors go through hand-rolled token checks. Twice the surface, twice the
  drift.
- **It bypasses RLS for exactly the actor we trust least.** Service-role writes
  skip every policy. The vendor is the one outside actor in the system, and the
  bearer-token path is the one that turns RLS off for them.
- **A mushy audit trail.** "Someone with a valid link changed the status" is not
  "Bob changed the status." §5 wants the second sentence.

There's a fourth cost specific to this repo. `schema-brainstorming.md` §4
settles that "vendor may not reassign or approve cost" is enforced against the
caller's **app role** (`current_app_role() = 'vendor'`) in a `BEFORE UPDATE`
trigger / server action — because manager and vendor share the Postgres
`authenticated` role. **That machinery requires the vendor to be an
authenticated user.** A bearer-token vendor has no role to check, so we'd
re-implement those authorization rules a second time in application code —
guaranteed to drift from the first copy.

Make the vendor a real auth user and all of that disappears. "Account" becomes
an implementation detail, not a user-facing concept: the manager creates it by
adding the vendor; the vendor just gets a text. The UX is identical to the
no-account idea — we simply don't pay for it with a parallel security model.

## 3. What actually has to be decided

### 3a. What the link exposes — think hardest about this one

SMS is not a secure channel. Texts get forwarded, phones get shared, screenshots
happen. So the threat model is **the link holder**, not the link interceptor —
assume the link reaches someone it shouldn't and ask what they get.

- **Recoverable if leaked:** photos, descriptions, status, receipts. Annoying,
  cleanable, revocable.
- **Not recoverable:** gate codes, lockbox combos, tenant contact info / PII.
  Once texted around, that's out for good.

**MVP stance:** keep access instructions and tenant PII **out of the
link-reachable vendor view**, or gate them behind a one-time SMS code on first
open per device. This is the decision to labor over; the rest of the doc is
mechanics.

### 3b. Session scope — the vendor, deep-linked to the job

One login grants a vendor session scoped to that vendor: a "my jobs" list, with
the SMS **deep-linking the specific work order**. Per-work-order tokens sound
tighter but leave a vendor with four open jobs digging through message history
for the right link. Scope the session to the vendor; point the link at the job.

### 3c. Revocation from day one

Reassign the job, fire the vendor, kill the link — all have to work on day one.
That means access hangs off a **server-checked row with a `revoked_at`**, not a
stateless token we can't take back. A signed token that's valid until it expires
is not revocable; design for revocation, not just expiry.

## 4. Schema implications

This resolves `schema-brainstorming.md`'s open question decisively: the `vendors`
table is a **contact row**, and it gains a link to a **`profiles`/auth user**
once that vendor is invited. Contact-first, auth-on-invite.

Sketch — the `vendors` half shipped 2026-07-17 as
`supabase/migrations/20260717120400_create_vendors.sql` (contact-first,
auth-on-invite, exactly as below: phone-OR-email required, partial unique on
`profile_id`, no client grant on the auth link).

```
vendors
- id
- name, phone, email, ...        # contact details (§1 MVP scope)
- profile_id, optional           # → profiles/auth user, set on first invite
- created_by, created_at, ...

vendor_access                    # ← NOT BUILT. See §6; kept for the paper trail.
- id
- vendor_id
- work_order_id, optional        # deep-link target
- issued_by, issued_at
- expires_at
- last_used_at                   # audit trail (§5)
- revoked_at                     # server-checked; §3c
```

**`vendor_access` was rejected at Phase 3 and does not exist** (2026-08-03). It
was only ever needed on the "mint our own signed tokens" branch of §6, and that
branch lost: Supabase-native magic links keep the token in Supabase's own `auth`
schema, so there is nothing left for this table to hold. Revocation — the one
requirement §3c actually stated — lives in `vendors.profile_id`, which is a
server-checked row that takes effect on the next request. **RLS is unchanged
either way**: `auth.uid()` is present, policies stay uniform, and
`current_app_role()` returns `'vendor'` as §4 of the schema doc assumes.

**Receipts are attachments, full stop.** A vendor uploading a receipt is the
nose of the Phase 6 accounting camel. Store it as a `work_order_attachments`
row with a `receipt` kind and stop there. The moment there's a `line_items`
table you've started the ledger a phase and a half early (`CLAUDE.md` §1
deferred / §4 Phase 6).

## 5. Sequencing — this does not break phase order

The auth model is the thing; SMS is just the delivery channel. Split them:

- **Phase 3 (build the model) — shipped 2026-08-03.** The tokenized link +
  vendor session, delivered by a **"Create sign-in link"** button on the work
  order (the link then appears with a **Copy** control beside it; pressing the
  button again reads "New sign-in link" and mints a fresh one that supersedes
  the previous token). The whole flow — vendor opens link, gets a real session,
  updates status, uploads a photo/receipt, activity trail records it — runs with
  **no Twilio account, no 10DLC registration, and zero spend**, exactly as this
  section predicted. It is driven end to end by
  `tests/e2e/vendor-loop.spec.ts`, which redeems a real token in a second
  browser context.
- **Phase 5 (swap in SMS delivery).** SMS becomes the delivery channel — and the
  link send is a **§6 send like any other**: it logs to `messages`, respects
  `notification_preferences`, and consent/STOP/10DLC apply even to a login link
  (it's still A2P SMS). Do not build the SMS apparatus earlier than §6 allows.
- **RCS is not a design input.** We need SMS fallback regardless, so RCS is a
  later channel *upgrade* (branded sender, richer cards) that changes nothing
  structural. Bank it.

## 6. Settled at Phase 3 (2026-08-03)

All four were open questions until the invite shipped. Each was verified against
the running stack rather than against the docs, per `AGENTS.md` — the notes below
record what was actually observed.

- **Magic-link mechanism: (a), an email-type magic link.**
  `auth.admin.generateLink({ type: 'magiclink' })` mints the token; we take
  `properties.hashed_token` and build our own URL at **`/auth/confirm`**, which
  calls `verifyOtp({ token_hash, type })`.

  Deliberately **not** `properties.action_link`. That one points at GoTrue's
  `/auth/v1/verify`, which hands the session back in a URL *fragment* for a
  browser-side client to pick up — the implicit flow. This app keeps its session
  in cookies written server-side (`@supabase/ssr`), so the token has to be
  redeemed by our own route handler. `createClient()` from
  `src/lib/supabase/server.ts` needs no variant for this: its readonly-cookie
  guard only swallows the Server Component case, and in a route handler
  `cookieStore.set()` genuinely writes.

  Two behaviours worth recording because the design leans on them, both
  confirmed against the local stack:
  - **`generateLink` sends no email.** Mailpit stayed at zero messages across a
    full invite. That is what lets the CI `e2e` job keep excluding the mail
    container, and what makes "Copy link" cost nothing to run.
  - **The token is single use.** A replayed `token_hash` comes back
    `otp_expired`. Pinned by `tests/e2e/vendor-loop.spec.ts`.

  A third: `generateLink` will *implicitly create* an unknown user (because
  `[auth] enable_signup = true`), but with **no `app_role` and no name**. The
  invite therefore calls `auth.admin.createUser` explicitly first — that is what
  stamps `app_metadata.app_role` (the only source `handle_new_user()` reads for
  the role) and `user_metadata.full_name`, and it keeps the flow working if
  signup is ever closed again.

- **`vendor_access` does not exist**, and the sketch in §4 should be read as
  rejected. Revocation already lives in `vendors.profile_id`: unlink it, or
  delete the row, and `current_vendor_id()` resolves NULL on the very next
  request — mid-session, no waiting for an expiry. A separate table would add a
  second thing to keep in step with the first, and §3c only ever asked for
  *server-checked revocation*, which this is.

- **Vendor identity: a real email address is required to invite.** No synthetic
  or placeholder addresses — a fake address is an account nobody can recover and
  a notification channel that silently blackholes. A phone-only vendor row stays
  perfectly valid (`vendors_contact_method` wants either), it simply cannot be
  invited until SMS delivery lands in Phase 5; the UI says exactly that rather
  than hiding the button.

- **Link lifetime: unchanged, `[auth.email] otp_expiry = 3600`.** One hour,
  single use, no `config.toml` change. Re-issue is just pressing the button
  again — the link is shown once, stored nowhere, and never written to the
  activity trail or the logs, because it is a bearer credential for one login.

### 6a. The link's destination is guarded, not trusted (2026-08-12, issue #105)

The invite carries `next=/work-orders/<id>` so one tap lands on the job (§3b).
That parameter is part of the URL, which means it is part of what a **re-crafted
invite** can change — and §3a's threat model is exactly that the link reaches
someone it shouldn't. A forwarded invite with a hostile `next` signs its holder
in and then bounces them wherever the crafter chose, which is what makes a fake
"session expired, sign in again" page work.

`safeNext()` in `src/app/auth/confirm/route.ts` resolves `next` with
`new URL(next, origin)`, refuses anything whose origin is not ours, and returns
**only** `pathname + search + hash` — no host is ever emitted, so the guard
still holds if `nextUrl.origin` were influenced by a spoofed `Host` header.

It originally string-matched the prefix, and that was wrong in a way worth
keeping on record: `/\evil.example` starts with `/`, does not start with `//`,
and normalizes to `//evil.example` anyway, because `\` only becomes an authority
separator once the WHATWG parser reads it. Tabs and newlines are stripped by
that same parser, *after* any string check has already approved the value.
**Never string-match a URL something downstream will re-parse.**

Scope, precisely: this is a guard on the *destination*, not on the token. A
leaked link is still a login (§3c is what revokes it) — this only ensures that
redeeming one lands the holder inside our own app.

- **Sensitive-field gating (§3a): nothing to gate today.** The vendor view
  exposes title, description, status, priority, and the property/unit label.
  There is no gate-code column, no lockbox column, and no tenant PII anywhere in
  the schema — so there is currently nothing that §3a's "not recoverable if
  leaked" list applies to. This is a statement about the schema as it stands,
  **not** a decision that gating is unnecessary: the first column that holds an
  access instruction or a tenant's contact details re-opens this question, and
  device binding on first open is the option to weigh then.

---

**The main idea:** give vendors accounts they never know they have. The link is
real magic-link auth, not a bearer token — so there's one security model, RLS
covers the least-trusted actor, and the activity trail names a person. Build it
behind a "Copy link" button in Phase 3; deliver it over SMS in Phase 5.
