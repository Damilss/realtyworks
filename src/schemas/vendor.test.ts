import { createVendorSchema, inviteVendorSchema } from "@/schemas/vendor";

/**
 * The schema's job is to say, before the round trip, exactly what
 * `vendors_contact_method` would say after it. The constraint is
 *
 *     nullif(trim(phone), '') is not null or nullif(trim(email), '') is not null
 *
 * so the interesting cases are all about blankness, not about absence.
 */

function parse(input: { name?: unknown; phone?: unknown; email?: unknown }) {
  return createVendorSchema.safeParse({
    name: "Bob's Handyman Services",
    phone: "",
    email: "",
    ...input,
  });
}

describe("createVendorSchema", () => {
  it("accepts a vendor with only an email", () => {
    const result = parse({ email: "bob@example.com" });

    expect(result.success).toBe(true);
    expect(result.data?.email).toBe("bob@example.com");
    // Collapsed, not left as "": Postgres wants NULL for "no phone", and the
    // constraint's nullif() treats the two the same way.
    expect(result.data?.phone).toBeNull();
  });

  it("accepts a vendor with only a phone number", () => {
    const result = parse({ phone: "+15551230000" });

    expect(result.success).toBe(true);
    expect(result.data?.phone).toBe("+15551230000");
    expect(result.data?.email).toBeNull();
  });

  it("rejects a vendor with neither", () => {
    const result = parse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "Enter an email address or a phone number.",
    );
  });

  /**
   * The case the DB constraint was written with `nullif(trim(...), '')` to
   * catch. A plain `is not null` check would pass a row with a phone of three
   * spaces — a vendor nobody can reach — so the schema has to agree.
   */
  it.each([
    ["spaces", "   "],
    ["a tab", "\t"],
    ["a newline", "\n"],
    ["mixed whitespace", " \t\n "],
  ])("treats a phone of %s as no contact method", (_label, phone) => {
    expect(parse({ phone }).success).toBe(false);
  });

  it("rejects a whitespace-only email the same way", () => {
    expect(parse({ email: "   " }).success).toBe(false);
  });

  it("rejects a malformed email even when a phone is present", () => {
    // Not merely text: this address is what the magic link gets minted against,
    // and `auth.admin.createUser` would refuse it with an error no form field
    // could usefully explain.
    const result = parse({ phone: "+15551230000", email: "not-an-email" });

    expect(result.success).toBe(false);
  });

  it("requires a name", () => {
    expect(parse({ name: "   ", email: "bob@example.com" }).success).toBe(
      false,
    );
  });

  it("rejects a name past the 120-character column check", () => {
    const result = parse({ name: "a".repeat(121), email: "bob@example.com" });

    expect(result.success).toBe(false);
  });

  it("trims surrounding whitespace rather than rejecting it", () => {
    const result = parse({ name: "  Bob  ", email: "  bob@example.com  " });

    expect(result.success).toBe(true);
    expect(result.data?.name).toBe("Bob");
    expect(result.data?.email).toBe("bob@example.com");
  });
});

describe("inviteVendorSchema", () => {
  // Real seeded ids. Their version and variant nibbles are 0, which RFC 9562
  // forbids and Postgres does not care about — the reason every id in this
  // codebase is validated with z.guid() and never z.uuid().
  const VENDOR_ID = "30000000-0000-0000-0000-000000000001";
  const WORK_ORDER_ID = "40000000-0000-0000-0000-000000000003";

  it("accepts the seeded id shapes", () => {
    const result = inviteVendorSchema.safeParse({
      vendorId: VENDOR_ID,
      workOrderId: WORK_ORDER_ID,
    });

    expect(result.success).toBe(true);
  });

  it("accepts a v4 id too", () => {
    const result = inviteVendorSchema.safeParse({
      vendorId: "6f4e2a1b-9c3d-4e8f-a7b2-1d5c9e0f3a4b",
      workOrderId: WORK_ORDER_ID,
    });

    expect(result.success).toBe(true);
  });

  it("rejects a malformed id", () => {
    const result = inviteVendorSchema.safeParse({
      vendorId: "not-a-uuid",
      workOrderId: WORK_ORDER_ID,
    });

    expect(result.success).toBe(false);
  });
});
