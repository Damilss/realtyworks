import {
  clearAuthCookiesAtScopes,
  createServerClient,
  type SetAllCookies,
} from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import { supabaseEnv } from "@/lib/supabase/env";

function authStorageKey(url: string) {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

/**
 * Refreshes the Supabase auth session on every request and writes the rotated
 * cookies back onto the response.
 *
 * Server Components cannot set cookies, so without this the refreshed token
 * would be dropped and users would be logged out at random once the access
 * token expired.
 *
 * Called from `src/proxy.ts` — in Next.js 16 the root `middleware` file
 * convention is deprecated and renamed to `proxy`
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 *
 * Session refresh only. Route protection is deliberately not here: per the
 * Next.js proxy guide it is for optimistic checks, not authorization, and RLS
 * plus server-side checks remain the trust boundary (CLAUDE.md §2).
 */
export async function updateSession(request: NextRequest) {
  const { url, publishableKey } = supabaseEnv();
  const storageKey = authStorageKey(url);

  let response = NextResponse.next({ request });

  const getAll = () => request.cookies.getAll();
  const setAll: SetAllCookies = (cookiesToSet, headers) => {
    for (const { name, value } of cookiesToSet) {
      request.cookies.set(name, value);
    }

    // Recreating the response (rather than mutating the outer one) is the
    // @supabase/ssr pattern: it re-snapshots `request` now that the rotated
    // cookies are applied above. The trade-off is that nothing set on the prior
    // response survives — so any custom header (request-id, CSP nonce) must be
    // applied to the returned response *after* the refresh call, never before.
    response = NextResponse.next({ request });

    for (const { name, value, options } of cookiesToSet) {
      response.cookies.set(name, value, options);
    }

    // Responses that set auth cookies must never be cached by a CDN or
    // reverse proxy, or one user's session token gets served to another.
    // Keep a fallback for helpers that do not supply their own headers.
    response.headers.set("Cache-Control", "private, no-store");

    for (const [key, headerValue] of Object.entries(headers)) {
      response.headers.set(key, headerValue);
    }
  };

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll,
      setAll,
    },
  });

  // Drops every current-session cookie chunk so the request proceeds signed out
  // and the browser can recover, instead of replaying a session the server rejects.
  const clearSession = () =>
    clearAuthCookiesAtScopes({ getAll, setAll, storageKey, scopes: [{}] });

  // Must run immediately after the client is created, with nothing in between:
  // this is the call that triggers the refresh, and it has to complete before
  // the response is committed or the rotated cookies are lost.
  try {
    const { error } = await supabase.auth.getClaims();

    if (error) {
      // getClaims() reports auth failures by *returning* them, not throwing
      // (only malformed session data throws — see the catch below). Two kinds
      // of returned error land here and must be treated differently:
      //
      //   - AuthRetryableFetchError: Auth was unreachable (an outage), so the
      //     stored session is probably still valid. Keep the cookies and let the
      //     next request retry — clearing here would sign users out on a blip.
      //   - Anything else (invalid/expired JWT, bad signature, revoked or missing
      //     refresh token): the session is unusable. Clear it, or the browser
      //     keeps presenting a session every server check rejects, looping until
      //     the cookie expires.
      //
      // Either way we log: unhandled, the failure just degrades the request to
      // unauthenticated and users appear randomly logged out with nothing to
      // explain it (CLAUDE.md §5 audit trail; Sentry captures it once Phase 4
      // wires it).
      console.error("[proxy] Supabase session refresh failed", error);

      if (!isAuthRetryableFetchError(error)) {
        await clearSession();
      }
    }
  } catch {
    // auth-js returns AuthErrors, but malformed session data can throw a native
    // parsing error (e.g. JSON.parse on a corrupt cookie) instead. Same recovery.
    await clearSession();
  }

  return response;
}
