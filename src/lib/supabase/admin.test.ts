import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The privileged client is the one place in the app that bypasses RLS, so what
 * is worth testing is not that it can query — it is that it refuses to exist in
 * the two configurations that would be dangerous or misleading, and that merely
 * importing it never reads the environment.
 */

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const SECRET_KEY = "SUPABASE_SECRET_KEY";

const originalUrl = process.env[URL_KEY];
const originalSecret = process.env[SECRET_KEY];

beforeEach(() => {
  process.env[URL_KEY] = "http://127.0.0.1:54321";
  process.env[SECRET_KEY] = "sb_secret_test-value";
});

afterEach(() => {
  // Restore rather than delete: vitest shares one process across files in a
  // suite, and another test reading a blanked variable would fail for a reason
  // that has nothing to do with it.
  if (originalUrl === undefined) {
    delete process.env[URL_KEY];
  } else {
    process.env[URL_KEY] = originalUrl;
  }

  if (originalSecret === undefined) {
    delete process.env[SECRET_KEY];
  } else {
    process.env[SECRET_KEY] = originalSecret;
  }
});

describe("createAdminClient", () => {
  it("builds a client when the secret key is present", () => {
    expect(() => createAdminClient()).not.toThrow();
  });

  it("throws when the secret key is missing", () => {
    delete process.env[SECRET_KEY];

    expect(() => createAdminClient()).toThrow(/SUPABASE_SECRET_KEY/);
  });

  /**
   * The failure this prevents is a quiet one. With a publishable key the client
   * still constructs and still makes requests — they just run under RLS as an
   * anonymous caller, so the attachment metadata insert (which has no client
   * grant at all) comes back as a bare 42501 that reads like a broken policy
   * rather than like misconfiguration.
   */
  it("refuses a publishable key set in the secret's place", () => {
    process.env[SECRET_KEY] = "sb_publishable_not-a-secret";

    expect(() => createAdminClient()).toThrow(/publishable/i);
  });

  it("throws when the API URL is missing", () => {
    delete process.env[URL_KEY];

    expect(() => createAdminClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  /**
   * The reason the environment is read inside the factory rather than at module
   * scope: the CI `verify` job runs `next build` with no Supabase stack and no
   * secret, and a module-scope read would fail that build the moment any page's
   * import graph reached this file. Importing must stay free of side effects,
   * which is exactly what this asserts.
   */
  it("does not read the environment until it is called", async () => {
    delete process.env[SECRET_KEY];
    delete process.env[URL_KEY];
    vi.resetModules();

    await expect(import("@/lib/supabase/admin")).resolves.toBeDefined();
  });
});
