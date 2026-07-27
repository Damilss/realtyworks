const REQUIRED_SUPABASE_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

describe("Next.js build configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(REQUIRED_SUPABASE_ENV)(
    "fails config loading when %s is missing",
    async (missingName) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
      vi.stubEnv(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "sb_publishable_test_placeholder",
      );
      vi.stubEnv(missingName, "");
      vi.resetModules();

      await expect(import("../../next.config")).rejects.toThrow(
        `Missing required environment variable: ${missingName}`,
      );
    },
  );

  // A secret / service_role key on the publishable NEXT_PUBLIC_* variable would
  // be inlined into the browser bundle by `next build`. Config loading must fail
  // so the leaking bundle is never emitted.
  it.each([
    ["a secret key", "sb_secret_deadbeef"],
    ["a service_role JWT", "eyJhbGciOiJIUzI1NiJ9.payload.sig"],
  ])(
    "fails config loading when the publishable key is %s",
    async (_label, value) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", value);
      vi.resetModules();

      await expect(import("../../next.config")).rejects.toThrow(
        "expected a Supabase publishable key",
      );
    },
  );
});
