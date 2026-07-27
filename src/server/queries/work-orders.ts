import "server-only";

import type { Enums } from "@/lib/database.types";
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
