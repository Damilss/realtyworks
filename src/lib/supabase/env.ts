/**
 * Supabase connection config, read from the environment (CLAUDE.md §5 —
 * everything via env vars, no hardcoded URLs or keys).
 *
 * `process.env.NEXT_PUBLIC_*` is referenced as a literal member expression on
 * purpose: Next.js inlines those at build time by static analysis, so a
 * dynamic lookup (`process.env[name]`) would silently become `undefined` in
 * the browser bundle. Read the value literally, then validate it here.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env.local and fill it in — ` +
        `\`pnpm exec supabase status\` prints the local values.`,
    );
  }
  return value;
}

/**
 * Shared validation for build configuration and runtime client creation.
 * `next.config.ts` calls this while loading so missing public values fail the
 * build before Next.js freezes them into the browser bundle.
 */
export function supabaseEnv() {
  return {
    url: required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    publishableKey: required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  };
}
