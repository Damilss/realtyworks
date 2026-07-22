import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * Supabase client for Server Components, server actions, and route handlers.
 *
 * Always create a new client per request — never hoist one to module scope, or
 * one user's session leaks into another's request.
 *
 * This still uses the publishable key and the caller's session, so RLS applies
 * exactly as it does in the browser. It is not a privileged client.
 */
export async function createClient() {
  const { url, publishableKey } = supabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Safe to ignore: the proxy
          // (src/proxy.ts) refreshes the session and writes the cookies back
          // on every request, so the refreshed token is never lost.
        }
      },
    },
  });
}
