import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Runs before every matched request to keep the Supabase session fresh.
 *
 * Next.js 16 renamed the root `middleware` file convention to `proxy`; only
 * one such file is supported per project, so the actual logic lives in
 * `src/lib/supabase/proxy.ts` and is aggregated here.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except the ones that never carry a session worth refreshing:
     * - _next/static, _next/image — build output
     * - robots.txt, sitemap.xml — public metadata
     * - manifest.webmanifest, sw.js — PWA entry points
     * - image and font files
     * Extend this list rather than adding early returns in the proxy.
     */
    "/((?!_next/static|_next/image|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$|sw\\.js$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf|eot)$).*)",
  ],
};
