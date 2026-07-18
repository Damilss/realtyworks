# Report: Phase 2 schema review exposed nine cross-layer and contract defects

| | |
| --- | --- |
| **Date** | 2026-07-17 |
| **Area** | database / RLS / Supabase Storage / testing |
| **Cost** | ~7h elapsed from the first schema commit through the round-4 pass; 4 review rounds, 9 findings, and 1 formatting detour |
| **Status** | Resolved for Phase 2. Attachment and work-order deletion are intentionally blocked until Phase 3 supplies the coordinated server action. |
| **Commits / PRs** | `718f2d6`, `9d7ea45`, `c74a3c6`, `6cdb9e7`, `c835fd8`, `d0e4450`, `8660391`, `3771a49` · round 4 (this pass) staged for review, not yet committed |
| **Issues** | #72 (run pgTAP in CI) |
| **Tags** | supabase, postgres, rls, foreign-key, concurrency, advisory-lock, storage, coordinated-delete, pgtap, three-valued-logic, fail-closed, type-contract, authorization |
| **See also** | [`../schema/my_schema_writeup.md`](../schema/my_schema_writeup.md) · [`../backlog.md`](../backlog.md) |

## TL;DR

The first Phase 2 schema was broad but several rules stopped one layer too
early: a foreign key proved that a unit existed but not that it belonged to the
selected property; RLS chose profile rows but could not hide their private
columns; and SQL deletes could remove metadata without deleting Storage
objects. Three review rounds moved those invariants into composite constraints,
restricted views, serialized guards, and a service-only coordinated-delete
boundary. A fourth round then closed three contract defects that three-valued
logic and a stray column default had hidden: a role-change RPC that failed
*open* for a caller with no profiles row, an attachment id whose DB default made
it optional in the generated type (orphaning uploads when omitted), and a
vendor-contact check that accepted empty strings. The pgTAP suite grew from 38
to 48 tests.

## What I was doing

Phase 2 introduced the local Supabase stack: nine migrations for seven tables,
RLS and grants, seed data, a private attachment bucket, generated TypeScript
types, and pgTAP coverage. The initial design made landlords a manager
superset, scoped vendors to assigned work orders, kept the activity trail
append-only, and made signup invite-only.

## The roadbump

The review found nine ways valid-looking local rules could still violate the
business or security invariant:

| Round | Finding | Resolution |
| --- | --- | --- |
| 1 | `unit_id` and `property_id` were independently valid but could describe different properties. | Added `units (id, property_id)` as a superkey and a composite work-order FK. |
| 1 | A vendor needing actor names could read every column on every staff profile, including phone numbers and timestamps. | Replaced the profiles RLS arm with `staff_directory`, exposing only `id` and `full_name`. |
| 1 | The attachment CHECK enforced only a work-order prefix, so nested paths or another attachment's object name still passed. | Enforced the exact `<work_order_id>/<attachment_id>.<ext>` shape. |
| 2 | Concurrent demotions of different landlords could each see the other landlord and both commit, leaving none. | Serialized the demotion path with a transaction-scoped advisory lock before rechecking. |
| 2 | Deleting attachment metadata did not remove or revoke the corresponding Storage object. | Removed client delete access from both metadata and Storage; Phase 3 must delete the object first and metadata second. |
| 3 | Direct work-order deletion cascaded metadata but still left physical attachment objects orphaned. | Removed the authenticated work-order DELETE policy and grant; deletion is service-role-only through the future coordinated flow. |
| 4 | `set_user_role()` (SECURITY DEFINER) guarded with `if not is_landlord()`; for a caller with no profiles row `is_landlord()` is NULL, `not NULL` is NULL, and PL/pgSQL skips a NULL `IF` — the RPC failed *open* and let them change another user's role. | Test `is_landlord() is not true` so NULL and false both fail closed; applied the same fix to the sibling `guard_profile_update()` backstop. |
| 4 | Attachment `id` carried `default gen_random_uuid()`, so the generated Insert type marked it optional. A client omitting it gets a random id that cannot match the UUID already baked into the required `storage_path`, so the metadata insert fails the path CHECK *after* the object is uploaded — orphaning it. | Dropped the default; a primary key with no default is required in the generated type, surfacing the client-supplied-id contract at compile time. |
| 4 | The vendor `phone is not null or email is not null` check accepted `''`, so an empty-string form post created a vendor with no reachable contact, violating the documented phone-OR-email invariant. | `nullif(trim(...), '') is not null` on each side collapses blank and whitespace-only to NULL and requires at least one usable value. |

The third finding on deletion corrected an incomplete conclusion from round two:
making an object unfetchable after its work order disappears is not the same as
actually cleaning it up.

Round four shifted theme. These three were not cross-layer invariants but
totality defects — SQL's three-valued logic (`not NULL` is not `true`), a column
default leaking into the generated Insert type, and the empty string standing in
for a real value. A guard can read as exhaustive and still be partial.

## What I tried (and why it didn't work)

1. **Independent foreign keys** — they proved that both rows existed, not that
   the chosen unit belonged to the chosen property.
2. **A profiles SELECT policy for vendors** — RLS filters rows, not columns, so
   every column on each allowed staff row remained visible.
3. **A path-prefix CHECK** — it bound metadata to a work-order directory but
   not to its own attachment ID or a single-level object path.
4. **A last-landlord `exists` check by itself** — two READ COMMITTED
   transactions could both pass before either demotion committed.
5. **Ordinary client DELETE policies and cascades** — Postgres can cascade the
   metadata rows, but Supabase Storage objects are deleted through the Storage
   API and cannot join that database transaction.
6. **`if not public.is_landlord()`** — reads as "deny non-landlords," but
   `is_landlord()` is NULL for a caller with no profiles row, `not NULL` is NULL,
   and PL/pgSQL treats a NULL `IF` as false: the guard was skipped and the RPC
   failed open. `is not true` is the fail-closed form.
7. **`id uuid ... default gen_random_uuid()` on attachments** — convenient, but
   the default made `id` optional in the generated Insert type, and a
   server-filled id can never match the UUID already in `storage_path`, so the
   insert fails the path CHECK after the upload and orphans the object.
8. **`phone is not null or email is not null`** — total-looking, but `''` is not
   NULL, so an empty-string form post satisfied it with no usable contact.

## Root cause

The design checked each table or policy in isolation. The missing guarantees
crossed boundaries: two related columns, a row policy versus its projected
columns, two concurrent transactions, or Postgres metadata versus a Storage
object. RLS remained necessary, but it could not replace relational
constraints, least-privilege projections, serialization, or an application
workflow spanning separate systems.

Round four's root cause was narrower — totality. A predicate that looks
exhaustive is not, once NULL (three-valued logic), a column default, or the
empty string is in play. The safe defaults are to fail closed and to make the
required shape unrepresentable when absent, not merely discouraged.

## The fix

The constraints and access surfaces were tightened in the migrations, and each
review round added regression coverage. The recorded progression was:

```text
initial schema       38 pgTAP tests
first review fixes   41 pgTAP tests
rounds two & three   44 pgTAP tests after a local reset
round four           48 pgTAP tests
```

Supporting cleanup from the same commit trail:

- Supabase CLI scratch files under `supabase/.temp/` were added to
  `.prettierignore` after a local stack run made `format:check` fail.
- Schema, planning, and agent guidance were synchronized; a stale reference to
  a nonexistent Storage cleanup trigger was removed.
- Issue #72 records the remaining test-infrastructure gap: pgTAP is still local
  only and needs a blocking GitHub Actions job.
- No remote Supabase project was linked. If these edited migrations were
  applied independently elsewhere, that environment needs equivalent forward
  migrations to drop the old DELETE policies and grants.

## Lesson / next time

> **Rule:** Review an authorization invariant across its full lifecycle and all
> participating systems. A row being hidden, deleted, or independently valid
> does not prove its columns are least-privilege, its relationships agree, its
> concurrent updates are safe, or its external objects were cleaned up.

> **Rule (round 4):** An authorization or integrity predicate must fail closed
> under NULL and the empty string, and a required value must be *unrepresentable*
> as absent — no column default standing in for a client-supplied one. `not
> is_landlord()` is not `is_landlord() is not true`; `phone is not null` is not
> "phone is usable"; an `id` with a default is optional in the type it generates.

For Storage-backed records, define the deletion owner and order before granting
any DELETE surface. Until the coordinated server action exists, denying the
operation is safer than exposing a partial workflow.

## References

- `9d7ea45` — initial Phase 2 schema, seed, generated types, and 38 pgTAP tests
- `c74a3c6` — composite FK, names-only staff directory, exact attachment path,
  and documentation sync (41 tests)
- `c835fd8` — serialized landlord demotions and removal of one-sided attachment
  deletes (44 tests)
- `3771a49` — service-only coordinated work-order deletion and documentation
  correction (44 tests passing)
- `6cdb9e7`, `d0e4450`, `8660391` — local formatting, pgTAP CI backlog, and
  review/commit workflow follow-ups
- round 4 (staged, uncommitted) — fail-closed `set_user_role()` and
  `guard_profile_update()`, required attachment `id` (default dropped, types
  regenerated), non-blank vendor contact check, and +4 pgTAP tests (44 → 48)
