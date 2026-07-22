import { stringToBase64URL } from "@supabase/ssr";
import { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

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
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("clears corrupted auth cookies and continues unauthenticated", async () => {
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
});
