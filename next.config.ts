import type { NextConfig } from "next";

import { supabaseEnv } from "./src/lib/supabase/env";

// NEXT_PUBLIC_* values are frozen into the browser bundle by `next build`.
// Validate them while the config loads so an unusable bundle is never emitted.
supabaseEnv((name) => {
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
