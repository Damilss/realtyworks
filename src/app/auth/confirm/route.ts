import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Redeems a magic link and starts a session.
 *
 * This is the vendor's whole login: staff mint a link with `inviteVendor`, the
 * vendor taps it, and lands here with a one-time `token_hash`. Exchanging that
 * for a session is a cookie write, which a Server Component cannot do — hence a
 * route handler. `createClient()` from `@/lib/supabase/server` is the right
 * client and needs no variant: its readonly-cookie guard only swallows the
 * Server Component case, so here `cookieStore.set()` genuinely writes.
 *
 * The tokens are single-use — a replayed `token_hash` comes back as "Email link
 * is invalid or has expired" — and expire after `[auth.email] otp_expiry`
 * (3600s) in supabase/config.toml.
 */

/**
 * The link types this endpoint will redeem. `type` arrives in the query string,
 * so it is caller-controlled; passing it straight through would let someone
 * redeem a `recovery` or `email_change` token at an endpoint that was never
 * reviewed for either.
 */
const ALLOWED_TYPES = new Set(["magiclink", "invite"]);

/**
 * Only a same-origin *path* is an acceptable destination.
 *
 * This is the one endpoint in the app that mints a session, which makes it the
 * worst possible place for an open redirect: a link that logs someone in and
 * then bounces them to an attacker's page is a credible phishing primitive.
 * Rejecting anything but a relative path is the cheap, complete defence —
 * `//evil.example` is protocol-relative and must be refused too, which is why
 * the second character is checked.
 */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }

  return next;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNext(searchParams.get("next"));

  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) {
    redirect("/login?error=invalid-link");
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    // Never echo the token, and never distinguish "expired" from "already used"
    // from "never existed": all three are the same instruction to the user, and
    // telling them apart makes this endpoint an oracle for whether a given
    // token was ever real.
    console.error("[auth] Magic-link verification failed", {
      code: error.code,
      status: error.status,
    });
    redirect("/login?error=invalid-link");
  }

  // Outside any try/catch: redirect() signals by throwing NEXT_REDIRECT.
  redirect(next);
}
