import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const mockedCreateServerClient = vi.mocked(createServerClient);
const mockedCookies = vi.mocked(cookies);

const cookiesToSet: Parameters<SetAllCookies>[0] = [
  { name: "auth.0", value: "chunk-0", options: { path: "/" } },
  { name: "auth.1", value: "chunk-1", options: { path: "/" } },
  { name: "auth.2", value: "chunk-2", options: { path: "/" } },
];

async function configuredSetAll(set: ReturnType<typeof vi.fn>) {
  mockedCookies.mockResolvedValue({
    getAll: vi.fn(() => []),
    set,
  } as unknown as Awaited<ReturnType<typeof cookies>>);

  await createClient();

  const call = mockedCreateServerClient.mock.calls[0];
  if (!call) {
    throw new Error("Expected createServerClient to be called.");
  }

  const cookieMethods = call[2].cookies;
  if (!("setAll" in cookieMethods) || !cookieMethods.setAll) {
    throw new Error("Expected the server client to configure setAll.");
  }

  return cookieMethods.setAll;
}

describe("Supabase server cookie writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project-ref.supabase.co");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_test_placeholder",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ignores only the expected Server Component read-only error", async () => {
    const set = vi.fn(() => {
      throw new Error(
        "Cookies can only be modified in a Server Action or Route Handler. Read more: https://nextjs.org/docs/app/api-reference/functions/cookies#options",
      );
    });
    const setAll = await configuredSetAll(set);

    expect(() => setAll(cookiesToSet, {})).not.toThrow();
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("rethrows unexpected write errors before attempting later chunks", async () => {
    const writeError = new Error("Cookie value exceeds the allowed size.");
    const set = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw writeError;
      });
    const setAll = await configuredSetAll(set);

    expect(() => setAll(cookiesToSet, {})).toThrow(writeError);
    expect(set).toHaveBeenCalledTimes(2);
  });
});
