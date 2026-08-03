import { z } from "zod";

import { Constants } from "@/lib/database.types";

/**
 * Validation for the work-order write forms, imported by both the client forms
 * and the server actions (CLAUDE.md §5 — validate twice, trust once). None of
 * this is the boundary: RLS picks the rows, the column grants decide which
 * fields are even writable, and `guard_work_order_update()` decides what a
 * vendor may change. These schemas exist so the user is told what is wrong
 * before a round trip, and so an action never sends obvious garbage to Postgres.
 *
 * Every bound below mirrors a CHECK constraint in
 * `supabase/migrations/20260717120500_create_work_orders.sql` /
 * `..._create_work_order_activity.sql`. The enums come from `Constants` in the
 * generated types rather than being retyped here — the generated DB types are
 * the contract (CLAUDE.md §5), so a new status can't silently pass validation.
 */

/** `char_length(title) between 1 and 120` on `work_orders`. */
const TITLE_MAX_LENGTH = 120;

/** `char_length(description) <= 2000` on `work_orders`. */
const DESCRIPTION_MAX_LENGTH = 2000;

/** `char_length(note) <= 2000` on `work_order_activity`. */
const NOTE_MAX_LENGTH = 2000;

/**
 * A `<select>` with no choice made and an empty `<input type="date">` both post
 * `""`, which is not the same thing as "unset" to Postgres — an empty string
 * fails a uuid cast and a NOT NULL-free column wants NULL. Collapse it here so
 * every action sends the same shape.
 */
const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

/**
 * `z.guid()`, deliberately NOT `z.uuid()`.
 *
 * Zod v4's `uuid()` enforces RFC 9562 — the version nibble must be 1–8 and the
 * variant bits must be 8/9/a/b. Postgres's `uuid` type enforces neither: it
 * stores any 128-bit value, and `gen_random_uuid()` merely happens to emit v4.
 * Validating with `uuid()` therefore rejects ids the database considers
 * perfectly valid — every fixture in `supabase/seed.sql` among them
 * (`10000000-0000-0000-0000-000000000001` has version and variant nibbles of
 * 0). `guid()` checks the 8-4-4-4-12 hex shape and nothing more, which is
 * exactly the column's contract.
 */
const id = (message?: string) => z.guid(message);

const optionalId = z.preprocess(emptyToNull, id().nullable());

/**
 * For validating an id that arrived as a route parameter rather than a form
 * field. Postgres compares `uuid` to `uuid`, so a URL segment that is not that
 * shape is a 22P02 cast failure, not an empty result — which surfaces as a 500
 * on a URL a user can type. Checking the shape first turns it back into what it
 * actually is: a work order that is not there.
 */
export const workOrderIdSchema = id();

/**
 * `<input type="date">` posts `YYYY-MM-DD`, which is exactly what a Postgres
 * `date` wants. Validating the shape here keeps a hand-edited POST from turning
 * into a 22007 the user cannot act on.
 */
const optionalDueDate = z.preprocess(
  emptyToNull,
  z.iso.date("Enter a valid date.").nullable(),
);

const optionalDescription = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(
      DESCRIPTION_MAX_LENGTH,
      `Use ${DESCRIPTION_MAX_LENGTH} characters or fewer.`,
    )
    .nullable(),
);

/**
 * Exactly the six columns `authenticated` holds an INSERT grant on. `status` and
 * `vendor_id` are absent by design, not by omission: excluding them at the grant
 * level is what makes every work order start `open` and every assignment an
 * audited UPDATE that the activity trigger can see.
 */
export const createWorkOrderSchema = z.object({
  propertyId: id("Choose a property."),
  unitId: optionalId,
  title: z
    .string()
    .trim()
    .min(1, "Enter a title.")
    .max(TITLE_MAX_LENGTH, `Use ${TITLE_MAX_LENGTH} characters or fewer.`),
  description: optionalDescription,
  priority: z.enum(Constants.public.Enums.work_order_priority),
  dueDate: optionalDueDate,
});

export const assignVendorSchema = z.object({
  workOrderId: id(),
  vendorId: id("Choose a vendor."),
});

/**
 * Non-blank, not merely non-null. `activity_note_requires_text` only checks
 * `note is not null` today, so `''` and `'   '` both insert — and the trail is
 * append-only for everyone, which makes a blank note permanent and unfixable
 * (docs/backlog.md, issue #76). The forward migration tightening the constraint
 * ships alongside this; the schema is the half that says so in the form.
 */
export const addNoteSchema = z.object({
  workOrderId: id(),
  note: z
    .string()
    .trim()
    .min(1, "Enter a note.")
    .max(NOTE_MAX_LENGTH, `Use ${NOTE_MAX_LENGTH} characters or fewer.`),
});

export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
export type AssignVendorInput = z.infer<typeof assignVendorSchema>;
export type AddNoteInput = z.infer<typeof addNoteSchema>;
