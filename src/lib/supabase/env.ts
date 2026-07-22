/**
 * Supabase connection config, read from the environment (CLAUDE.md §5 —
 * everything via env vars, no hardcoded URLs or keys).
 *
 * `process.env.NEXT_PUBLIC_*` is referenced as a literal member expression on
 * purpose: Next.js inlines those at build time by static analysis, so a
 * dynamic lookup (`process.env[name]`) would silently become `undefined` in
 * the browser bundle. Read the value literally, then validate it here.
 */

type MissingConfigHandler = (name: string) => never;

const throwPublicConfigError: MissingConfigHandler = () => {
  throw new Error("Application configuration is unavailable.");
};

function required(
  name: string,
  value: string | undefined,
  onMissing: MissingConfigHandler,
): string {
  if (!value) {
    return onMissing(name);
  }
  return value;
}

/**
 * Shared validation for build configuration and runtime client creation. The
 * default error is browser-safe; `next.config.ts` supplies detailed developer
 * remediation while loading so it stays out of the client bundle.
 */
export function supabaseEnv(
  onMissing: MissingConfigHandler = throwPublicConfigError,
) {
  return {
    url: required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      onMissing,
    ),
    publishableKey: required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      onMissing,
    ),
  };
}
