import { supabaseEnv } from "@/lib/supabase/env";

describe("supabaseEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a browser-safe error when public configuration is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_test_placeholder",
    );

    let thrown: unknown;

    try {
      supabaseEnv();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      "Application configuration is unavailable.",
    );
    expect((thrown as Error).message).not.toMatch(/\.env\.local|pnpm/);
  });
});
