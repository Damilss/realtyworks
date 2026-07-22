import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import { supabaseEnv } from "@/lib/supabase/env";

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

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }

        // Responses that set auth cookies must never be cached by a CDN or
        // reverse proxy, or one user's session token gets served to another.
        // The library supplies the required no-store headers.
        for (const [key, headerValue] of Object.entries(headers)) {
          response.headers.set(key, headerValue);
        }
      },
    },
  });

  // Must run immediately after the client is created, with nothing in between:
  // this is the call that triggers the refresh, and it has to complete before
  // the response is committed or the rotated cookies are lost.
  await supabase.auth.getClaims();

  return response;
}
