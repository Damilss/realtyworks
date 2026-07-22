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
});
