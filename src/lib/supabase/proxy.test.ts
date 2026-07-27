import { createServerClient, stringToBase64URL } from "@supabase/ssr";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

// Wrap the real @supabase/ssr module: createServerClient defaults to the genuine
// implementation (so most tests exercise auth-js for real) but can be replaced
// per-test to inject an error auth-js would only produce via a live network call.
vi.mock("@supabase/ssr", async (importActual) => {
  const actual = await importActual<typeof import("@supabase/ssr")>();
  return { ...actual, createServerClient: vi.fn(actual.createServerClient) };
});

const SUPABASE_URL = "https://project-ref.supabase.co";
const STORAGE_KEY = "sb-project-ref-auth-token";

function encodedSession(accessToken: string) {
  return `base64-${stringToBase64URL(
    JSON.stringify({
      access_token: accessToken,
      refresh_token: "refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }),
  )}`;
}

describe("updateSession", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_test_placeholder",
    );
    // The clearing/outage paths log the underlying auth error; keep output clean.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    consoleErrorSpy.mockRestore();
    // Clear call history but keep the real createServerClient implementation the
    // module mock wraps — restoreAllMocks would strip it and break the next test.
    vi.mocked(createServerClient).mockClear();
  });

  it("clears corrupted auth cookies that throw a native parse error", async () => {
    // The header decodes to a non-JSON string, so JSON.parse throws a SyntaxError
    // (not an AuthError) — getClaims re-throws it and the catch clears the session.
    const malformedJwt = `${stringToBase64URL("not-json")}.e30.c2ln`;
    const request = new NextRequest("https://example.com/login");
    request.cookies.set(STORAGE_KEY, encodedSession(malformedJwt));
    request.cookies.set(`${STORAGE_KEY}.1`, "stale-chunk");

    expect(request.cookies.getAll().map(({ name }) => name)).toEqual([
      STORAGE_KEY,
      `${STORAGE_KEY}.1`,
    ]);

    const response = await updateSession(request);

    expect(response.status).toBe(200);
    expect(request.cookies.get(STORAGE_KEY)?.value).toBe("");
    expect(request.cookies.get(`${STORAGE_KEY}.1`)?.value).toBe("");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.cookies.getAll()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: STORAGE_KEY, value: "", maxAge: 0 }),
        expect.objectContaining({
          name: `${STORAGE_KEY}.1`,
          value: "",
          maxAge: 0,
        }),
      ]),
    );
  });

  it("clears a structurally invalid JWT returned as a non-retryable error", async () => {
    // A JWT with no dots is structurally invalid: getClaims *returns* an
    // AuthInvalidJwtError (never throws), so the catch above never fires. This is
    // the returned-error path that must still clear the unusable session.
    const request = new NextRequest("https://example.com/login");
    request.cookies.set(STORAGE_KEY, encodedSession("not-a-jwt"));
    request.cookies.set(`${STORAGE_KEY}.1`, "stale-chunk");

    const response = await updateSession(request);

    expect(response.status).toBe(200);
    expect(request.cookies.get(STORAGE_KEY)?.value).toBe("");
    expect(request.cookies.get(`${STORAGE_KEY}.1`)?.value).toBe("");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.cookies.getAll()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: STORAGE_KEY, value: "", maxAge: 0 }),
        expect.objectContaining({
          name: `${STORAGE_KEY}.1`,
          value: "",
          maxAge: 0,
        }),
      ]),
    );
  });

  it("preserves cookies on a retryable auth outage", async () => {
    // AuthRetryableFetchError means Auth was unreachable, not that the session is
    // bad — the token is probably still valid, so the cookies must survive for the
    // next request to retry. Clearing here would sign users out on a transient blip.
    const sessionCookie = encodedSession("a.b.c");
    vi.mocked(createServerClient).mockReturnValueOnce({
      auth: {
        getClaims: async () => ({
          data: null,
          error: new AuthRetryableFetchError("fetch failed", 0),
        }),
      },
      // Only auth.getClaims is exercised by updateSession on this path.
    } as unknown as ReturnType<typeof createServerClient>);

    const request = new NextRequest("https://example.com/dashboard");
    request.cookies.set(STORAGE_KEY, sessionCookie);

    const response = await updateSession(request);

    expect(response.status).toBe(200);
    // Cookie is untouched — not cleared to "".
    expect(request.cookies.get(STORAGE_KEY)?.value).toBe(sessionCookie);
    expect(
      response.cookies.getAll().some(({ name }) => name === STORAGE_KEY),
    ).toBe(false);
    // The outage is still logged for the audit trail.
    expect(console.error).toHaveBeenCalledWith(
      "[proxy] Supabase session refresh failed",
      expect.any(AuthRetryableFetchError),
    );
  });
});
