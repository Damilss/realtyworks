# Schema brainstorming — workflows → tables → security → Zod

The repeatable process for designing schema in this repo: how to get from a
user workflow to Postgres tables (as Supabase migrations), RLS answers, and
Zod input schemas. Captured from a design discussion (2026-07-13) and
reconciled with `CLAUDE.md` §§1–6 so it can be applied directly — first at
the start of Phase 2, then again for every feature after.

**The method in one line: brainstorm from workflows first, not tables first.**

Think in two layers, brainstormed from the *same* workflows but never
identical by default:

| Layer | Models | Lives at |
| --- | --- | --- |
| Database schema | **Stored truth** — what actually exists in Postgres/Supabase | `supabase/migrations/` (numbered SQL), surfaced to TS via the generated `src/lib/database.types.ts` |
| Zod schemas | **Acceptable input** — what user input must look like before the app accepts it | `src/schemas/` — imported by client *and* server (§3) |

House rules from `CLAUDE.md` that constrain every step below:

- Migrations are the source of truth — all schema/RLS changes via numbered
  files, no dashboard click-ops (§5).
- RLS ships in the **same migration** as its table; retrofitting is not
  allowed (§5). Step 4's security answers are written *with* the table.
- Validate twice, trust once: Zod on the client for UX, again on the server
  for trust; the server is authoritative (§5). Never trust a client-supplied
  role, price, permission, or ownership check (§2).
- Regenerate `database.types.ts` after every migration; never hand-edit (§3).

---

## 1. Write the core user story

Start from the workflow, not the data. For the MVP that is the Phase 3
vertical slice, verbatim:

> A manager logs in, creates a work order for a property/unit, assigns a
> vendor, the vendor updates the status and uploads a photo, and the
> activity log records everything.

Extract the important **nouns** and **actions**.

Nouns:

```
user
property
unit
work order
vendor
attachment
activity log entry
```

Actions:

```
create work order
assign vendor
update status
upload photo
add note
close work order
```

Nouns usually become **tables**. Actions usually become **server actions**
(`src/server/actions/`, behind the §3 trust boundary), each validated by a
**Zod schema** in `src/schemas/` — with route handlers reserved for the
webhook-shaped cases (§6).

## 2. Turn nouns into candidate tables

First pass for the slice:

```
profiles
properties
units
vendors
work_orders
work_order_attachments
work_order_activity
```

Then filter every concept through one question: **"Does this thing need to
be stored, queried, related, or permissioned?"**

| Concept | Table? | Why |
| --- | --- | --- |
| Property | Yes | Work orders belong to properties |
| Unit | Yes | Some work orders belong to specific units |
| Work order | Yes | Core business object |
| Vendor | Yes | Needs assignment + contact details (§1 MVP scope) |
| Status | No — column | `status` on `work_orders`, constrained (step 3) |
| Priority | No — column | `priority` on `work_orders`, constrained |
| Photo | Yes-ish | Metadata row in the DB; the file itself in Supabase Storage |
| Activity trail | Yes | Audit trail is a product feature, not a nice-to-have (§5) |

## 3. Sketch each table in plain English first

Do not start with perfect SQL. Start like this:

```
work_orders
- id
- property_id
- unit_id, optional
- vendor_id, optional
- title
- description
- status
- priority
- due_date
- created_by
- created_at
- updated_at
```

Then the relationships, in prose:

```
A property has many units.
A property has many work orders.
A unit has many work orders.
A work order may have one assigned vendor.
A work order has many attachments.
A work order has many activity log entries.
```

That gives the shape before worrying about exact SQL. Only once the shape is
agreed does it become a numbered migration — with restricted values enforced
as Postgres enums/check constraints, not app-side conventions. Working
sketch for the enums:

```
status:   open | assigned | in_progress | completed | cancelled
priority: low | medium | high | urgent
```

The status *transitions* (who may move a work order between which states)
are business logic — the first real unit-test target in Phase 3
(`docs/backlog.md`).

## 4. Ask the security questions early — they are the RLS policy

For every table, before writing it:

```
Who can read this?
Who can create it?
Who can update it?
Who can delete it?
Should vendors see all fields, or only assigned work orders?
```

Answer for all **three seed roles** — landlord, manager, vendor (the Phase 2
seed users). Example for `work_orders`:

```
- Manager can read work orders for their properties.
- Manager can create work orders.
- Manager can assign vendors.
- Vendor can read only work orders assigned to them.
- Vendor can update status/notes/photos — but not cost approval,
  assignment, or ownership fields.
```

These answers do not turn into RLS policies "later" — in this repo they are
written as RLS **in the same migration as the table** (§5). The client may
mirror them for UX; the database enforces them (§2).

### RLS picks rows, not columns — the last answer needs more than a policy

Read that last line again: *vendor can update status/notes/photos, but not cost
approval, assignment, or ownership.* **RLS alone cannot enforce that**, and
assuming it does is the easiest authorization bypass to ship in Phase 2.

An `UPDATE` policy decides *which rows* a caller may touch. Its `USING` clause
sees the existing row and `WITH CHECK` sees the proposed row, but a policy
**cannot compare the two** — there is no `OLD` to reference. So "`assigned_vendor_id`
must not change" is not expressible in RLS. A vendor who passes the row check to
update `status` can, in the same `PATCH`, rewrite every other updatable column on
that row — including who it's assigned to and what it costs. The Supabase client
talks to PostgREST directly; nothing stops the request from carrying extra columns.

Two mechanisms actually enforce column rules, and you need to know which one a
given rule requires:

**1. Column-level privileges — for rules true of _every_ logged-in user.**

```sql
revoke update on work_orders from authenticated;
grant  update (status, notes) on work_orders to authenticated;
```

Use this for columns no client may *ever* write: `id`, `created_by`,
`created_at`, ownership/tenancy keys. The trap: in Supabase **every logged-in
user shares the same Postgres `authenticated` role**. Column grants cannot tell
a manager from a vendor, so they cannot express "managers may reassign, vendors
may not." Reaching for grants alone to solve a role-dependent rule silently
gives *everyone* the loosest column set.

**2. A `BEFORE UPDATE` trigger, or a server action — for role-dependent rules.**

Because manager and vendor are the same DB role, "vendor may not reassign" has
to be checked against the caller's app role at write time:

```sql
create function guard_work_order_update() returns trigger as $$
begin
  if current_app_role() = 'vendor'
     and (new.assigned_vendor_id is distinct from old.assigned_vendor_id
          or new.cost_approved   is distinct from old.cost_approved) then
    raise exception 'vendors may not change assignment or cost approval';
  end if;
  return new;
end;
$$ language plpgsql security definer;
```

(Sketch, not final — `current_app_role()` is whatever role lookup Phase 2
settles on, and the column list follows the table.)

**The default for this repo:** privileged mutations go through a **server
action** (§2's trust boundary), which writes an explicit column allowlist, with
a trigger as the backstop for anything reachable by a direct client write. The
guarantee to aim for is that *no raw client `.update()` on `work_orders` can
change assignment, cost, or ownership* — enforced in the database, not by the
shape of the request the UI happens to send.

Carry this into §6's per-table checklist: for every table, "who can update it"
has a second half — **which columns, and enforced how.**

## 5. Brainstorm Zod schemas around actions, not tables

The part that is easy to miss: the DB table and the Zod schema are related,
but **not always the same shape**. The row models everything stored; the Zod
schema models only what the user is allowed to provide for one action.

The stored row (as the generated types will express it):

```ts
work_orders: {
  id: string;
  property_id: string;
  unit_id: string | null;
  vendor_id: string | null;
  title: string;
  description: string | null;
  status: "open" | "assigned" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
```

The input schema for *creating* one:

```ts
const createWorkOrderSchema = z.object({
  propertyId: z.string().uuid(),
  unitId: z.string().uuid().optional(),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  dueDate: z.string().optional(),
});
```

Notice what is **not** there:

```
id
created_by
created_at
updated_at
status
```

Those are set by the server/database, never trusted from the client — the §2
trust rule in schema form. One Zod schema per action from step 1, named for
the action (`createWorkOrderSchema`, `assignVendorSchema`, …), living in
`src/schemas/` so both sides import it, with the server action re-validating
before touching the DB.

## 6. The per-table checklist

Answer these for every candidate table before its migration is written:

```
What is this thing?
Who owns it?
What other table does it belong to?
What fields are required?
What fields are optional?
What values should be restricted?
Who can see it?
Who can modify it?
Which columns may each role modify — and enforced how?
What needs to be audited?
What should never come from the client?
```

Worked example — `work_orders`:

```
What is this thing?
A maintenance/repair request.

Who owns it?
The property manager or organization.

Belongs to?
A property, optionally a unit, optionally a vendor.

Required fields?
property_id, title, status, priority, created_by.

Restricted values?
status and priority should be enums/check constraints.

Who can see it?
Managers for that property; assigned vendor.

Who can modify it?
Managers for their properties; the assigned vendor, narrowly.

Which columns may each role modify — and enforced how?
Manager: status, priority, due date, assignment, cost fields.
Vendor:  status, notes, photos — and nothing else.
Enforced by a server action with an explicit column allowlist, plus a
BEFORE UPDATE trigger as the backstop. NOT by RLS alone: a policy picks
rows, not columns, and column GRANTs can't split manager from vendor
because both are the `authenticated` role (§4).

What needs to be audited?
Creation, assignment, status changes, note additions, uploads.

What should never come from the client?
created_by, ownership, server timestamps, permission decisions.
```

## 7. Brainstorm in phase order

Do not design the whole product at once. The order follows `CLAUDE.md` §4.

**Phase 2/3 — the MVP vertical slice, nothing else:**

```
1. profiles
2. properties
3. units
4. vendors
5. work_orders
6. work_order_activity
7. work_order_attachments
```

**Phase 5 — with SMS/notifications and the minimal reports (§6 — not
earlier):**

```
8. notification_preferences    — required before real users exist (§6)
9. messages                    — logs every send, from message #1 (§6)
10. reporting views / query helpers — for the §1 minimal reports only
```

**Phase 6 — accounting & rent tracking (deferred ≠ never, §1/§4):** rent
roll, payments/expense ledger, cost rollups. The rule cuts both ways: don't
build any of it now (no speculative tables or columns), and don't design it
*out* — clean keys on properties/units/work-orders are what make ledger
attribution possible later. When it comes: append-only ledger,
server-computed amounts, reversing entries only (§4).

**Non-goals — don't brainstorm tables for these at all (§1):** tenant
portal/messaging, leasing pipeline, deep integrations, dashboards beyond the
minimal reporting.

> Correction vs. the original discussion: it lumped "invoices, accounting,
> tenant messaging, leasing, complex reporting" together as things to avoid
> in Phase 2/3. Per current plans they split: accounting/rent tracking is
> **deferred to Phase 6** (promoted from non-goal, 2026-07-09); tenant
> messaging, leasing, and extra reporting are **non-goals**. Invoice *files*
> attached to work orders are MVP scope (attachments); invoice/ledger
> *records* are Phase 6.

## 8. The template — copy this per feature

```
Feature: <name>

Main objects:
- ...

Main actions:
- ...

Tables needed:
- ...

Zod schemas needed:
- ...

Security:
- ...
```

Filled in for the Phase 3 slice:

```
Feature: Work Orders

Main objects:
- Work order
- Property
- Unit
- Vendor
- Attachment
- Activity entry

Main actions:
- Manager creates work order
- Manager assigns vendor
- Vendor updates status
- Vendor uploads photo
- Manager reviews history

Tables needed:
- work_orders
- work_order_activity
- work_order_attachments

Zod schemas needed:
- createWorkOrderSchema
- assignVendorSchema
- updateWorkOrderStatusSchema
- addWorkOrderNoteSchema
- uploadWorkOrderAttachmentSchema

Security:
- Managers can manage work orders for their properties.
- Vendors can only see assigned work orders.
- Vendors cannot edit ownership, assignment, or manager-only fields.
- All important changes create activity log entries.
```

## Open questions to settle when Phase 2 starts

- **Vendors: contact rows, auth users, or both?** The brainstorm lists both
  `profiles` and `vendors`; §1 MVP scope says "vendor contacts", but the
  Phase 3 slice has a vendor *logging in*. Likely a `vendors` contact table
  with an optional link to a `profiles` row once that vendor gets a login —
  decide in the first migrations.
- **Landlord vs. manager permissions.** The original discussion only specced
  manager and vendor; the seed has three roles. Same rights at MVP, or a
  read-only landlord? Decide before writing RLS for `properties` /
  `work_orders`.

---

**The main idea: database schemas model stored truth; Zod schemas model
acceptable input.** Brainstorm both from the same workflows, but do not make
them identical by default.
