import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createVendor, inviteVendor } from "@/server/actions/vendors";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "127.0.0.1:3000" })),
}));

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);

// Real ids from supabase/seed.sql. Invented v4-shaped ones are the wrong
// fixture here — see the note in src/schemas/work-order.test.ts.
const VENDOR_ID = "30000000-0000-0000-0000-000000000001";
const WORK_ORDER_ID = "40000000-0000-0000-0000-000000000003";
const VENDOR_PROFILE_ID = "00000000-0000-0000-0000-000000000003";
const MANAGER_PROFILE_ID = "00000000-0000-0000-0000-000000000002";

type QueryResult = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
};

/** Chainable and thenable, like PostgREST's builder. */
function query(result: QueryResult) {
  const calls = { insert: vi.fn(), update: vi.fn(), select: vi.fn() };

  const stub = {
    select: (...args: unknown[]) => {
      calls.select(...args);
      return stub;
    },
    eq: () => stub,
    insert: (...args: unknown[]) => {
      calls.insert(...args);
      return stub;
    },
    update: (...args: unknown[]) => {
      calls.update(...args);
      return stub;
    },
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (onFulfilled: (value: QueryResult) => unknown) =>
      Promise.resolve(result).then(onFulfilled),
  };

  return { stub, calls };
}

function stubSession({
  staff = true,
  results = [] as QueryResult[],
}: {
  staff?: boolean | null;
  results?: QueryResult[];
}) {
  const queries = results.map(query);
  let index = 0;

  const from = vi.fn(() => {
    const next = queries[Math.min(index, queries.length - 1)];
    index += 1;
    return next?.stub;
  });

  const rpc = vi.fn(async () => ({ data: staff, error: null }));

  mockedCreateClient.mockResolvedValue({ from, rpc } as unknown as Awaited<
    ReturnType<typeof createClient>
  >);

  return { from, rpc, queries };
}

/**
 * Widened deliberately: one test mints a response with no user and no
 * properties, which is the shape auth-js returns when the link could not be
 * generated. Letting TypeScript infer the default would pin `user` to
 * `{ id: string }` and make that case unrepresentable — the failure path would
 * become the one thing the harness could not express.
 */
type GenerateLinkResult = {
  data: {
    user: { id: string } | null;
    properties: { hashed_token: string } | null;
  };
  error: { code?: string } | null;
};

function stubAdmin({
  createUserError = null as { code?: string; status?: number } | null,
  generateLink = {
    data: {
      user: { id: VENDOR_PROFILE_ID },
      properties: { hashed_token: "abc123token" },
    },
    error: null,
  } as GenerateLinkResult,
  results = [] as QueryResult[],
}) {
  const queries = results.map(query);
  let index = 0;

  const from = vi.fn(() => {
    const next = queries[Math.min(index, queries.length - 1)];
    index += 1;
    return next?.stub;
  });

  const createUser = vi.fn(async () => ({
    data: { user: { id: VENDOR_PROFILE_ID } },
    error: createUserError,
  }));
  const generateLinkFn = vi.fn(async () => generateLink);

  mockedCreateAdminClient.mockReturnValue({
    from,
    auth: { admin: { createUser, generateLink: generateLinkFn } },
  } as unknown as ReturnType<typeof createAdminClient>);

  return { from, createUser, generateLink: generateLinkFn, queries };
}

function formData(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

/** A work order with the vendor embedded, as the invite action reads it. */
function assignedWorkOrder(
  overrides: { email?: string | null; id?: string } = {},
) {
  return {
    data: {
      id: WORK_ORDER_ID,
      vendor_id: VENDOR_ID,
      vendors: {
        id: overrides.id ?? VENDOR_ID,
        name: "Bob's Handyman Services",
        email:
          overrides.email === undefined ? "bob@example.com" : overrides.email,
      },
    },
    error: null,
  };
}

const validInvite = { vendorId: VENDOR_ID, workOrderId: WORK_ORDER_ID };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createVendor", () => {
  it("rejects a vendor with no contact method without reaching Supabase", async () => {
    const { from } = stubSession({ results: [{ data: null, error: null }] });

    const state = await createVendor(
      {},
      formData({ name: "Bob", phone: "  ", email: "" }),
    );

    expect(state.fieldErrors?.email).toBeDefined();
    expect(from).not.toHaveBeenCalled();
  });

  /**
   * `profile_id` has no client write grant — the auth link is a service-role
   * write made only by the invite. If this action ever sent it the insert would
   * fail at the database, but only against a live stack, so pin the payload.
   */
  it("inserts only the three columns authenticated may insert", async () => {
    const { queries } = stubSession({ results: [{ data: null, error: null }] });

    await createVendor(
      {},
      formData({ name: "Bob", phone: "", email: "bob@example.com" }),
    );

    expect(queries[0].calls.insert).toHaveBeenCalledWith({
      name: "Bob",
      phone: null,
      email: "bob@example.com",
    });
  });

  it("echoes the submitted values back on failure", async () => {
    stubSession({
      results: [{ data: null, error: { code: "42501" } }],
    });

    const state = await createVendor(
      {},
      formData({
        name: "Bob",
        phone: "+15551230000",
        email: "bob@example.com",
      }),
    );

    expect(state.error).toMatch(/permission/i);
    expect(state.values).toEqual({
      name: "Bob",
      phone: "+15551230000",
      email: "bob@example.com",
    });
  });
});

describe("inviteVendor", () => {
  it("refuses a caller that is not staff, before touching the admin client", async () => {
    stubSession({ staff: false });
    const admin = stubAdmin({});

    const state = await inviteVendor({}, formData(validInvite));

    expect(state.error).toMatch(/permission/i);
    // The whole point of the explicit check: the privileged client bypasses RLS,
    // so it must not be reached by anyone the database would have refused.
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  /**
   * `is_staff()` returns NULL for an authenticated caller with no profiles row.
   * `staff !== true` denies that as firmly as it denies false — the same
   * fail-closed shape `set_user_role()` uses in the migration.
   */
  it("refuses when the staff check answers null", async () => {
    stubSession({ staff: null });

    const state = await inviteVendor({}, formData(validInvite));

    expect(state.error).toMatch(/permission/i);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("refuses a vendor that is not the one assigned to the work order", async () => {
    stubSession({
      results: [
        assignedWorkOrder({ id: "30000000-0000-0000-0000-000000000009" }),
      ],
    });

    const state = await inviteVendor({}, formData(validInvite));

    expect(state.error).toMatch(/no longer assigned/i);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it("refuses a vendor with no email address", async () => {
    stubSession({ results: [assignedWorkOrder({ email: null })] });

    const state = await inviteVendor({}, formData(validInvite));

    expect(state.error).toMatch(/email address/i);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  /**
   * Self-service signup is open, so an existing account is a normal state for
   * this flow rather than a failure. Everything downstream works from the user
   * `generateLink()` resolves, so there is nothing to recover — only a wrong
   * branch to avoid taking.
   */
  it("treats an existing account as success", async () => {
    stubSession({ results: [assignedWorkOrder()] });
    const admin = stubAdmin({
      createUserError: { code: "email_exists", status: 422 },
      results: [{ data: { role: "vendor" }, error: null }, { error: null }],
    });

    const state = await inviteVendor({}, formData(validInvite));

    expect(state.error).toBeUndefined();
    expect(state.inviteUrl).toContain("/auth/confirm?");
    expect(admin.generateLink).toHaveBeenCalled();
  });

  /**
   * The escalation this prevents: linking a manager's account to a vendor row
   * gives that manager session a `current_vendor_id()`, while
   * `guard_work_order_update()` keys the column restrictions off the *role* —
   * so they would gain a vendor's row visibility with none of a vendor's limits.
   */
  it("refuses to link an account whose role is not vendor", async () => {
    stubSession({ results: [assignedWorkOrder()] });
    const admin = stubAdmin({
      generateLink: {
        data: {
          user: { id: MANAGER_PROFILE_ID },
          properties: { hashed_token: "abc123token" },
        },
        error: null,
      },
      results: [{ data: { role: "manager" }, error: null }],
    });

    const state = await inviteVendor({}, formData(validInvite));

    expect(state.error).toMatch(/staff account/i);
    expect(state.inviteUrl).toBeUndefined();
    // Read the profile, but never wrote the link.
    expect(admin.queries[0].calls.update).not.toHaveBeenCalled();
  });

  it("links the profile and returns a link pointing at our own confirm route", async () => {
    stubSession({ results: [assignedWorkOrder()] });
    const admin = stubAdmin({
      results: [{ data: { role: "vendor" }, error: null }, { error: null }],
    });

    const state = await inviteVendor({}, formData(validInvite));

    expect(admin.queries[1].calls.update).toHaveBeenCalledWith({
      profile_id: VENDOR_PROFILE_ID,
    });

    // Our own route, never `properties.action_link`. That one goes to GoTrue's
    // /auth/v1/verify and returns the session in a URL fragment for a
    // browser-side client — the implicit flow, which this app does not use
    // because its session lives in cookies written server-side.
    const url = new URL(state.inviteUrl ?? "");
    expect(url.origin).toBe("http://127.0.0.1:3000");
    expect(url.pathname).toBe("/auth/confirm");
    expect(url.searchParams.get("token_hash")).toBe("abc123token");
    expect(url.searchParams.get("type")).toBe("magiclink");
    // Deep-linked to the job, per docs/vendor-access.md §3b.
    expect(url.searchParams.get("next")).toBe(`/work-orders/${WORK_ORDER_ID}`);
  });

  it("surfaces a duplicate auth link as its own message", async () => {
    stubSession({ results: [assignedWorkOrder()] });
    stubAdmin({
      results: [
        { data: { role: "vendor" }, error: null },
        // `vendors_profile_id_key`, the partial unique index: one vendor row per
        // auth user, or current_vendor_id() would silently pick one of several.
        { error: { code: "23505" } },
      ],
    });

    const state = await inviteVendor({}, formData(validInvite));

    expect(state.error).toMatch(/already belongs to a different vendor/i);
    expect(state.inviteUrl).toBeUndefined();
  });

  it("never returns a link when the token could not be minted", async () => {
    stubSession({ results: [assignedWorkOrder()] });
    stubAdmin({
      generateLink: { data: { user: null, properties: null }, error: null },
    });

    const state = await inviteVendor({}, formData(validInvite));

    expect(state.error).toBeDefined();
    expect(state.inviteUrl).toBeUndefined();
  });
});
