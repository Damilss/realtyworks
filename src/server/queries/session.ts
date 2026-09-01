import "server-only";

import { cache } from "react";

import { redirect } from "next/navigation";

import type { Enums } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * The session/authorization data access layer.
 *
 * Auth checks deliberately do NOT live in a layout. Next.js Partial Rendering
 * means a layout does not re-render on client-side navigation, so a check
 * placed there silently stops running as the user moves between sibling routes
 * (node_modules/next/dist/docs/01-app/02-guides/authentication.md, "Layouts and
 * auth checks"). Every page calls into this module instead.
 *
 * None of this is the security boundary — RLS is (CLAUDE.md §2). These helpers
 * decide what to *render*; the database decides what a query may return.
 *
 * `cache()` memoizes per render pass, so a layout and its page reading the same
 * profile cost one round trip, not two.
 *
 * Two entry points resolve the caller, and the difference is not stylistic.
 * Pages and query modules use `getSession()`, which reads the access token's
 * claims — under asymmetric signing keys that is a local signature check with
 * no round trip, and a signature stays valid until `jwt_expiry` (3600s) even
 * for an account deleted, banned, or signed out a minute ago. Deciding what to
 * *render* can live with that. Server actions that mutate use
 * `getVerifiedCaller()`, which asks the Auth server and therefore answers about
 * the account as it is now. Actions resolve the caller through this module too
 * rather than each growing its own call, which is how three different answers
 * to one question appeared across `src/server/actions/`.
 */

export type Session = {
  userId: string;
  email: string | null;
};

export type CurrentProfile = {
  id: string;
  role: Enums<"app_role">;
  fullName: string | null;
  phone: string | null;
  /**
   * The `vendors` row this profile is linked to, or null. A self-registered
   * user is a `vendor` with no such link, which resolves `current_vendor_id()`
   * to NULL in Postgres and makes every vendor-scoped policy arm return
   * nothing. The dashboard uses this to explain the empty state rather than
   * rendering a blank page that looks broken.
   */
  vendorId: string | null;
};

export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error) {
    // The proxy already distinguishes a transient Auth outage from a genuinely
    // invalid session and clears cookies in the latter case. Here the only
    // correct move is to treat the request as unauthenticated; logging keeps a
    // silent degradation from looking like a random logout (CLAUDE.md §5).
    console.error("[session] Failed to read auth claims", error);
    return null;
  }

  if (!data?.claims?.sub) {
    return null;
  }

  return {
    userId: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
  };
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

/**
 * The caller of a mutation, verified against the Auth server.
 *
 * `getUser()` rather than the claims `getSession()` reads: `getClaims()` only
 * falls back to a server round trip while the JWT is symmetrically signed, and
 * verifies the signature locally the moment a project moves to asymmetric
 * signing keys (auth-js `GoTrueClient.getClaims`). Local verification cannot
 * know a session was revoked, so it admits one for the rest of `jwt_expiry`.
 * A path that changes a credential — or writes an actor id no later check can
 * repair — needs the current answer, not a valid signature over an old one.
 *
 * Returns null instead of redirecting, unlike `requireSession()`: an action
 * answers `useActionState` with a message its form renders, and a redirect
 * would discard that — and send an account-setup caller to a login form they
 * have no password for.
 *
 * Deliberately not `cache()`-wrapped. The memoization above exists because a
 * layout and its page read the same profile in one render pass; an action asks
 * once, and caching a liveness check is the opposite of what it is for.
 */
export async function getVerifiedCaller(): Promise<Session | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    // A merely signed-out caller lands here too — auth-js reports a missing
    // session as an error — so this is not necessarily a fault. Logged anyway,
    // because the alternative is a refused mutation with no trace of why.
    console.error("[session] Could not verify the caller", {
      code: error?.code,
      status: error?.status,
    });
    return null;
  }

  return { userId: data.user.id, email: data.user.email ?? null };
}

export const getCurrentProfile = cache(
  async (): Promise<CurrentProfile | null> => {
    const session = await requireSession();
    const supabase = await createClient();

    const [
      { data: profile, error },
      { data: vendorId, error: vendorLinkError },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, role, full_name, phone")
        .eq("id", session.userId)
        .maybeSingle(),
      supabase.rpc("current_vendor_id"),
    ]);

    if (error) {
      console.error("[session] Failed to load profile", error);
      return null;
    }

    // Fails closed — a linked vendor whose lookup failed is treated as unlinked
    // and shown the "not linked yet" state rather than someone else's work.
    // That is the safe direction but a confusing one, so it must not be silent.
    if (vendorLinkError) {
      console.error("[session] Failed to resolve vendor link", vendorLinkError);
    }

    // A live session whose profile row is missing must NOT redirect to /login:
    // the cookie is still valid, so the login page would bounce straight back
    // here and loop. Report it and let the caller render a terminal state.
    if (!profile) {
      return null;
    }

    return {
      id: profile.id,
      role: profile.role,
      fullName: profile.full_name,
      phone: profile.phone,
      vendorId: vendorId ?? null,
    };
  },
);

/**
 * Landlords and managers. Mirrors `public.is_staff()`; both exist because this
 * one decides what to render and that one decides what the database returns.
 */
export function isStaff(profile: CurrentProfile): boolean {
  return profile.role === "landlord" || profile.role === "manager";
}
