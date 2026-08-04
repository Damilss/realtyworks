import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * The privileged Supabase client. It carries the **secret key**, so it bypasses
 * RLS entirely and is the only client in this repo that does.
 *
 * It exists because two writes are deliberately unreachable from the Data API
 * (CLAUDE.md §2 — the client is never the source of truth):
 *
 * - `work_order_attachments` has **no client INSERT grant**. Attachment metadata
 *   is written only after the object is confirmed in Storage, so a client can
 *   never register a row with no file behind it
 *   (`20260717120700_create_work_order_attachments.sql`).
 * - `vendors.profile_id` has **no client write grant**, so the link between a
 *   contact row and an auth user cannot be forged or moved from the API
 *   (`20260717120400_create_vendors.sql`).
 *
 * Everything else keeps going through the caller's own session. Reach for this
 * client only for those two writes and for `auth.admin`, and re-check the
 * caller's access with the session client *first* — bypassing RLS is the whole
 * point of this file, which is exactly why it must never be the thing that
 * decides whether the caller was allowed.
 *
 * `import "server-only"` is correct here, unlike in `src/server/actions/`: no
 * client component ever imports this module, so the build should fail if one
 * tries.
 */

/** Supabase secret keys are prefixed `sb_secret_`; publishable ones are not. */
const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";

/**
 * Read at call time, never at module scope.
 *
 * The CI `verify` job runs `next build` with no Supabase stack and no secret in
 * the environment. A module-scope read would throw during the build the moment
 * any page's import graph reached this file, turning a missing *runtime* secret
 * into a broken *build*.
 */
function secretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!key) {
    throw new Error(
      "Missing required environment variable: SUPABASE_SECRET_KEY. " +
        "Copy .env.example to .env.local and fill it in — " +
        "`pnpm exec supabase status` prints the local value as SECRET_KEY.",
    );
  }

  // Fail closed on a swapped key. With a publishable key this client would
  // silently run every "privileged" write under RLS instead, and the metadata
  // insert would come back as an opaque 42501 that reads like a policy bug.
  if (key.startsWith(PUBLISHABLE_KEY_PREFIX)) {
    throw new Error(
      "SUPABASE_SECRET_KEY is set to a publishable key. It must be the secret " +
        "key (`sb_secret_...`), which is server-only and must never be exposed " +
        "to the browser or set on a NEXT_PUBLIC_* variable.",
    );
  }

  return key;
}

/**
 * A new privileged client per call. Never hoisted to module scope — see
 * `secretKey()` for why the environment is read this late.
 *
 * There is no session to persist and no token to refresh: this client acts as
 * `service_role`, not as a user. `auth.uid()` is therefore NULL for everything
 * it does, which is why the attachment insert has to pass `uploaded_by`
 * explicitly rather than leaning on a column default.
 */
export function createAdminClient() {
  const { url } = adminEnv();

  return createClient<Database>(url, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The API URL is shared with the browser client, so it is already validated and
 * public. Read it here rather than importing `supabaseEnv()` from `./env` —
 * that module is imported by the browser client, and nothing about the
 * privileged path should be able to drift into the client bundle.
 */
function adminEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!url) {
    throw new Error(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL.",
    );
  }

  return { url };
}
