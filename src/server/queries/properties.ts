import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/server/queries/session";

export type UnitOption = {
  id: string;
  label: string;
};

export type PropertyOption = {
  id: string;
  name: string;
  units: UnitOption[];
};

/**
 * Properties with their units, for the work-order form's two pickers. Loaded in
 * one query and filtered in the browser rather than re-fetching units when the
 * property changes — the whole list is a handful of rows at MVP scale, and it
 * keeps the form working without a round trip per keystroke.
 *
 * No role branch: `units_select_staff` restricts units to staff, and only staff
 * can insert a work order anyway (`work_orders_insert_staff`), so a vendor
 * calling this gets their assigned properties with empty unit lists rather than
 * an error. The form is never rendered for them.
 */
export async function listPropertiesWithUnits(): Promise<PropertyOption[]> {
  await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("properties")
    .select("id, name, units ( id, label )")
    .order("name", { ascending: true })
    .order("label", { ascending: true, referencedTable: "units" });

  if (error) {
    console.error("[properties] Failed to list properties", error);
    throw new Error("Could not load properties.");
  }

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    units: row.units.map((unit) => ({ id: unit.id, label: unit.label })),
  }));
}
