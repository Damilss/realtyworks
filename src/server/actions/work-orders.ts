"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ATTACHMENTS_BUCKET } from "@/lib/attachments";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  addNoteSchema,
  assignVendorSchema,
  createWorkOrderSchema,
  recordAttachmentSchema,
  updateStatusSchema,
} from "@/schemas/work-order";

/**
 * Work-order mutations — the write half of the Phase 3 vertical slice.
 *
 * No `import "server-only"` here, deliberately: server actions are the one part
 * of `src/server/` that client components are meant to import, because
 * `"use server"` swaps the body for an RPC reference and the implementation
 * never ships (see the same note in ./auth.ts).
 *
 * None of these actions re-implements an authorization rule. RLS decides which
 * rows the caller may touch, the column grants decide which fields are writable
 * at all, and `guard_work_order_update()` decides what a vendor may change.
 * These functions validate shape, translate the database's refusal into a
 * sentence, and revalidate the pages that just went stale (CLAUDE.md §2 — the
 * client may mirror the rules for UX; the database is the source of truth).
 */

export type WorkOrderFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
};

/**
 * Past every field's own maximum, so truncation can only ever shorten input that
 * is already invalid. Same reasoning as the twin in ./auth.ts: a server action
 * is a public POST endpoint, and without a bound an arbitrarily long field comes
 * straight back out in the response.
 */
const MAX_ECHOED_LENGTH = 2100;

/**
 * React resets an uncontrolled form after *every* function action, error paths
 * included — `startHostTransition` calls `requestFormReset` before the action
 * runs, so the commit that renders the error is the same one that empties the
 * inputs. Anything not echoed here is retyped (CLAUDE.md §0). Read back as
 * typed, not from the parsed result, which does not exist when validation is
 * what failed.
 */
function submittedValues(
  formData: FormData,
  names: readonly string[],
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const name of names) {
    const value = formData.get(name);

    // A FormData entry can be a File; String()-ing one yields "[object File]".
    if (typeof value === "string") {
      values[name] = value.slice(0, MAX_ECHOED_LENGTH);
    }
  }

  return values;
}

/**
 * Turns a refusal from Postgres into something a user can act on. The database
 * is doing the enforcing, so these are translations, not policy.
 *
 * `foreignKeyMessage` is a parameter because 23503 is not one situation. A work
 * order can point at a property that was deleted since the page loaded, at a
 * unit that belongs to a different property, or at a vendor that no longer
 * exists, and an activity row can point at a work order someone removed
 * mid-edit — all the same SQLSTATE, arriving at the same mapper. Deciding the
 * sentence here meant every one of them read as a unit/property mismatch, which
 * is unactionable advice for a form with no unit on it.
 */
function describeError(
  error: { code?: string; message?: string },
  foreignKeyMessage: string,
): string {
  switch (error.code) {
    // RLS or a missing column grant, and the vendor guard trigger's own raise.
    case "42501":
      return "You do not have permission to make that change.";
    case "23503":
      return foreignKeyMessage;
    case "23514":
      return "That change is not allowed for this work order.";
    default:
      return "Something went wrong. Try again.";
  }
}

/**
 * `work_orders_vendor_id_fkey`, the only foreign key an assignment can break:
 * the vendor was deleted between the page rendering the option and the form
 * posting it. A landlord can delete a vendor directly, so this is a real race,
 * not a theoretical one.
 */
const VENDOR_GONE = "That vendor is no longer available.";

/** `work_order_activity_work_order_id_fkey` — the job was deleted mid-note. */
const WORK_ORDER_GONE = "That work order is no longer available.";

const CREATE_FIELDS = [
  "propertyId",
  "unitId",
  "title",
  "description",
  "priority",
  "dueDate",
] as const;

export async function createWorkOrder(
  _prevState: WorkOrderFormState,
  formData: FormData,
): Promise<WorkOrderFormState> {
  const values = submittedValues(formData, CREATE_FIELDS);
  const parsed = createWorkOrderSchema.safeParse({
    propertyId: formData.get("propertyId"),
    unitId: formData.get("unitId"),
    title: formData.get("title"),
    description: formData.get("description"),
    priority: formData.get("priority"),
    dueDate: formData.get("dueDate"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const supabase = await createClient();

  // Exactly the six columns `authenticated` holds an INSERT grant on. `status`
  // and `vendor_id` are absent on purpose: every work order starts 'open', and
  // assignment is an UPDATE the activity trigger can log.
  const { data, error } = await supabase
    .from("work_orders")
    .insert({
      property_id: parsed.data.propertyId,
      unit_id: parsed.data.unitId,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority,
      due_date: parsed.data.dueDate,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[work-orders] Failed to create work order", {
      code: error.code,
    });
    // Two different constraints answer with 23503 here — the property FK and the
    // composite unit-in-property one — so the sentence follows what was actually
    // on the form. Naming a unit to someone who chose "Whole property" sends
    // them looking for a field they never touched.
    return {
      error: describeError(
        error,
        parsed.data.unitId
          ? "That unit does not belong to the selected property, or one of them has been removed."
          : "That property is no longer available.",
      ),
      values,
    };
  }

  revalidatePath("/dashboard");

  // Outside any try/catch: redirect() signals by throwing NEXT_REDIRECT, and a
  // catch would swallow it and silently leave the user on the form.
  redirect(`/work-orders/${data.id}`);
}

export async function assignVendor(
  _prevState: WorkOrderFormState,
  formData: FormData,
): Promise<WorkOrderFormState> {
  const values = submittedValues(formData, ["vendorId"]);
  const parsed = assignVendorSchema.safeParse({
    workOrderId: formData.get("workOrderId"),
    vendorId: formData.get("vendorId"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("work_orders")
    .select("status")
    .eq("id", parsed.data.workOrderId)
    .maybeSingle();

  if (readError) {
    console.error("[work-orders] Failed to read work order before assigning", {
      code: readError.code,
    });
    return { error: describeError(readError, VENDOR_GONE), values };
  }

  if (!current) {
    return { error: WORK_ORDER_GONE, values };
  }

  // Advance an untouched work order to 'assigned', but never rewind one that is
  // already in progress or complete — reassigning a job mid-repair is a change
  // of vendor, not a change of state. `work_orders_assigned_has_vendor` is
  // satisfied either way, since vendor_id is being set in the same statement.
  //
  // The read above and this write are not one transaction, so a status change
  // landing between them could rewind an in_progress job to 'assigned'. Left as
  // is deliberately: the window is a single round trip, the damage is a wrong
  // label that the next status change corrects, and both the read and the write
  // are already RLS-checked. Closing it properly means a database function, not
  // a bigger server action.
  const { error } = await supabase
    .from("work_orders")
    .update(
      current.status === "open"
        ? { vendor_id: parsed.data.vendorId, status: "assigned" }
        : { vendor_id: parsed.data.vendorId },
    )
    .eq("id", parsed.data.workOrderId);

  if (error) {
    console.error("[work-orders] Failed to assign vendor", {
      code: error.code,
    });
    return { error: describeError(error, VENDOR_GONE), values };
  }

  revalidatePath(`/work-orders/${parsed.data.workOrderId}`);
  revalidatePath("/dashboard");

  return {};
}

export async function addNote(
  _prevState: WorkOrderFormState,
  formData: FormData,
): Promise<WorkOrderFormState> {
  const values = submittedValues(formData, ["note"]);
  const parsed = addNoteSchema.safeParse({
    workOrderId: formData.get("workOrderId"),
    note: formData.get("note"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const supabase = await createClient();

  // `action` and `actor_id` carry no INSERT grant, so their defaults
  // ('note_added', auth.uid()) apply and `activity_insert_note` pins them —
  // a note cannot be authored as someone else, or forged into another action.
  const { error } = await supabase.from("work_order_activity").insert({
    work_order_id: parsed.data.workOrderId,
    note: parsed.data.note,
  });

  if (error) {
    console.error("[work-orders] Failed to add note", { code: error.code });
    return { error: describeError(error, WORK_ORDER_GONE), values };
  }

  revalidatePath(`/work-orders/${parsed.data.workOrderId}`);

  // No echoed values: on success the textarea should end up empty, and React's
  // post-action reset already does that.
  return {};
}

/**
 * The vendor's half of the slice: report progress on an assigned job.
 *
 * Nothing here re-implements the rule. `guard_work_order_update()` is a
 * BEFORE UPDATE trigger that raises 42501 if a vendor touches any column but
 * `status`, or moves status anywhere but `in_progress`/`completed`; the UPDATE
 * grant excludes `created_by` and the timestamps outright; and
 * `work_orders_update_staff_or_assigned` decides whose rows are even visible.
 * This action posts a status and translates the refusal.
 *
 * It is deliberately not staff-gated in the UI *or* here — staff status editing
 * is a separate decision, and the trigger's vendor arm simply does not apply to
 * them, so nothing about this path is unsafe for a manager who posts to it.
 */
export async function updateWorkOrderStatus(
  _prevState: WorkOrderFormState,
  formData: FormData,
): Promise<WorkOrderFormState> {
  const values = submittedValues(formData, ["status"]);
  const parsed = updateStatusSchema.safeParse({
    workOrderId: formData.get("workOrderId"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("work_orders")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.workOrderId);

  if (error) {
    console.error("[work-orders] Failed to update status", {
      code: error.code,
    });
    return { error: describeError(error, WORK_ORDER_GONE), values };
  }

  revalidatePath(`/work-orders/${parsed.data.workOrderId}`);
  revalidatePath("/dashboard");

  return {};
}

/**
 * The metadata half of the coordinated trusted upload path.
 *
 * The bytes never pass through here. The browser has already put the object in
 * Storage under its own session, where `wo_attachments_insert` checked that the
 * caller may reach that work order. This function records the row that makes the
 * object visible to the app — a **service-role write**, because
 * `work_order_attachments` carries no client INSERT grant by design: a client
 * able to insert metadata could register a row with no file behind it, which
 * would 404 on download, emit an immutable `attachment_added` trail entry, and
 * be undeletable through any client surface
 * (`20260717120700_create_work_order_attachments.sql`).
 *
 * Bypassing RLS is the entire point of the privileged client, which is exactly
 * why it must not be the thing that decides whether the caller was allowed. The
 * order below is load-bearing: **establish access with the session client
 * first**, and only then reach for the admin client.
 */
export async function recordAttachment(input: {
  workOrderId: string;
  attachmentId: string;
  storagePath: string;
  fileName: string;
  kind: "photo" | "receipt" | "invoice" | "document";
}): Promise<{ error?: string }> {
  const parsed = recordAttachmentSchema.safeParse(input);

  if (!parsed.success) {
    console.error("[work-orders] Rejected an attachment record", {
      issues: z.flattenError(parsed.error).fieldErrors,
    });
    return { error: "That upload could not be recorded." };
  }

  const { workOrderId, attachmentId, storagePath, fileName, kind } =
    parsed.data;
  const supabase = await createClient();

  // Resolved before anything else, because it is required and unfaked-able:
  // `uploaded_by` is NOT NULL with a FK to profiles and no default, so an
  // absent actor has to stop the request here rather than fail the insert after
  // the object is already stored.
  const { data: claims } = await supabase.auth.getClaims();
  const uploadedBy = claims?.claims?.sub;

  if (!uploadedBy) {
    return { error: "Your session has expired. Sign in again." };
  }

  // Access, decided by the database, through the caller's own session. This is
  // the same predicate the storage policy used to admit the object, asked again
  // because the upload and this call are two separate requests.
  const { data: allowed, error: accessError } = await supabase.rpc(
    "can_access_work_order",
    { p_work_order_id: workOrderId },
  );

  if (accessError || allowed !== true) {
    if (accessError) {
      console.error("[work-orders] Failed to check attachment access", {
        code: accessError.code,
      });
    }
    return { error: "You do not have access to that work order." };
  }

  // Read the object back rather than trusting the caller's description of it.
  // This proves the object exists — the metadata row must never point at a 404,
  // the mirror image of the orphan the missing INSERT grant prevents — and it
  // yields the true content type and size, which the client is in no position
  // to be believed about once the row is written with the service role.
  const { data: object, error: infoError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .info(storagePath);

  if (infoError || !object) {
    console.error("[work-orders] Attachment object not found after upload", {
      message: infoError?.message,
    });
    return { error: "That upload could not be found. Try again." };
  }

  const admin = createAdminClient();

  // `id` and `uploaded_by` have no database defaults, on purpose. A generated id
  // would never match the one already baked into the object name, and under the
  // service role `auth.uid()` is NULL — so a default could not supply the actor
  // anyway, it would only let this compile without one. The trail trigger
  // coalesces auth.uid() to this value, which is what keeps the entry attributed
  // to the vendor rather than to the system.
  const { error: insertError } = await admin
    .from("work_order_attachments")
    .insert({
      id: attachmentId,
      work_order_id: workOrderId,
      kind,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: object.contentType ?? "application/octet-stream",
      size_bytes: object.size ?? null,
      uploaded_by: uploadedBy,
    });

  if (insertError) {
    console.error("[work-orders] Failed to record attachment metadata", {
      code: insertError.code,
    });

    // Remove the object we just failed to register. Clients have no delete
    // surface on either layer, so without this the failure leaves a file nothing
    // references and nothing can ever clean up.
    const { error: cleanupError } = await admin.storage
      .from(ATTACHMENTS_BUCKET)
      .remove([storagePath]);

    if (cleanupError) {
      console.error("[work-orders] Failed to remove the orphaned object", {
        path: storagePath,
        message: cleanupError.message,
      });
    }

    return { error: "That upload could not be recorded." };
  }

  revalidatePath(`/work-orders/${workOrderId}`);

  return {};
}
