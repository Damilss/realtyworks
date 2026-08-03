import {
  addNoteSchema,
  assignVendorSchema,
  createWorkOrderSchema,
} from "@/schemas/work-order";

/**
 * Real ids from `supabase/seed.sql`, not invented v4-shaped ones.
 *
 * This matters more than it looks: these carry version and variant nibbles of
 * 0, so Zod's RFC-9562 `uuid()` rejects them while Postgres accepts them
 * happily. Fixtures that were coincidentally valid v4 UUIDs let a schema that
 * could not validate this repo's own seed data pass every unit test.
 */
const PROPERTY_ID = "10000000-0000-0000-0000-000000000001";
const UNIT_ID = "20000000-0000-0000-0000-000000000001";
const WORK_ORDER_ID = "40000000-0000-0000-0000-000000000003";
const VENDOR_ID = "30000000-0000-0000-0000-000000000001";

const validCreate = {
  propertyId: PROPERTY_ID,
  unitId: UNIT_ID,
  title: "Leaking tap",
  description: "Kitchen, drips overnight.",
  priority: "high",
  dueDate: "2026-08-15",
};

describe("createWorkOrderSchema", () => {
  it("accepts a fully specified work order", () => {
    const parsed = createWorkOrderSchema.safeParse(validCreate);

    expect(parsed.success).toBe(true);
    expect(parsed.data?.unitId).toBe(UNIT_ID);
    expect(parsed.data?.dueDate).toBe("2026-08-15");
  });

  // A <select> with no choice and an empty <input type="date"> both post "",
  // which is not NULL to Postgres — an empty string fails a uuid cast outright.
  it("collapses empty optional fields to null", () => {
    const parsed = createWorkOrderSchema.safeParse({
      ...validCreate,
      unitId: "",
      description: "   ",
      dueDate: "",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.unitId).toBeNull();
    expect(parsed.data?.description).toBeNull();
    expect(parsed.data?.dueDate).toBeNull();
  });

  // Regression: the schema used z.uuid(), which enforces RFC 9562 version and
  // variant bits that Postgres's uuid type does not. Every id in seed.sql was
  // rejected, so the create form could not be submitted at all against a
  // freshly seeded stack — while unit tests using v4-shaped fixtures passed.
  it.each([
    ["a seeded id with zero version/variant nibbles", PROPERTY_ID],
    ["a v4 id from gen_random_uuid()", "b7a3f0c2-9e1d-4a55-8f21-6c0d3e5a7b91"],
    ["an all-zero id", "00000000-0000-0000-0000-000000000000"],
  ])("accepts %s", (_label, propertyId) => {
    const parsed = createWorkOrderSchema.safeParse({
      ...validCreate,
      propertyId,
    });

    expect(parsed.success).toBe(true);
  });

  it.each(["not-a-uuid", "10000000-0000-0000-0000-00000000000", "12345"])(
    "still rejects the malformed id %j",
    (propertyId) => {
      const parsed = createWorkOrderSchema.safeParse({
        ...validCreate,
        propertyId,
      });

      expect(parsed.success).toBe(false);
    },
  );

  it("requires a property", () => {
    const parsed = createWorkOrderSchema.safeParse({
      ...validCreate,
      propertyId: "",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a blank title", () => {
    const parsed = createWorkOrderSchema.safeParse({
      ...validCreate,
      title: "   ",
    });

    expect(parsed.success).toBe(false);
  });

  // char_length(title) between 1 and 120 on work_orders.
  it("rejects a title past the column's CHECK", () => {
    const parsed = createWorkOrderSchema.safeParse({
      ...validCreate,
      title: "x".repeat(121),
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a description past the column's CHECK", () => {
    const parsed = createWorkOrderSchema.safeParse({
      ...validCreate,
      description: "x".repeat(2001),
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a malformed due date", () => {
    const parsed = createWorkOrderSchema.safeParse({
      ...validCreate,
      dueDate: "15/08/2026",
    });

    expect(parsed.success).toBe(false);
  });

  // The enum comes from the generated Constants, so an invented status can
  // never pass validation and reach the database as a 22P02.
  it("rejects a priority outside the database enum", () => {
    const parsed = createWorkOrderSchema.safeParse({
      ...validCreate,
      priority: "catastrophic",
    });

    expect(parsed.success).toBe(false);
  });

  // status and vendor_id have no INSERT grant; the schema must not offer a
  // channel for them either, or a hand-crafted POST would look accepted.
  it("does not carry status or vendor through", () => {
    const parsed = createWorkOrderSchema.safeParse({
      ...validCreate,
      status: "completed",
      vendorId: VENDOR_ID,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("status");
    expect(parsed.data).not.toHaveProperty("vendorId");
  });
});

describe("assignVendorSchema", () => {
  it("accepts a work order and vendor", () => {
    const parsed = assignVendorSchema.safeParse({
      workOrderId: WORK_ORDER_ID,
      vendorId: VENDOR_ID,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects an unchosen vendor", () => {
    const parsed = assignVendorSchema.safeParse({
      workOrderId: WORK_ORDER_ID,
      vendorId: "",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("addNoteSchema", () => {
  it("trims the note it accepts", () => {
    const parsed = addNoteSchema.safeParse({
      workOrderId: WORK_ORDER_ID,
      note: "  Replaced the washer.  ",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.note).toBe("Replaced the washer.");
  });

  // The trail is append-only for everyone, so a blank note is permanent and
  // unfixable. `activity_note_requires_text` now agrees (issue #76).
  it.each(["", "   ", "\n\t"])("rejects the blank note %j", (note) => {
    const parsed = addNoteSchema.safeParse({
      workOrderId: WORK_ORDER_ID,
      note,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a note past the column's CHECK", () => {
    const parsed = addNoteSchema.safeParse({
      workOrderId: WORK_ORDER_ID,
      note: "x".repeat(2001),
    });

    expect(parsed.success).toBe(false);
  });
});
