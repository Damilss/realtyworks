/**
 * Supabase connection config, read from the environment (CLAUDE.md §5 —
 * everything via env vars, no hardcoded URLs or keys).
 *
 * `process.env.NEXT_PUBLIC_*` is referenced as a literal member expression on
 * purpose: Next.js inlines those at build time by static analysis, so a
 * dynamic lookup (`process.env[name]`) would silently become `undefined` in
 * the browser bundle. Read the value literally, then validate it here.
 */

/**
 * Why a config value is unusable. Kept to a small discriminator — never the
 * detailed remediation text — because this module is imported by the browser
 * client, so anything here ships in the bundle. `next.config.ts` maps each
 * problem to a developer-facing message while it stays out of the client.
 */
export type ConfigProblem = "missing" | "not-publishable";

type ConfigErrorHandler = (name: string, problem: ConfigProblem) => never;

const throwPublicConfigError: ConfigErrorHandler = () => {
  throw new Error("Application configuration is unavailable.");
};

function required(
  name: string,
  value: string | undefined,
  onError: ConfigErrorHandler,
): string {
  if (!value) {
    return onError(name, "missing");
  }
  return value;
}

/**
 * A Supabase publishable key is prefixed `sb_publishable_`. Its privileged
 * counterparts — the `sb_secret_` key and legacy `service_role` JWT — are NOT,
 * and must never reach the browser. Because NEXT_PUBLIC_* is frozen into the
 * client bundle by `next build`, a secret key mistakenly set here would ship to
 * every browser and bypass RLS (CLAUDE.md §2). Fail closed: accept only a value
 * that is specifically a publishable key, rather than merely a non-empty one.
 */
const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";

function requirePublishableKey(
  name: string,
  value: string | undefined,
  onError: ConfigErrorHandler,
): string {
  const key = required(name, value, onError);
  if (!key.startsWith(PUBLISHABLE_KEY_PREFIX)) {
    return onError(name, "not-publishable");
  }
  return key;
}

/**
 * Shared validation for build configuration and runtime client creation. The
 * default error is browser-safe; `next.config.ts` supplies detailed developer
 * remediation while loading so it stays out of the client bundle.
 */
export function supabaseEnv(
  onError: ConfigErrorHandler = throwPublicConfigError,
) {
  return {
    url: required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      onError,
    ),
    publishableKey: requirePublishableKey(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      onError,
    ),
  };
}
