import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { supabaseEnv } from "@/lib/supabase/env";

const READONLY_COOKIE_STORE_ERROR =
  "Cookies can only be modified in a Server Action or Route Handler.";

function isReadonlyCookieStoreError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.startsWith(READONLY_COOKIE_STORE_ERROR)
  );
}

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
        for (const { name, value, options } of cookiesToSet) {
          try {
            cookieStore.set(name, value, options);
          } catch (error) {
            if (isReadonlyCookieStoreError(error)) {
              // Server Components cannot set any cookies. The proxy refreshes
              // the session and writes the complete batch on every request.
              return;
            }

            // Surface the failure instead of silently accepting a partial
            // auth-cookie batch.
            throw error;
          }
        }
      },
    },
  });
}
