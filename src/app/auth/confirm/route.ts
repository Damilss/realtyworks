import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Redeems an emailed token and starts a session.
 *
 * Three flows land here. It is the vendor's whole login — staff mint a link with
 * `inviteVendor`, the vendor taps it, and arrives with a one-time `token_hash`
 * — and since 2026-08-25 it is also where a self-registration confirms its
 * email address (`supabase/templates/confirmation.html`, issue #93). Password
 * recovery uses the same exchange and then enters authenticated account setup.
 *
 * Exchanging a token for a session is a cookie write, which a Server Component
 * cannot do — hence a route handler. `createClient()` from
 * `@/lib/supabase/server` is the right client and needs no variant: its
 * readonly-cookie guard only swallows the Server Component case, so here
 * `cookieStore.set()` genuinely writes.
 *
 * The tokens are single-use — a replayed `token_hash` comes back as "Email link
 * is invalid or has expired" — and expire after `[auth.email] otp_expiry`
 * (3600s) in supabase/config.toml.
 */

/**
 * The link types this endpoint will redeem. `type` arrives in the query string,
 * so it is caller-controlled; passing it straight through would let someone
 * redeem an `email_change` token at an endpoint that was never reviewed for it.
 *
 * `signup` joined the list when email confirmations went on, and `recovery`
 * joined when verified account setup moved behind this endpoint. `email_change`
 * is still refused because that flow has different two-address confirmation
 * semantics.
 *
 * **`ACCOUNT_SETUP_TYPES` is a default destination, not an enforced one.** It
 * reads the caller's own query string, and GoTrue does not bind a token to the
 * type used to redeem it — it looks the hash up in the column that type implies,
 * and several types share a column. Verified against the running stack
 * (2026-09-01), redeeming each token under a *different* type:
 *
 *   recovery token + `type=magiclink`  → accepted, session minted
 *   signup token   + `type=invite`     → accepted, session minted
 *   signup token   + `type=magiclink`  → refused (`otp_expired`)
 *
 * So the pairs that collide are the ones sharing storage — `recovery`/`magiclink`
 * in `recovery_token`, `signup`/`invite` in `confirmation_token` — and each
 * account-setup type has a non-setup partner. Whoever holds the link can edit
 * `type` and land on `next` instead of `/account-setup`.
 *
 * That is a bypassable *guardrail*, and deliberately not relied on as a gate.
 * Rewriting `type` cannot change which user the token belongs to, so it grants
 * no session the holder could not already mint; `next` stays bounded by
 * `safeNext` below; and nothing downstream treats "went through /account-setup"
 * as authorization — `completeAccountSetup()` re-resolves the caller through
 * `getVerifiedCaller()` and writes through RLS.
 *
 * What it does cost is the *guarantee*, and one consequence is filed in
 * docs/backlog.md: a self-registration that skips setup keeps the unknown
 * random password `signUp()` generated, so it is locked out once the session
 * expires. Do not add a check here that reads `type` and calls it enforcement —
 * for `recovery` there is nothing to enforce with, because a recovery token and
 * a magic link are the same bytes in the same column.
 */
const ALLOWED_TYPES = new Set(["magiclink", "invite", "signup", "recovery"]);
const ACCOUNT_SETUP_TYPES = new Set(["signup", "recovery"]);

/**
 * Resolves `value` against `origin` and returns it as a bare path, or null if it
 * does not land on this origin.
 */
function sameOriginPath(value: string, origin: string): string | null {
  let url: URL;

  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }

  if (url.origin !== origin) {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

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
 * the first version of this guard tried: it rejected `//evil.example` but
 * admitted `/\evil.example`, because `\` is only equivalent to `/` once the
 * WHATWG URL parser reads it in the authority position. Tabs and newlines are
 * worse still — the parser strips them, so `/%09/evil.example` becomes
 * `//evil.example` *after* any string check has already approved them. Matching
 * a value that something downstream will reinterpret loses that argument
 * eventually; parsing it first does not.
 *
 * One parse is not enough either, because the *output* gets reinterpreted too.
 * `${origin}//evil.example` is same-origin by every measure the parser reports —
 * the host is `evil.example` only in the **pathname** — so reducing it to a bare
 * path emits `//evil.example`, and that is protocol-relative the moment the
 * browser reads the `Location`. The same holds for any run of leading slashes,
 * and for the backslashes the parser folds into them.
 *
 * Hence the round trip: the value we emit has to survive being parsed *again*
 * as itself. A real destination is already a fixed point of that reduction —
 * the first parse normalized it — so this rejects exactly the values that mean
 * one thing to us and another to the browser, rather than a list of the
 * spellings we happened to think of.
 *
 * The return value is deliberately a bare path. Emitting no host means even a
 * spoofed `Host` header — which is where `nextUrl.origin` comes from — cannot
 * turn this into an off-site `Location`.
 */
function safeNext(next: string | null, origin: string): string {
  if (!next) {
    return "/dashboard";
  }

  const path = sameOriginPath(next, origin);

  if (path === null || sameOriginPath(path, origin) !== path) {
    return "/dashboard";
  }

  return path;
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

  if (ACCOUNT_SETUP_TYPES.has(type)) {
    redirect("/account-setup");
  }

  // Outside any try/catch: redirect() signals by throwing NEXT_REDIRECT.
  redirect(next);
}
