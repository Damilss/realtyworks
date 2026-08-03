import "server-only";

import { notFound } from "next/navigation";

import type { Enums, Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/server/queries/session";

export type WorkOrderListItem = {
  id: string;
  title: string;
  status: Enums<"work_order_status">;
  priority: Enums<"work_order_priority">;
  dueDate: string | null;
  propertyName: string | null;
  unitLabel: string | null;
  vendorName: string | null;
};

/**
 * Every work order the caller may see. There is no role branch here on purpose:
 * `work_orders_select_staff_or_assigned` scopes the rows, so staff get all of
 * them and a vendor gets only the ones assigned to them — from the identical
 * query. Adding a client-side filter would duplicate the policy and invite the
 * two to drift (CLAUDE.md §2).
 *
 * The embeds carry explicit foreign-key hints because `property_id` belongs to
 * two constraints — `work_orders_property_id_fkey` and the composite
 * `work_orders_unit_in_property` — and PostgREST rejects an ambiguous embed.
 */
export async function listWorkOrders(): Promise<WorkOrderListItem[]> {
  await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("work_orders")
    .select(
      `
        id,
        title,
        status,
        priority,
        due_date,
        properties!work_orders_property_id_fkey ( name ),
        units!work_orders_unit_in_property ( label ),
        vendors!work_orders_vendor_id_fkey ( name )
      `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[work-orders] Failed to list work orders", error);
    throw new Error("Could not load work orders.");
  }

  // Narrowed to what the table renders rather than passing rows through. A
  // vendor can already read `description` and `cost_cents` on an assigned job
  // (docs/vendor-access.md), so there is no reason to ship either to a list view
  // that never displays them.
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    propertyName: row.properties?.name ?? null,
    unitLabel: row.units?.label ?? null,
    vendorName: row.vendors?.name ?? null,
  }));
}

export type WorkOrderDetail = WorkOrderListItem & {
  description: string | null;
  propertyId: string;
  unitId: string | null;
  vendorId: string | null;
  costCents: number | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * One work order, or a 404.
 *
 * `maybeSingle()` and `notFound()` rather than an error: under
 * `work_orders_select_staff_or_assigned` a work order the caller may not see
 * returns zero rows, exactly like one that does not exist. Rendering both as
 * "not found" is the correct behaviour *and* the discreet one — a distinct
 * "forbidden" page would confirm to a vendor that a given id is real.
 */
export async function getWorkOrder(id: string): Promise<WorkOrderDetail> {
  await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("work_orders")
    .select(
      `
        id,
        title,
        description,
        status,
        priority,
        due_date,
        cost_cents,
        created_at,
        updated_at,
        property_id,
        unit_id,
        vendor_id,
        properties!work_orders_property_id_fkey ( name ),
        units!work_orders_unit_in_property ( label ),
        vendors!work_orders_vendor_id_fkey ( name )
      `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[work-orders] Failed to load work order", error);
    throw new Error("Could not load that work order.");
  }

  if (!data) {
    notFound();
  }

  return {
    id: data.id,
    title: data.title,
    description: data.description,
    status: data.status,
    priority: data.priority,
    dueDate: data.due_date,
    costCents: data.cost_cents,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    propertyId: data.property_id,
    propertyName: data.properties?.name ?? null,
    unitId: data.unit_id,
    unitLabel: data.units?.label ?? null,
    vendorId: data.vendor_id,
    vendorName: data.vendors?.name ?? null,
  };
}

/**
 * The narrow slice of an activity row's `old_value`/`new_value` payload the
 * trail renders. The trigger writes these as jsonb, so they arrive as `Json` and
 * have to be read defensively — a payload shape written by an older migration
 * must degrade to "no detail", never to a crash on the audit page.
 */
export type ActivityDetail = {
  status?: string;
  vendorName?: string;
  title?: string;
  fileName?: string;
  kind?: string;
};

export type ActivityEntry = {
  id: number;
  action: Enums<"activity_action">;
  actorName: string;
  note: string | null;
  createdAt: string;
  from: ActivityDetail;
  to: ActivityDetail;
};

const DETAIL_KEYS = [
  "status",
  "vendorName",
  "title",
  "fileName",
  "kind",
] as const;

/** The trigger writes snake_case keys; the component reads camelCase. */
const DETAIL_KEY_SOURCES: Record<(typeof DETAIL_KEYS)[number], string> = {
  status: "status",
  vendorName: "vendor_name",
  title: "title",
  fileName: "file_name",
  kind: "kind",
};

function readDetail(value: Json | null): ActivityDetail {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const detail: ActivityDetail = {};

  for (const key of DETAIL_KEYS) {
    const raw = value[DETAIL_KEY_SOURCES[key]];
    if (typeof raw === "string") {
      detail[key] = raw;
    }
  }

  return detail;
}

/**
 * The audit trail for one work order (CLAUDE.md §5 — a product feature, not a
 * nice-to-have).
 *
 * Ordered by the identity PK, not `created_at`: one UPDATE that changes both
 * status and assignment writes two rows inside a single transaction, where
 * `now()` is identical. The PK is what totally orders them.
 *
 * Actor names are resolved with two extra reads instead of a `profiles` embed.
 * A vendor has no SELECT policy on staff profile rows, so an embed would render
 * every staff action as an anonymous entry for exactly the person who most needs
 * to know who assigned them the job. `public.staff_directory` exists for this —
 * a postgres-owned view exposing id + full_name only — and `vendors` covers the
 * vendor actors (staff see all rows; a vendor sees their own).
 */
export async function listWorkOrderActivity(
  workOrderId: string,
): Promise<ActivityEntry[]> {
  await requireSession();
  const supabase = await createClient();

  const [
    { data: entries, error },
    { data: staff, error: staffError },
    { data: vendors, error: vendorError },
  ] = await Promise.all([
    supabase
      .from("work_order_activity")
      .select("id, action, actor_id, old_value, new_value, note, created_at")
      .eq("work_order_id", workOrderId)
      .order("id", { ascending: true }),
    supabase.from("staff_directory").select("id, full_name"),
    supabase.from("vendors").select("name, profile_id"),
  ]);

  if (error) {
    console.error("[work-orders] Failed to load activity", error);
    throw new Error("Could not load the activity trail.");
  }

  // A name lookup that fails degrades to "Unknown user" — the entry itself is
  // the record, and dropping the page because a directory read failed would
  // hide the audit trail over a cosmetic problem. Still logged: silently
  // anonymous history is how an audit trail rots.
  if (staffError) {
    console.error("[work-orders] Failed to resolve staff names", staffError);
  }
  if (vendorError) {
    console.error("[work-orders] Failed to resolve vendor names", vendorError);
  }

  const names = new Map<string, string>();

  for (const person of staff ?? []) {
    if (person.id && person.full_name) {
      names.set(person.id, person.full_name);
    }
  }
  for (const vendor of vendors ?? []) {
    if (vendor.profile_id) {
      names.set(vendor.profile_id, vendor.name);
    }
  }

  return entries.map((entry) => ({
    id: entry.id,
    action: entry.action,
    // `actor_id` is nullable: seed and service contexts have no auth.uid().
    actorName: entry.actor_id
      ? (names.get(entry.actor_id) ?? "Unknown user")
      : "System",
    note: entry.note,
    createdAt: entry.created_at,
    from: readDetail(entry.old_value),
    to: readDetail(entry.new_value),
  }));
}
