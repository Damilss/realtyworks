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

  // A secret / service_role key set on the publishable NEXT_PUBLIC_* variable
  // would be inlined into the browser bundle and bypass RLS. Reject anything
  // that is not specifically a publishable key.
  it.each([
    ["a secret key", "sb_secret_deadbeef"],
    ["a legacy service_role JWT", "eyJhbGciOiJIUzI1NiJ9.payload.sig"],
    ["an unrecognized value", "publishable-key"],
  ])("rejects %s in the publishable key slot", (_label, value) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", value);

    const onError = vi.fn<(name: string, problem: string) => never>(() => {
      throw new Error("stopped");
    });

    expect(() => supabaseEnv(onError)).toThrow("stopped");
    expect(onError).toHaveBeenCalledWith(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "not-publishable",
    );
  });

  it("uses a browser-safe error when the publishable key is the wrong type", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_secret_deadbeef");

    let thrown: unknown;

    try {
      supabaseEnv();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    // The generic message must not leak that a secret key was detected.
    expect((thrown as Error).message).toBe(
      "Application configuration is unavailable.",
    );
    expect((thrown as Error).message).not.toMatch(/secret|sb_|publishable/i);
  });
});
