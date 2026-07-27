import { loginSchema, normalizePhone, signupSchema } from "@/schemas/auth";

describe("normalizePhone", () => {
  it("strips the formatting humans type", () => {
    expect(normalizePhone("+1 (555) 123-0002")).toBe("+15551230002");
    expect(normalizePhone("555.123.0002")).toBe("5551230002");
    expect(normalizePhone("  5551230002  ")).toBe("5551230002");
  });

  it("preserves a leading + but never invents one", () => {
    expect(normalizePhone("+15551230002")).toBe("+15551230002");
    expect(normalizePhone("15551230002")).toBe("15551230002");
  });

  it("rejects anything that is not a plausible number", () => {
    expect(normalizePhone("55512")).toBeNull();
    expect(normalizePhone("1234567890123456")).toBeNull();
    expect(normalizePhone("not a phone")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("loginSchema", () => {
  it("trims before validating the email, not after", () => {
    const result = loginSchema.safeParse({
      email: "  manager@realtyworks.test  ",
      password: "password123",
    });

    expect(result.success).toBe(true);
    expect(result.data?.email).toBe("manager@realtyworks.test");
  });

  it("rejects a malformed email and an empty password", () => {
    expect(
      loginSchema.safeParse({ email: "nope", password: "x" }).success,
    ).toBe(false);
    expect(
      loginSchema.safeParse({ email: "a@b.test", password: "" }).success,
    ).toBe(false);
  });

  it("does not impose the signup password minimum", () => {
    // A login form that rejects a short password has disclosed the policy.
    expect(
      loginSchema.safeParse({ email: "a@b.test", password: "short" }).success,
    ).toBe(true);
  });
});

describe("signupSchema", () => {
  const valid = {
    fullName: "Manny Manager",
    email: "manny@realtyworks.test",
    password: "password123",
    phone: "+1 (555) 123-0002",
  };

  it("accepts a complete signup and normalizes the phone", () => {
    const result = signupSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(result.data?.phone).toBe("+15551230002");
  });

  it("trims the name and rejects a whitespace-only one", () => {
    expect(
      signupSchema.safeParse({ ...valid, fullName: "  Ada  " }).data?.fullName,
    ).toBe("Ada");
    expect(signupSchema.safeParse({ ...valid, fullName: "   " }).success).toBe(
      false,
    );
  });

  it("enforces the 6-character password minimum from config.toml", () => {
    expect(
      signupSchema.safeParse({ ...valid, password: "12345" }).success,
    ).toBe(false);
    expect(
      signupSchema.safeParse({ ...valid, password: "123456" }).success,
    ).toBe(true);
  });

  it("reports an unusable phone against the phone field", () => {
    const result = signupSchema.safeParse({ ...valid, phone: "55512" });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path[0] === "phone"),
    ).toBe(true);
  });

  it("rejects a name longer than the profiles CHECK allows", () => {
    expect(
      signupSchema.safeParse({ ...valid, fullName: "a".repeat(121) }).success,
    ).toBe(false);
  });
});
