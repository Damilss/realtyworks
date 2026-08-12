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
 * then bounces them to an attacker's page is a credible phishing primitive —
 * the victim is genuinely signed in when they land, which is exactly what makes
 * a "session expired, sign in again" page work.
 *
 * So `next` is resolved with the same parser the browser will use, and the
 * origins are compared. **Prefix matching cannot do this job**, which is what
 * the previous version of this guard tried: it rejected `//evil.example` but
 * admitted `/\evil.example`, because `\` is only equivalent to `/` once the
 * WHATWG URL parser reads it in the authority position. Tabs and newlines are
 * worse still — the parser strips them, so `/%09/evil.example` becomes
 * `//evil.example` *after* any string check has already approved it. Matching a
 * value that something downstream will reinterpret loses that argument
 * eventually; parsing it first does not.
 *
 * The return value is deliberately a bare path. Emitting no host means even a
 * spoofed `Host` header — which is where `nextUrl.origin` comes from — cannot
 * turn this into an off-site `Location`.
 */
function safeNext(next: string | null, origin: string): string {
  if (!next) {
    return "/dashboard";
  }

  let url: URL;

  try {
    url = new URL(next, origin);
  } catch {
    return "/dashboard";
  }

  if (url.origin !== origin) {
    return "/dashboard";
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNext(searchParams.get("next"), request.nextUrl.origin);

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
