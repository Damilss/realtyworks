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

/**
 * The two statuses a vendor may move a job to, mirroring
 * `guard_work_order_update()`:
 *
 *     if new.status not in ('in_progress', 'completed') then raise ...
 *
 * Deliberately narrower than `Constants.public.Enums.work_order_status`, and
 * deliberately hardcoded rather than derived from it — the DB enum has five
 * values and this list is a *policy* about two of them, so generating it from
 * the enum would silently widen the form the day a sixth status is added.
 * `open`, `assigned` and `cancelled` stay staff-only, which is what keeps a
 * vendor from cancelling a job rather than reporting on it.
 */
export const VENDOR_STATUSES = ["in_progress", "completed"] as const;

export const updateStatusSchema = z.object({
  workOrderId: id(),
  status: z.enum(VENDOR_STATUSES, "Choose a status."),
});

/** `char_length(file_name) between 1 and 255` on `work_order_attachments`. */
const FILE_NAME_MAX_LENGTH = 255;

/**
 * The exact object name the storage policies and `attachments_path_matches_row`
 * both require: `<work_order_id>/<attachment_id>.<ext>`, one folder level, and
 * **lowercase** hex. The case matters — `z.guid()` accepts uppercase and
 * Postgres's `uuid` type renders lowercase, so an uppercase id would satisfy the
 * id fields, fail the storage regex, and only surface after the bytes were
 * already uploaded.
 */
const STORAGE_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-zA-Z0-9]+$/;

/**
 * The metadata half of the coordinated upload path
 * (`20260717120700_create_work_order_attachments.sql`). The object is already in
 * Storage by the time this runs — the client uploads it under its own session —
 * so this describes only what the client is *allowed* to assert about it.
 *
 * Note what is absent: `mimeType` and `sizeBytes`. Both are read back off the
 * stored object server-side, because the metadata row is written with the
 * service role and nothing downstream would catch a client that lied about
 * either. `fileName` and `kind` stay client-supplied — one is the original
 * filename, which exists nowhere else, and the other is a label staff can
 * correct through `attachments_update_staff`.
 */
export const recordAttachmentSchema = z
  .object({
    workOrderId: id(),
    attachmentId: id(),
    storagePath: z.string().regex(STORAGE_PATH_PATTERN, "Invalid upload path."),
    fileName: z
      .string()
      .trim()
      .min(1, "The file needs a name.")
      .max(
        FILE_NAME_MAX_LENGTH,
        `Use ${FILE_NAME_MAX_LENGTH} characters or fewer.`,
      ),
    kind: z.enum(Constants.public.Enums.attachment_kind),
  })
  .refine(
    // The folder IS the work order and the basename IS the attachment id.
    // Checked by comparing the parts rather than by interpolating the ids into
    // a pattern, so a path naming a *different* work order — the one case that
    // would let metadata point at somebody else's object — cannot satisfy it.
    (input) => {
      const [folder, basename] = input.storagePath.split("/");
      return (
        folder === input.workOrderId &&
        basename?.startsWith(`${input.attachmentId}.`)
      );
    },
    {
      path: ["storagePath"],
      message: "That upload does not belong to this work order.",
    },
  );

export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
export type AssignVendorInput = z.infer<typeof assignVendorSchema>;
export type AddNoteInput = z.infer<typeof addNoteSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type RecordAttachmentInput = z.infer<typeof recordAttachmentSchema>;
