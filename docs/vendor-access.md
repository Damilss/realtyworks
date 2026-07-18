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
`profile_id`, no client grant on the auth link); `vendor_access` remains a
Phase 3 decision (§6):

```
vendors
- id
- name, phone, email, ...        # contact details (§1 MVP scope)
- profile_id, optional           # → profiles/auth user, set on first invite
- created_by, created_at, ...

vendor_access (only if we mint/track our own tokens — see §6 mechanism)
- id
- vendor_id
- work_order_id, optional        # deep-link target
- issued_by, issued_at
- expires_at
- last_used_at                   # audit trail (§5)
- revoked_at                     # server-checked; §3c
```

Whether `vendor_access` exists at all depends on the mechanism in §6: if we lean
on Supabase-native magic links, most of this is Supabase's `auth` schema and we
store little. If we mint our own signed tokens, this table is where revocation
and the audit trail live. **RLS is unchanged either way** — `auth.uid()` is
present, policies stay uniform, and `current_app_role()` returns `'vendor'` as
§4 of the schema doc assumes.

**Receipts are attachments, full stop.** A vendor uploading a receipt is the
nose of the Phase 6 accounting camel. Store it as a `work_order_attachments`
row with a `receipt` kind and stop there. The moment there's a `line_items`
table you've started the ledger a phase and a half early (`CLAUDE.md` §1
deferred / §4 Phase 6).

## 5. Sequencing — this does not break phase order

The auth model is the thing; SMS is just the delivery channel. Split them:

- **Phase 3 (build the model).** Build the tokenized link + vendor session now,
  delivered by a **"Copy vendor link"** button. The entire flow — vendor opens
  link, gets a real session, updates status, uploads a photo/receipt, activity
  trail records it — is testable with **no Twilio account, no 10DLC
  registration, and zero spend.** This is the Phase 3 vertical slice's vendor
  half (`CLAUDE.md` §4, backlog "Phase 3 — The one vertical slice").
- **Phase 5 (swap in SMS delivery).** SMS becomes the delivery channel — and the
  link send is a **§6 send like any other**: it logs to `messages`, respects
  `notification_preferences`, and consent/STOP/10DLC apply even to a login link
  (it's still A2P SMS). Do not build the SMS apparatus earlier than §6 allows.
- **RCS is not a design input.** We need SMS fallback regardless, so RCS is a
  later channel *upgrade* (branded sender, richer cards) that changes nothing
  structural. Bank it.

## 6. Open questions to settle at Phase 2/3

Per `AGENTS.md`, verify these against the Supabase auth docs at build time —
don't assume the training-data API.

- **Exact magic-link mechanism.** Supabase's built-in **phone** auth sends OTP
  **codes, not tappable links**. A tappable SMS link is therefore either (a) an
  **email-type magic link** (`auth.admin.generateLink`) delivered over our own
  SMS provider, or (b) a **self-minted signed token** that a server action
  exchanges for a session. Pick one at Phase 3; it decides whether
  `vendor_access` (§4) exists.
- **Vendor identity: phone-first or synthetic email?** If the mechanism needs an
  email, does each vendor get a placeholder/synthetic one, or do we key auth off
  phone? Settle at Phase 3 with the invite flow — the shipped `vendors` table
  deliberately supports either (phone OR email required, both individually
  nullable).
- **Link lifetime & re-issue.** Expiry window; one-time vs. reusable-until-
  revoked; the manager's "re-send link" flow.
- **Sensitive-field gating (§3a).** Final call on what the vendor view hides,
  and whether first-open device binding (a one-time SMS code) is MVP or later.

---

**The main idea:** give vendors accounts they never know they have. The link is
real magic-link auth, not a bearer token — so there's one security model, RLS
covers the least-trusted actor, and the activity trail names a person. Build it
behind a "Copy link" button in Phase 3; deliver it over SMS in Phase 5.
