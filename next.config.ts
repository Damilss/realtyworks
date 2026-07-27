import type { NextConfig } from "next";

import { supabaseEnv } from "./src/lib/supabase/env";

// NEXT_PUBLIC_* values are frozen into the browser bundle by `next build`.
// Validate them while the config loads so an unusable bundle is never emitted.
// These detailed messages live here, not in env.ts, so they stay out of the
// client bundle (env.ts is imported by the browser client).
supabaseEnv((name, problem) => {
  if (problem === "not-publishable") {
    throw new Error(
      `Invalid ${name}: expected a Supabase publishable key ` +
        `(\`sb_publishable_...\`). A secret or service_role key must never be ` +
        `set on a NEXT_PUBLIC_* variable — \`next build\` inlines it into the ` +
        `browser bundle, exposing it to every client and bypassing RLS.`,
    );
  }
  throw new Error(
    `Missing required environment variable: ${name}. ` +
      `Copy .env.example to .env.local and fill it in — ` +
      `\`pnpm exec supabase status\` prints the local values.`,
  );
});

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
