import { supabaseEnv } from "@/lib/supabase/env";

describe("supabaseEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the configured url and publishable key when both are set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_test_placeholder",
    );

    // Pins the happy-path contract: the real env values are returned, not the
    // variable names. The throw tests below (and next-config.test.ts) cover the
    // empty-string-is-missing branch for both fields; this covers the other
    // direction so a refactor of required() can't silently return the wrong data.
    expect(supabaseEnv()).toEqual({
      url: "http://127.0.0.1:54321",
      publishableKey: "sb_publishable_test_placeholder",
    });
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
