import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * Supabase client for Client Components (browser).
 *
 * Carries only the publishable key and the user's own session, so every query
 * it makes is subject to RLS. Per CLAUDE.md §2, this client is never the
 * source of truth for security, money, or data integrity — those live in RLS,
 * server actions, or DB constraints.
 */
export function createClient() {
  const { url, publishableKey } = supabaseEnv();

  return createBrowserClient<Database>(url, publishableKey);
}
