import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  // The real redirect() signals by throwing NEXT_REDIRECT. Throwing here too
  // keeps the control flow honest, exactly as in src/server/actions/auth.test.ts:
  // a test only reaches the line after a redirect if the handler genuinely did
  // not redirect.
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

const mockedCreateClient = vi.mocked(createClient);
const mockedRedirect = vi.mocked(redirect);

const ORIGIN = "http://127.0.0.1:3000";
const TOKEN = "pretend-hashed-token";
const INVALID_LINK = "/login?error=invalid-link";

function stubSupabase(result: { error: unknown } = { error: null }) {
  const verifyOtp = vi.fn().mockResolvedValue(result);

  mockedCreateClient.mockResolvedValue({
    auth: { verifyOtp },
  } as unknown as Awaited<ReturnType<typeof createClient>>);

  return verifyOtp;
}

/**
 * The handler reads `request.nextUrl` and nothing else, so a URL *is* the whole
 * request here. Constructing a real NextRequest would pull `next/server` into a
 * happy-dom environment to supply two properties a URL already has.
 */
function request(search: Record<string, string>): NextRequest {
  const url = new URL("/auth/confirm", ORIGIN);

  for (const [key, value] of Object.entries(search)) {
    url.searchParams.set(key, value);
  }

  return { nextUrl: url } as unknown as NextRequest;
}

/** Runs the handler and reports where it sent the browser. */
async function redeem(search: Record<string, string>): Promise<string> {
  await expect(GET(request(search))).rejects.toThrow(/^NEXT_REDIRECT:/);

  const call = mockedRedirect.mock.calls.at(-1);

  if (!call) {
    throw new Error("Expected the handler to redirect.");
  }

  return call[0];
}

/** A valid redemption whose only variable is the destination. */
function magicLink(next?: string): Record<string, string> {
  return {
    token_hash: TOKEN,
    type: "magiclink",
    ...(next === undefined ? {} : { next }),
  };
}

/**
 * Destinations that must never survive the guard.
 *
 * Mirrored — deliberately — by the table in `tests/e2e/vendor-loop.spec.ts`,
 * which redeems every one of these against a real single-use token. Keep the two
 * in step; this layer proves the logic, that one proves the line is reached.
 *
 * Written **decoded**, because `URLSearchParams` does the encoding: the second
 * entry below serializes to `next=%2F%5Cevil.example`, the exact reported
 * payload, with no chance of hand-encoding it into something the handler would
 * never see.
 */
const OFF_SITE_NEXT = [
  ["a protocol-relative URL", "//evil.example/"],
  ["a backslash in the authority position", "/\\evil.example"],
  ["a backslash ahead of a slash", "/\\/evil.example"],
  ["an embedded tab, which the URL parser strips", "/\t/evil.example"],
  ["an embedded carriage return", "/\r/evil.example"],
  ["an absolute URL on another origin", "https://evil.example/"],
  // The last two are same-origin by every measure the parser reports: the host
  // sits in the *pathname*, so the guard only catches them by re-reading what
  // it is about to emit.
  [
    "our own origin with the host smuggled into its path",
    `${ORIGIN}//evil.example`,
  ],
  [
    "our own origin with a backslash smuggled into its path",
    `${ORIGIN}/\\/evil.example`,
  ],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the post-confirmation redirect", () => {
  it.each(OFF_SITE_NEXT)("refuses %s", async (_label, next) => {
    const verifyOtp = stubSupabase();

    const target = await redeem(magicLink(next));

    // The verification has to have happened for this assertion to mean
    // anything: the guard runs *after* the session is minted, so a case that
    // failed verification would land on /login and prove nothing about `next`.
    // This is what the previous e2e spec got wrong (docs/backlog.md).
    expect(verifyOtp).toHaveBeenCalledOnce();
    expect(target).toBe("/dashboard");
  });

  it("never emits a host, for any destination it accepts or refuses", async () => {
    const destinations = [
      ...OFF_SITE_NEXT.map(([, next]) => next),
      "/dashboard",
      "/work-orders/40000000-0000-0000-0000-000000000001",
      `${ORIGIN}/vendors`,
    ];

    for (const next of destinations) {
      stubSupabase();

      const target = await redeem(magicLink(next));

      // A bare path is the whole guarantee: with no authority in the Location,
      // a spoofed Host header cannot make this leave the site either.
      expect(target.startsWith("/")).toBe(true);
      expect(target.startsWith("//")).toBe(false);
    }
  });

  it("sends a link with no destination to the dashboard", async () => {
    stubSupabase();

    expect(await redeem(magicLink())).toBe("/dashboard");
  });

  it("keeps a same-origin path, with its query and fragment intact", async () => {
    stubSupabase();

    // Deep-linking the assigned job is the entire point of the invite
    // (docs/vendor-access.md §3b), so the guard has to leave a real one alone.
    const next =
      "/work-orders/40000000-0000-0000-0000-000000000001?tab=trail#note";

    expect(await redeem(magicLink(next))).toBe(next);
  });

  it("reduces an absolute URL on our own origin to its path", async () => {
    stubSupabase();

    expect(await redeem(magicLink(`${ORIGIN}/vendors?q=roof`))).toBe(
      "/vendors?q=roof",
    );
  });

  it("falls back when the destination cannot be parsed at all", async () => {
    stubSupabase();

    // `new URL("http://", origin)` throws rather than resolving — the base is
    // ignored once the input carries its own scheme.
    expect(await redeem(magicLink("http://"))).toBe("/dashboard");
  });
});

describe("redemption", () => {
  it("never reads the destination when verification fails", async () => {
    const verifyOtp = stubSupabase({
      error: { code: "otp_expired", status: 403 },
    });

    const target = await redeem(magicLink("/work-orders/some-id"));

    expect(verifyOtp).toHaveBeenCalledOnce();
    expect(target).toBe(INVALID_LINK);
  });

  it("refuses a link type this endpoint was never reviewed for", async () => {
    const verifyOtp = stubSupabase();

    const target = await redeem({ token_hash: TOKEN, type: "recovery" });

    expect(target).toBe(INVALID_LINK);
    expect(mockedCreateClient).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("refuses a request carrying no token", async () => {
    const verifyOtp = stubSupabase();

    const target = await redeem({ type: "magiclink" });

    expect(target).toBe(INVALID_LINK);
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
