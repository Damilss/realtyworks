import type { NextConfig } from "next";

import { supabaseEnv } from "./src/lib/supabase/env";

// NEXT_PUBLIC_* values are frozen into the browser bundle by `next build`.
// Validate them while the config loads so an unusable bundle is never emitted.
supabaseEnv();

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
