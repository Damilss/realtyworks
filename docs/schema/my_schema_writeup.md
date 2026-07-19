# realtyworks workflow writeup (schema)

## Tenant (brainstorming, not concrete)
- Submits work requests
- Emergency contact -> contact landlord
- submits rent payment / proof of payment (Payment is not handled through app)
- Messenger for landlord

## Repair / handyman (brainstorming, not concrete)
- Unique links for work orders
- pictures of expenses / receipts
- Messenger for landlord? or keep without contact
- Work order / pending completed -> notification sent to landlord: tenant

## landlord (brainstorming, not concrete)
- Monitors stats and information
- receives messages, exports possible accounting data
- Landlord has 2 business days to respond to work orders

> Side note: Accounting work / rent tracking will be included in late MVP

# Schema workflows / planning (schema)

## Nouns
- landlord
- tenant
- properties 
- unit 
- work order
- message
- receipt
- rent / payments
- manager
- account / accounting_data
- money
- images / pictures
- status 
- activity log / audit log
- maps 
- user
- bookkeeper
- contact
- reports
- priority
- profile
- unique links (https://)
- notification
- stats
- notes
- vendor / handyman
- conversations


## Actions w/ Nouns
- create work orders
- landlord sends message
- tenant requests work order
- landlord creates work order
- landlord checks accounting data 
- vendor uploads photos for work order
- handler updates status of work order
- handler creates priorities for pending work orders
- vendor/handyman uploads photos of receipts
- tenant updates rent due
- activity log / audit log gets updates / new entry
- profile photo gets updated
- profile name / contact information gets updated
- report gets uploaded 
- handyman uploads photos of finished job
- status gets updated
- when work order gets created, unique link gets created to be forwarded to handyman ( see other documentation for further information on how we handle this problem )
- handyman/vendor uploads notes to work order
- landlord gets notified when statuses for work orders are uploaded
- Tenant requests work order with description and images.
- Landlord forwards SMS unique link to handyman

## What requires their own table?
| Noun | Table? | Why? |
| --- | --- | --- | 
| landlord | yes | contact info, permissions, etc | 
| Vendor | Yes | assignment status uploads |
| Unit | yes | Assigned work orders / relational | 
| Tenant | Maybe? | queried roles? / permissions | 
| property | no | can be a column? | 
| work order  | yes | statuses, permissions, queried often, etc | 
| message | no | can live in conversations | 
| Profile | yes | hold metadata for pfp, name, etc | 
| audit log | Yes | Need I say more | 
| Rent payments | Yes | tracking for years / months of payments | 
| Contact | No | can be column | 
| User | yes | Permissions and roles, manager, landlord, tenant | 
| Book keeper | Yes | Permissions etc, same as other roles | 
| reports | Yes | Text, images receipts | 
| receipt | no | column | 
| link | no | column for work order |


---

# Review & corrections (Claude, 2026-07-17)

Reviewed against `schema-brainstorming.md`, `vendor-access.md`, `backlog.md`,
and CLAUDE.md. The workflow-first method above is right, and most calls match
the settled design. The corrections below are data-model-level (they'd be wrong
in any phase); everything forward-looking is **not** a correction — it moves to
the "Future phases" section and stays part of the roadmap.

**Corrections**

| Writeup call | Correction |
| --- | --- |
| property → "no, can be a column?" | `properties` must be a table: units and work orders FK to it, staff scoping hangs off it, and Phase 6 cost attribution needs clean property keys. |
| landlord / user / bookkeeper / profile as separate tables | One identity model: a single `profiles` table (1:1 with `auth.users`, holds `role`). Landlord/manager/vendor are role *values*, not tables. `vendors` stays a separate **contact** table with an optional `profile_id` link (`vendor-access.md`). |
| receipt → "no, column" | Receipts are `work_order_attachments` rows with `kind = 'receipt'` — a work order can have many, and a line-items table would start the Phase 6 ledger early. |
| reports → "yes, table" | MVP reporting is queries/views over existing data. A vendor's "completion report" is activity notes + attachments. No stored reports table. |
| unique link → "column for work order" | The link is real magic-link auth scoped to the vendor's session (`vendor-access.md`) — not a stored bearer string on the work order. |

**Decisions settled today (2026-07-17)**

1. **No tenant tables at MVP** — staff create work orders; tenant ideas parked below.
2. **Landlord = manager superset**: everything a manager does + direct deletes
   for properties, units, and vendors + role management. Work-order deletion is
   landlord-only through the coordinated Phase 3 server action, never the Data
   API, because attachment objects must be removed through the Storage API first.
3. **All staff see all properties** (single-operation instance, no join table);
   vendors are scoped to assigned work orders.
4. **Work-order delete = coordinated cascade**: landlord-only mistake cleanup
   removes attachment objects first through the Storage API, then the server
   action deletes the order with the service role and cascades its activity and
   attachment metadata. Authenticated clients have no direct work-order DELETE
   grant, preventing Data API calls from orphaning storage objects. Activity is
   append-only against edits (UPDATE forbidden by trigger); the coordinated
   delete-by-cascade is the documented tradeoff.

# Future phases — designed for, not built

These writeup ideas are deliberate future-schema design, mapped to their phase.
Per CLAUDE.md §1: deferred means don't build it now — and don't design it out.
For each, the "door left open" is what the Phase 2 schema already does to keep
it cheap later.

| Idea (from above) | Phase | Door left open in Phase 2 |
| --- | --- | --- |
| Tenant actor: submits work requests, emergency contact | Post-MVP scope decision (tenant portal is a §1 non-goal today) | `app_role` enum is extensible (`ALTER TYPE … ADD VALUE 'tenant'`); units have clean UUID keys for a later tenants/occupancy join; the created_by + activity pattern extends to tenant-submitted requests unchanged. |
| Rent proof / rent payments tracking | Phase 6 | Clean property/unit/work-order UUID keys for ledger attribution; append-only discipline already established by `work_order_activity`; receipts captured from day one as attachments (`kind='receipt'`). |
| Bookkeeper, exports of accounting data | Phase 6 | One more `app_role` value + policies; cost summaries start from `work_orders.cost_cents`. |
| Messenger / conversations (landlord ↔ tenant/vendor) | Phase 5+ scope decision | The Phase 5 `messages` table (§6) is an SMS **send log**, not chat — nothing in Phase 2 assumes a chat shape. |
| Notifications on status changes | Phase 5 (§6, with `notification_preferences`) | `work_order_activity` is the event stream a notification trigger would hang off. |
| "Landlord has 2 business days to respond" | SLA/reporting rule, Phase 5 reporting at the earliest | `created_at` + status-change activity rows make response/aging times computable. |

# Continued planning — Phase 2 schema (Claude, 2026-07-17)

The design that ships in `supabase/migrations/` + `supabase/seed.sql`. Produced
by a two-designer (data model, security) + two-reviewer (adversarial attack,
house rules) pass; conflicts resolved as noted. Method per
`schema-brainstorming.md`; table list per its §7 (source of truth).

## Tables & enums

Seven tables: `profiles`, `properties`, `units`, `vendors`, `work_orders`,
`work_order_activity`, `work_order_attachments`.

Native Postgres enums (they flow into generated TS types as string-literal
unions): `app_role` (landlord|manager|vendor), `work_order_status`
(open|assigned|in_progress|completed|cancelled), `work_order_priority`
(low|medium|high|urgent), `attachment_kind` (photo|receipt|invoice|document),
`activity_action` (created|status_changed|vendor_assigned|note_added|attachment_added).
PG17 note: `ALTER TYPE … ADD VALUE` can't be *used* in the migration that adds
it — split into two files when the day comes.

Plain-English shapes:

- **profiles** — 1:1 with `auth.users` (PK = user id), holds `role`,
  `full_name`, `phone`. Created by an `auth.users` trigger; role read from
  `raw_app_meta_data.app_role` (server-set only), default `'vendor'`
  (fail-safe: a vendor with no `vendors` row can see nothing).
- **properties** — name + address, `created_by`. All staff see all.
- **units** — belongs to property, `label`, unique per property.
- **vendors** — contact row (name/phone/email, one contact method required)
  with optional unique `profile_id` → auth user, set by the Phase 3 invite
  server action (service role); no client grant on `profile_id`.
- **work_orders** — property (req), unit (opt), vendor (opt), title,
  description, status, priority, due_date, `cost_cents` (nullable bigint —
  the manually-entered job total for MVP cost summaries; deliberately not a
  ledger), created_by. Check: `assigned` ⇒ has vendor. Composite FK
  `(unit_id, property_id) → units(id, property_id)`: a non-null unit must
  belong to this work order's property (NULL unit passes).
- **work_order_activity** — append-only trail: identity PK (total order),
  `actor_id` (default `auth.uid()`), `action` enum, `old_value`/`new_value`
  jsonb, `note`. Auto-written by triggers on work_orders (created /
  status_changed / vendor_assigned, vendor names denormalized) and
  attachments (attachment_added); clients may insert **notes only**.
- **work_order_attachments** — metadata row per file; the file lives in the
  private `work-order-attachments` bucket at
  `<work_order_id>/<attachment_id>.<ext>`; a regex CHECK enforces that exact
  shape — work-order prefix AND the row's own id as the object name, single
  level — so metadata can never point at another row's object. Receipts =
  `kind='receipt'`.

FK rules: attribution FKs (`created_by`, `actor_id`, `uploaded_by`,
`vendors.profile_id`) RESTRICT — users with history can't be hard-deleted;
business FKs on work_orders RESTRICT — properties/units/vendors with work-order
history can't be deleted; work-order children (activity, attachments) CASCADE
(decision 4); `properties → units` CASCADE; `auth.users → profiles` CASCADE.

## Who can do what (RLS + enforcement)

| | landlord | manager | vendor (linked, assigned) |
| --- | --- | --- | --- |
| properties / units | full + **delete** | create/read/update | read address of assigned jobs' property/unit |
| vendors | full + **delete** | create/read/update contact fields | own row only |
| work_orders | create/read/update; **delete via server action** | create/read/update (no delete) | read assigned; update **status only** → in_progress/completed |
| activity | read all; add notes | read all; add notes | read assigned; add notes as self |
| attachments | read; upload objects; fix `kind`; metadata **insert + delete only via the Phase 3 server action** | read; upload objects; fix `kind` | read; upload objects on assigned |
| profiles | read all; change others' roles | read all | own row; staff **names only** via `staff_directory` view |

How each rule is enforced (brainstorming §4 — RLS picks rows, not columns):

- **Row access** → RLS policies per table; helpers `current_app_role()`,
  `is_staff()`, `is_landlord()`, `current_vendor_id()`,
  `can_access_work_order()` — SECURITY DEFINER, `search_path = ''`, STABLE,
  called as `(select …)` for per-statement caching; EXECUTE revoked from
  `public`/`anon`. Never FORCE RLS on these tables (the definer helpers rely
  on owner bypass).
- **Uniform column rules** (true for every logged-in user) → column grants:
  nobody writes `id`, `created_by`, timestamps, `actor_id`, `activity.action`,
  `vendors.profile_id`, `profiles.role` through the API — the columns are
  simply absent from every INSERT/UPDATE grant. `work_orders` INSERT also
  excludes `status`/`vendor_id`: every order starts `open`, assignment is an
  audited UPDATE.
- **Role-dependent column rules** (grants can't split manager from vendor —
  both are `authenticated`) → BEFORE UPDATE triggers: the work_orders guard is
  a fail-closed jsonb diff (vendors may change *only* `status`, and only to
  in_progress/completed — columns added later are protected automatically);
  the profiles guard makes `id` immutable and role changes landlord-only with
  a last-landlord check. Role changes go through `set_user_role()` (definer
  RPC: landlord-only, never self).
- **Storage** → object policies re-derive access from the path
  (uuid-shaped single folder = the work order id + `can_access_work_order()`);
  metadata and storage are independently enforced — neither trusts the other.
  No object overwrites (no UPDATE policy) and **no client deletes on either
  layer**: Postgres can't remove a storage object transactionally
  (`storage.protect_delete()` forbids SQL deletes — Storage API only), so a
  one-sided delete would leave an unlisted-but-fetchable file or metadata
  pointing at a 404. Both deletes belong to the Phase 3 server action
  (object via storage API first, then the row via service role).
- **Signup** → `enable_signup = false` in config.toml (invite-only; magic-link
  *login* unaffected). Belt: even if re-enabled, a stranger lands as an
  unlinked vendor and can see nothing.
- `auto_expose_new_tables` is off → every table/function carries explicit
  grants (`anon`: none anywhere; `service_role`: explicit `grant all`).

## Migration map (9 files, RLS + grants ship with each table)

1. `create_enums_and_helpers` — 5 enums, `set_updated_at()`
2. `create_profiles` — table, role helpers, `set_user_role()`, profile guard,
   `handle_new_user()` + auth trigger, RLS, grants
3. `create_properties` · 4. `create_units` — tables, staff RLS, grants
5. `create_vendors` — table, partial unique on `profile_id`,
   `current_vendor_id()`, RLS, grants, + the `staff_directory` view
   (names-only staff resolution for linked vendors — a profiles policy arm
   would expose whole rows, and RLS can't pick columns)
6. `create_work_orders` — table, checks, indexes, `can_access_work_order()`,
   vendor guard, RLS, grants, + assigned-vendor SELECT arms on
   properties/units (extension, not retrofit — both tables were deny-by-default
   from their own files)
7. `create_work_order_activity` — table, append-only stack, work_orders log
   trigger (lives here: it writes this table)
8. `create_work_order_attachments` — table, path CHECK, attachment log trigger
9. `create_storage_bucket` — private bucket + object policies

After every migration change: `pnpm exec supabase gen types typescript --local
> src/lib/database.types.ts` (generated — never hand-edit).

## Seed (`supabase db reset` → known-good state)

3 auth users (landlord/manager/vendor, `@realtyworks.test`, `password123`,
deterministic UUIDs) inserted directly into `auth.users`/`auth.identities`
(bcrypt via `extensions.crypt`; token columns seeded `''` — GoTrue NULL-scan
gotcha); profiles materialize via the auth trigger. 2 properties, 3 units, 1
vendor row linked to the vendor user. 5 work orders covering **every status**
(one with `unit_id NULL`), inserted `open` then UPDATEd into their states so
the activity triggers write a realistic history; a completed order carries
`cost_cents`. Plus two manual notes (one vendor-authored) and one receipt
attachment metadata row. pgTAP tests in `supabase/tests/` (run:
`pnpm exec supabase test db`) assert role visibility, the vendor column guard,
append-only activity, self-escalation blocks, and anon isolation.

## Handed to Phase 3 (decided then, not now)

- Status *transition* rules beyond the vendor floor (the first real unit-test
  target) — server actions own them.
- The vendor invite flow: create auth user silently, set
  `vendors.profile_id` via service role, magic-link mechanism + link lifetime
  (`vendor-access.md` §6), "Copy vendor link" button.
- Upload flow ordering (generate id → upload → insert metadata) and the
  work-order-delete server action (remove objects, then delete row).
- Whether vendors need a narrowed work-order view (they can currently read
  `description` and `cost_cents` on assigned jobs — so keep gate codes and
  tenant PII out of `description`; `vendor-access.md` §3a).
