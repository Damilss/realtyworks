import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  addNote,
  assignVendor,
  createWorkOrder,
} from "@/server/actions/work-orders";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  // The real redirect() signals by throwing NEXT_REDIRECT. Throwing here too
  // keeps the control flow honest: a test only sees a return value if the
  // action genuinely returned instead of redirecting.
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

const mockedCreateClient = vi.mocked(createClient);
const mockedRedirect = vi.mocked(redirect);

// Real ids from supabase/seed.sql — see the note in src/schemas/work-order.test.ts
// on why invented v4-shaped ids are the wrong fixture here.
const PROPERTY_ID = "10000000-0000-0000-0000-000000000001";
const UNIT_ID = "20000000-0000-0000-0000-000000000001";
const WORK_ORDER_ID = "40000000-0000-0000-0000-000000000003";
const VENDOR_ID = "30000000-0000-0000-0000-000000000001";

type QueryResult = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
};

/**
 * PostgREST's builder is chainable and thenable — `.update(…).eq(…)` is awaited
 * directly while `.insert(…).select(…).single()` is not — so the stub returns
 * itself from every link and resolves to the same result either way.
 */
type QueryStub = {
  select: (...args: unknown[]) => QueryStub;
  eq: (...args: unknown[]) => QueryStub;
  insert: (...args: unknown[]) => QueryStub;
  update: (...args: unknown[]) => QueryStub;
  single: () => Promise<QueryResult>;
  maybeSingle: () => Promise<QueryResult>;
  then: (onFulfilled: (value: QueryResult) => unknown) => Promise<unknown>;
};

function query(result: QueryResult) {
  const calls = { insert: vi.fn(), update: vi.fn(), select: vi.fn() };

  const stub: QueryStub = {
    select: (...args) => {
      calls.select(...args);
      return stub;
    },
    eq: () => stub,
    insert: (...args) => {
      calls.insert(...args);
      return stub;
    },
    update: (...args) => {
      calls.update(...args);
      return stub;
    },
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (onFulfilled) => Promise.resolve(result).then(onFulfilled),
  };

  return { stub, calls };
}

/** Results are handed out in call order — assignVendor reads before it writes. */
function stubSupabase(...results: QueryResult[]) {
  const queries = results.map(query);
  let index = 0;

  const from = vi.fn(() => {
    const next = queries[Math.min(index, queries.length - 1)];
    index += 1;
    return next.stub;
  });

  mockedCreateClient.mockResolvedValue({
    from,
  } as unknown as Awaited<ReturnType<typeof createClient>>);

  return { from, queries };
}

function formData(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

const validCreate = {
  propertyId: PROPERTY_ID,
  unitId: UNIT_ID,
  title: "Leaking tap",
  description: "Kitchen, drips overnight.",
  priority: "high",
  dueDate: "2026-08-15",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWorkOrder", () => {
  it("rejects invalid input without ever reaching Supabase", async () => {
    const { from } = stubSupabase({ data: null, error: null });

    const state = await createWorkOrder(
      {},
      formData({ ...validCreate, title: "" }),
    );

    expect(state.fieldErrors?.title).toBeDefined();
    expect(from).not.toHaveBeenCalled();
  });

  // status and vendor_id are excluded from the INSERT grant so every work order
  // starts 'open' and assignment is an auditable UPDATE. If the action ever
  // sends them, the insert fails at the database — but only in a live stack, so
  // pin the payload here too.
  it("inserts only the columns authenticated may insert", async () => {
    const { queries } = stubSupabase({ data: { id: WORK_ORDER_ID } });

    await expect(createWorkOrder({}, formData(validCreate))).rejects.toThrow(
      `NEXT_REDIRECT:/work-orders/${WORK_ORDER_ID}`,
    );

    expect(queries[0].calls.insert).toHaveBeenCalledWith({
      property_id: PROPERTY_ID,
      unit_id: UNIT_ID,
      title: "Leaking tap",
      description: "Kitchen, drips overnight.",
      priority: "high",
      due_date: "2026-08-15",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(mockedRedirect).toHaveBeenCalledOnce();
  });

  it("sends null rather than an empty string for the optional fields", async () => {
    const { queries } = stubSupabase({ data: { id: WORK_ORDER_ID } });

    await expect(
      createWorkOrder(
        {},
        formData({ ...validCreate, unitId: "", description: "", dueDate: "" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:");

    expect(queries[0].calls.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        unit_id: null,
        description: null,
        due_date: null,
      }),
    );
  });

  it("translates an RLS refusal and keeps the typed values", async () => {
    stubSupabase({ data: null, error: { code: "42501" } });

    const state = await createWorkOrder({}, formData(validCreate));

    expect(state.error).toBe("You do not have permission to make that change.");
    expect(state.values?.title).toBe("Leaking tap");
    expect(mockedRedirect).not.toHaveBeenCalled();
  });

  it("explains a unit that belongs to another property", async () => {
    stubSupabase({ data: null, error: { code: "23503" } });

    const state = await createWorkOrder({}, formData(validCreate));

    expect(state.error).toBe(
      "That unit does not belong to the selected property, or one of them has been removed.",
    );
  });

  // Same SQLSTATE, different constraint: with no unit on the form the only
  // foreign key left to break is the property's, and naming a unit there sends
  // the user hunting for a field they never filled in.
  it("blames the property, not a unit, when no unit was chosen", async () => {
    stubSupabase({ data: null, error: { code: "23503" } });

    const state = await createWorkOrder(
      {},
      formData({ ...validCreate, unitId: "" }),
    );

    expect(state.error).toBe("That property is no longer available.");
  });
});

describe("assignVendor", () => {
  it("moves an open work order to assigned", async () => {
    const { queries } = stubSupabase(
      { data: { status: "open" } },
      { error: null },
    );

    const state = await assignVendor(
      {},
      formData({ workOrderId: WORK_ORDER_ID, vendorId: VENDOR_ID }),
    );

    expect(state.error).toBeUndefined();
    expect(queries[1].calls.update).toHaveBeenCalledWith({
      vendor_id: VENDOR_ID,
      status: "assigned",
    });
  });

  // Reassigning a job mid-repair is a change of vendor, not a change of state.
  it.each(["in_progress", "completed", "assigned"])(
    "leaves a %s work order's status alone",
    async (status) => {
      const { queries } = stubSupabase({ data: { status } }, { error: null });

      await assignVendor(
        {},
        formData({ workOrderId: WORK_ORDER_ID, vendorId: VENDOR_ID }),
      );

      expect(queries[1].calls.update).toHaveBeenCalledWith({
        vendor_id: VENDOR_ID,
      });
    },
  );

  it("reports a work order it cannot read", async () => {
    stubSupabase({ data: null, error: null });

    const state = await assignVendor(
      {},
      formData({ workOrderId: WORK_ORDER_ID, vendorId: VENDOR_ID }),
    );

    expect(state.error).toBe("That work order is no longer available.");
  });

  it("rejects a missing vendor without reading anything", async () => {
    const { from } = stubSupabase({ data: null, error: null });

    const state = await assignVendor(
      {},
      formData({ workOrderId: WORK_ORDER_ID, vendorId: "" }),
    );

    expect(state.fieldErrors?.vendorId).toBeDefined();
    expect(from).not.toHaveBeenCalled();
  });

  // work_orders_vendor_id_fkey: a landlord can delete a vendor directly, so the
  // option the page rendered can be gone by the time the form posts. Same 23503
  // the create path sees, and it has nothing to do with units.
  it("names the vendor when the vendor is the foreign key that broke", async () => {
    stubSupabase({ data: { status: "open" } }, { error: { code: "23503" } });

    const state = await assignVendor(
      {},
      formData({ workOrderId: WORK_ORDER_ID, vendorId: VENDOR_ID }),
    );

    expect(state.error).toBe("That vendor is no longer available.");
  });
});

describe("addNote", () => {
  // The trail is append-only for everyone, so a blank note would be permanent.
  it.each(["", "   "])("rejects the blank note %j", async (note) => {
    const { from } = stubSupabase({ error: null });

    const state = await addNote(
      {},
      formData({ workOrderId: WORK_ORDER_ID, note }),
    );

    expect(state.fieldErrors?.note).toBeDefined();
    expect(from).not.toHaveBeenCalled();
  });

  // action and actor_id carry no INSERT grant: their defaults are what make a
  // note un-forgeable, so the action must not try to set them.
  it("inserts the note without an action or actor", async () => {
    const { queries } = stubSupabase({ error: null });

    const state = await addNote(
      {},
      formData({
        workOrderId: WORK_ORDER_ID,
        note: "  Replaced the washer.  ",
      }),
    );

    expect(state.error).toBeUndefined();
    expect(queries[0].calls.insert).toHaveBeenCalledWith({
      work_order_id: WORK_ORDER_ID,
      note: "Replaced the washer.",
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      `/work-orders/${WORK_ORDER_ID}`,
    );
  });

  it("does not echo the note back after it is recorded", async () => {
    stubSupabase({ error: null });

    const state = await addNote(
      {},
      formData({ workOrderId: WORK_ORDER_ID, note: "Done." }),
    );

    expect(state.values).toBeUndefined();
  });

  // The third 23503 in this file, and the third meaning: the work order itself
  // was deleted while the note was being typed.
  it("names the work order when its foreign key is the one that broke", async () => {
    stubSupabase({ error: { code: "23503" } });

    const state = await addNote(
      {},
      formData({ workOrderId: WORK_ORDER_ID, note: "Still leaking." }),
    );

    expect(state.error).toBe("That work order is no longer available.");
  });
});
