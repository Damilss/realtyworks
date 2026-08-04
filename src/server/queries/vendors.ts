import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/server/queries/session";

export type VendorOption = {
  id: string;
  name: string;
  email: string | null;
  /**
   * The linked auth user, or null. Staff read this to know whether a vendor has
   * ever been invited; it has no client write grant, so only the invite server
   * action (service role) can set it.
   */
  profileId: string | null;
};

/**
 * Vendor contact rows. `vendors_select_staff_or_self` scopes them: staff see
 * every vendor, a linked vendor sees only their own row. That second arm is what
 * lets the activity trail name a vendor actor for the vendor themselves without
 * a separate query path.
 */
export async function listVendors(): Promise<VendorOption[]> {
  await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vendors")
    .select("id, name, email, profile_id")
    .order("name", { ascending: true });

  if (error) {
    console.error("[vendors] Failed to list vendors", error);
    throw new Error("Could not load vendors.");
  }

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    profileId: row.profile_id,
  }));
}

export type VendorRow = VendorOption & {
  phone: string | null;
  createdAt: string;
};

/**
 * The same rows with the contact details the `/vendors` table renders. Kept
 * separate from `listVendors()` rather than widening it: the assign `<select>`
 * needs a name and an id, and shipping a phone number into a page that never
 * shows one is the kind of over-fetch that only ever becomes a leak later.
 */
export async function listVendorRows(): Promise<VendorRow[]> {
  await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vendors")
    .select("id, name, phone, email, profile_id, created_at")
    .order("name", { ascending: true });

  if (error) {
    console.error("[vendors] Failed to list vendor rows", error);
    throw new Error("Could not load vendors.");
  }

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    profileId: row.profile_id,
    createdAt: row.created_at,
  }));
}
