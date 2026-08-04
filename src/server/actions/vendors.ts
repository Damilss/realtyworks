"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createVendorSchema, inviteVendorSchema } from "@/schemas/vendor";

/**
 * Vendor mutations — adding a contact row, and turning one into a login.
 *
 * No `import "server-only"`, for the same reason as the other action modules:
 * `"use server"` swaps the body for an RPC reference, so the implementation
 * never ships to the browser.
 *
 * `createVendor` follows the house rule — RLS and the column grants do the
 * enforcing, and the action only translates. `inviteVendor` is the one place in
 * this codebase that cannot, and the difference is worth being explicit about
 * (see its own note).
 */

export type VendorFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
  /**
   * The freshly minted magic link, returned only to the staff member who asked
   * for it and never stored. It is a bearer credential for one login, so it is
   * deliberately absent from the activity trail, from the server logs, and from
   * every database row — the only copy is the one in this response.
   */
  inviteUrl?: string;
};

/** Past every field's own maximum. Same reasoning as the twin in ./auth.ts. */
const MAX_ECHOED_LENGTH = 256;

/** Same reasoning as the twins in ./auth.ts and ./work-orders.ts. */
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

function describeError(error: { code?: string; message?: string }): string {
  switch (error.code) {
    // RLS (vendors_insert_staff) or a missing column grant.
    case "42501":
      return "You do not have permission to make that change.";
    // `vendors_profile_id_key`, the partial unique index on the auth link.
    case "23505":
      return "That email already belongs to a different vendor.";
    // `vendors_contact_method`.
    case "23514":
      return "Enter an email address or a phone number.";
    // `vendors_created_by_fkey` — the acting profile was removed mid-request.
    case "23503":
      return "Your account is no longer available. Sign in again.";
    default:
      return "Something went wrong. Try again.";
  }
}

const CREATE_FIELDS = ["name", "phone", "email"] as const;

export async function createVendor(
  _prevState: VendorFormState,
  formData: FormData,
): Promise<VendorFormState> {
  const values = submittedValues(formData, CREATE_FIELDS);
  const parsed = createVendorSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const supabase = await createClient();

  // Exactly the three columns `authenticated` holds an INSERT grant on.
  // `profile_id` is absent by design — the auth link is a service-role write,
  // made only by inviteVendor below — and `created_by` defaults to auth.uid().
  const { error } = await supabase.from("vendors").insert({
    name: parsed.data.name,
    phone: parsed.data.phone,
    email: parsed.data.email,
  });

  if (error) {
    console.error("[vendors] Failed to create vendor", { code: error.code });
    return { error: describeError(error), values };
  }

  revalidatePath("/vendors");

  // No echoed values: on success the form should come back empty, and React's
  // post-action reset already does that.
  return {};
}

/**
 * Turns a vendor contact row into a login and hands back a magic link
 * (docs/vendor-access.md — "give vendors accounts they never know they have").
 *
 * **This action carries its own authorization check, and that is a deliberate
 * exception.** Everywhere else in this codebase the database decides: RLS picks
 * the rows, grants pick the columns, and an action that re-implemented either
 * would only create something to drift. There is no policy to lean on here.
 * `vendors.profile_id` has no client write grant at all, so the write happens
 * through the service role, which bypasses RLS by definition — the thing that
 * would normally say no is switched off. `vendors_select_staff_or_self` is not a
 * substitute: its `or profile_id = auth.uid()` arm means a linked vendor can
 * read their *own* row, so a read succeeding proves staff-ness for nobody.
 *
 * So the check is explicit, and it is still the database answering:
 * `public.is_staff()` through the caller's own session, not a role copied out of
 * a JWT or mirrored in TypeScript.
 */
export async function inviteVendor(
  _prevState: VendorFormState,
  formData: FormData,
): Promise<VendorFormState> {
  const parsed = inviteVendorSchema.safeParse({
    vendorId: formData.get("vendorId"),
    workOrderId: formData.get("workOrderId"),
  });

  if (!parsed.success) {
    return { error: "That invite request was malformed." };
  }

  const supabase = await createClient();

  const { data: staff, error: staffError } = await supabase.rpc("is_staff");

  if (staffError || staff !== true) {
    if (staffError) {
      console.error("[vendors] Failed to check staff role before inviting", {
        code: staffError.code,
      });
    }
    return { error: "You do not have permission to invite a vendor." };
  }

  // Read through the caller's session, so RLS still scopes what is visible, and
  // read the vendor *from the work order* rather than trusting the posted
  // vendorId to match it. An invite deep-links a specific job; minting one for a
  // vendor who is not assigned to that job would hand them a link that lands on
  // a 404, because `can_access_work_order()` only admits the current assignee.
  const { data: workOrder, error: workOrderError } = await supabase
    .from("work_orders")
    .select(
      "id, vendor_id, vendors!work_orders_vendor_id_fkey ( id, name, email, profile_id )",
    )
    .eq("id", parsed.data.workOrderId)
    .maybeSingle();

  if (workOrderError) {
    console.error("[vendors] Failed to read the work order before inviting", {
      code: workOrderError.code,
    });
    return { error: describeError(workOrderError) };
  }

  if (!workOrder) {
    return { error: "That work order is no longer available." };
  }

  const vendor = workOrder.vendors;

  if (!vendor || vendor.id !== parsed.data.vendorId) {
    return { error: "That vendor is no longer assigned to this work order." };
  }

  if (!vendor.email) {
    return {
      error:
        "Add an email address to this vendor before inviting them. " +
        "Text-message invites arrive in a later phase.",
    };
  }

  // `createAdminClient()` throws on a missing or swapped `SUPABASE_SECRET_KEY`,
  // and that is a *recoverable misconfiguration*, not a bug — the secret is read
  // nowhere else, so an environment without it runs the whole app correctly and
  // fails only here (`.env.example` says exactly that). Left uncaught the throw
  // escapes the action, and with no error boundary in `src/app` the manager gets
  // a redacted crash instead of the message `VendorFormState` exists to carry.
  let admin: ReturnType<typeof createAdminClient>;

  try {
    admin = createAdminClient();
  } catch (error) {
    console.error("[vendors] The privileged client is unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: "Vendor invites are not configured on this server." };
  }

  // Create the account explicitly rather than letting generateLink() create it
  // implicitly. Two things depend on doing it here: `app_metadata.app_role` is
  // the only source handle_new_user() reads for the role, and `full_name` is
  // what stops the vendor's own dashboard greeting them as nobody. The implicit
  // path sets neither, and it also depends on `[auth] enable_signup` staying
  // true — which has already been flipped once.
  //
  // `email_confirm: true` means GoTrue sends nothing; we deliver the link
  // ourselves (over SMS from Phase 5 — docs/vendor-access.md §5).
  const created = await admin.auth.admin.createUser({
    email: vendor.email,
    email_confirm: true,
    app_metadata: { app_role: "vendor" },
    user_metadata: { full_name: vendor.name },
  });

  // Self-service signup is open, so the address may already have an account.
  // That is not automatically the vendor's account, which is why the branch
  // below only records the fact and the decision is made once the account has
  // been resolved.
  if (created.error && created.error.code !== "email_exists") {
    console.error("[vendors] Failed to create the vendor account", {
      code: created.error.code,
      status: created.error.status,
    });
    return { error: "Could not create an account for that vendor." };
  }

  const accountPreexisted = created.error?.code === "email_exists";

  // Mints the token AND resolves the account — GenerateLinkResponse carries the
  // user, which is what makes the email_exists branch above need no lookup of
  // its own.
  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: vendor.email,
  });

  if (link.error || !link.data?.user || !link.data.properties?.hashed_token) {
    console.error("[vendors] Failed to generate the vendor magic link", {
      code: link.error?.code,
      status: link.error?.status,
    });
    return { error: "Could not generate a link for that vendor." };
  }

  const invitedUserId = link.data.user.id;

  // Refuse an account this action did not create, unless it is already the one
  // this vendor row points at.
  //
  // `[auth.email] enable_confirmations` is still false while signup is open
  // (docs/backlog.md — "Turn on email confirmations before the Phase 4 public
  // deploy"), so anyone can register an address they do not own and be signed in
  // immediately. The backlog rates that blast radius as nil because an unlinked
  // self-registration reads nothing — and it is this action that would end the
  // "unlinked" part. Squat a vendor's address, wait for staff to invite them,
  // and the link handed over is to the squatter's own account, which they hold
  // the password for. The magic link never has to be intercepted.
  //
  // The role check below does not cover this: `handle_new_user()` defaults a
  // self-registration to 'vendor'
  // (20260727140000_handle_new_user_phone_from_metadata.sql), so a squatted
  // account is exactly the role that check admits. It stops staff addresses,
  // not impostors.
  //
  // Re-inviting an already-linked vendor stays allowed — that is a fresh magic
  // link for the same account, and the common case of a lost invite.
  if (accountPreexisted && vendor.profile_id !== invitedUserId) {
    console.error("[vendors] Refused to link a pre-existing account", {
      vendorId: vendor.id,
      alreadyLinked: vendor.profile_id !== null,
    });
    return {
      error:
        "An account already exists for that email address, and it is not " +
        "this vendor's. Confirm the address belongs to them before inviting " +
        "again — someone else may have registered it.",
    };
  }

  // Refuse to link an account that is not a vendor. Without this, inviting a
  // vendor row that happens to carry a manager's address would give that
  // manager's session a `current_vendor_id()` — and `guard_work_order_update()`
  // keys the vendor column restrictions off the *role*, not off the link, so
  // the result is a staff account with a vendor's row visibility and none of a
  // vendor's write limits.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", invitedUserId)
    .maybeSingle();

  if (profileError || !profile) {
    console.error("[vendors] Failed to read the invited profile", {
      code: profileError?.code,
    });
    return { error: "Could not invite that vendor." };
  }

  if (profile.role !== "vendor") {
    return {
      error:
        "That email belongs to a staff account. Use an address that is not " +
        "already a landlord or manager.",
    };
  }

  // The one write with no client grant: service-role only, so the auth link
  // cannot be forged or moved through the Data API. Unlinking it (or deleting
  // the row) is what revokes access, and it takes effect on the very next
  // request — `current_vendor_id()` resolves NULL mid-session.
  const { error: linkError } = await admin
    .from("vendors")
    .update({ profile_id: invitedUserId })
    .eq("id", vendor.id);

  if (linkError) {
    console.error("[vendors] Failed to link the vendor to its account", {
      code: linkError.code,
    });
    // The token minted above is still live at this point, and that is harmless:
    // an account with no `vendors` row resolves current_vendor_id() to NULL, so
    // every vendor-scoped policy arm returns nothing. It logs in to an empty
    // app rather than to someone else's data.
    return { error: describeError(linkError) };
  }

  revalidatePath(`/work-orders/${parsed.data.workOrderId}`);
  revalidatePath("/vendors");

  return {
    inviteUrl: buildInviteUrl({
      tokenHash: link.data.properties.hashed_token,
      next: `/work-orders/${parsed.data.workOrderId}`,
      origin: await requestOrigin(),
    }),
  };
}

/**
 * The origin this request arrived on, rather than a hardcoded URL (CLAUDE.md §5)
 * or a build-time constant. Preview deploys, local dev on 127.0.0.1, and
 * production all mint links that point at themselves, with nothing to configure
 * per environment.
 */
async function requestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "127.0.0.1:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("127.0.0.1") || host.startsWith("localhost")
      ? "http"
      : "https");

  return `${protocol}://${host}`;
}

/**
 * Points at our own `/auth/confirm`, deliberately NOT at
 * `properties.action_link`. That one goes to GoTrue's `/auth/v1/verify`, which
 * returns the session in a URL fragment for a browser-side client to pick up —
 * the implicit flow. This app keeps its session in cookies written server-side,
 * so the token has to be redeemed by our own route handler instead.
 */
function buildInviteUrl({
  origin,
  tokenHash,
  next,
}: {
  origin: string;
  tokenHash: string;
  next: string;
}): string {
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "magiclink");
  url.searchParams.set("next", next);

  return url.toString();
}
