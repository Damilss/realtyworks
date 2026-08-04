import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  getCurrentProfile,
  getSession,
  isStaff,
  requireSession,
} from "@/server/queries/session";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));
// React's cache() memoizes per render pass; outside one it would hold results
// across tests. Identity is the correct stand-in here — these tests are about
// what the helpers return, not about how often they call the database.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));

const mockedCreateClient = vi.mocked(createClient);

type ProfileRow = {
  id: string;
  role: string;
  full_name: string | null;
  phone: string | null;
};

function stubSupabase({
  claims,
  claimsError,
  profile,
  profileError,
  vendorId,
}: {
  claims?: Record<string, unknown> | null;
  claimsError?: { message: string } | null;
  profile?: ProfileRow | null;
  profileError?: { message: string } | null;
  vendorId?: string | null;
} = {}) {
  const client = {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: claims === undefined ? null : claims ? { claims } : null,
        error: claimsError ?? null,
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: profile ?? null,
            error: profileError ?? null,
          }),
        })),
      })),
    })),
    rpc: vi.fn().mockResolvedValue({ data: vendorId ?? null, error: null }),
  };

  mockedCreateClient.mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );

  return client;
}

const CLAIMS = {
  sub: "00000000-0000-0000-0000-000000000002",
  email: "manager@realtyworks.test",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getSession", () => {
  it("returns the user id and email from the verified claims", async () => {
    stubSupabase({ claims: CLAIMS });

    await expect(getSession()).resolves.toEqual({
      userId: CLAIMS.sub,
      email: CLAIMS.email,
    });
  });

  it("returns null when there are no claims", async () => {
    stubSupabase({ claims: null });

    await expect(getSession()).resolves.toBeNull();
  });

  it("treats a claims error as unauthenticated rather than throwing", async () => {
    stubSupabase({ claimsError: { message: "auth unreachable" } });

    await expect(getSession()).resolves.toBeNull();
  });
});

describe("requireSession", () => {
  it("redirects to login when there is no session", async () => {
    stubSupabase({ claims: null });

    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("returns the session when there is one", async () => {
    stubSupabase({ claims: CLAIMS });

    await expect(requireSession()).resolves.toMatchObject({
      userId: CLAIMS.sub,
    });
  });
});

describe("getCurrentProfile", () => {
  it("returns the profile with its vendor link", async () => {
    stubSupabase({
      claims: CLAIMS,
      profile: {
        id: CLAIMS.sub,
        role: "vendor",
        full_name: "Bob Vendor",
        phone: "+15551230003",
      },
      vendorId: "30000000-0000-0000-0000-000000000001",
    });

    await expect(getCurrentProfile()).resolves.toEqual({
      id: CLAIMS.sub,
      role: "vendor",
      fullName: "Bob Vendor",
      phone: "+15551230003",
      vendorId: "30000000-0000-0000-0000-000000000001",
    });
  });

  it("reports an unlinked self-registration as vendorId null", async () => {
    stubSupabase({
      claims: CLAIMS,
      profile: {
        id: CLAIMS.sub,
        role: "vendor",
        full_name: "New",
        phone: null,
      },
      vendorId: null,
    });

    await expect(getCurrentProfile()).resolves.toMatchObject({
      role: "vendor",
      vendorId: null,
    });
  });

  it("returns null instead of redirecting when the profile row is missing", async () => {
    // The cookie is still valid, so redirecting to /login would bounce straight
    // back here and loop until the session expires.
    stubSupabase({ claims: CLAIMS, profile: null });

    await expect(getCurrentProfile()).resolves.toBeNull();
    expect(redirect).not.toHaveBeenCalledWith("/login");
  });

  it("returns null when the profile query errors", async () => {
    stubSupabase({ claims: CLAIMS, profileError: { message: "boom" } });

    await expect(getCurrentProfile()).resolves.toBeNull();
  });

  it("still redirects when there is no session at all", async () => {
    stubSupabase({ claims: null });

    await expect(getCurrentProfile()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("isStaff", () => {
  const base = { id: "x", fullName: null, phone: null, vendorId: null };

  it("accepts landlord and manager, rejects vendor", () => {
    expect(isStaff({ ...base, role: "landlord" })).toBe(true);
    expect(isStaff({ ...base, role: "manager" })).toBe(true);
    expect(isStaff({ ...base, role: "vendor" })).toBe(false);
  });
});
