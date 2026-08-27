import {
  accountSetupSchema,
  loginSchema,
  normalizePhone,
  passwordResetSchema,
  signupSchema,
} from "@/schemas/auth";

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
  it("accepts and trims an email without collecting unverified account data", () => {
    const result = signupSchema.safeParse({
      email: "  new@realtyworks.test  ",
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ email: "new@realtyworks.test" });
  });

  it("rejects a malformed email", () => {
    expect(signupSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("accountSetupSchema", () => {
  const valid = {
    fullName: "Manny Manager",
    password: "password123",
    passwordConfirmation: "password123",
    phone: "+1 (555) 123-0002",
  };

  it("accepts verified account details and normalizes the phone", () => {
    const result = accountSetupSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(result.data?.phone).toBe("+15551230002");
  });

  it("trims the name and rejects a whitespace-only one", () => {
    expect(
      accountSetupSchema.safeParse({ ...valid, fullName: "  Ada  " }).data
        ?.fullName,
    ).toBe("Ada");
    expect(
      accountSetupSchema.safeParse({ ...valid, fullName: "   " }).success,
    ).toBe(false);
  });

  it("enforces the 6-character password minimum from config.toml", () => {
    expect(
      accountSetupSchema.safeParse({
        ...valid,
        password: "12345",
        passwordConfirmation: "12345",
      }).success,
    ).toBe(false);
    expect(
      accountSetupSchema.safeParse({
        ...valid,
        password: "123456",
        passwordConfirmation: "123456",
      }).success,
    ).toBe(true);
  });

  it("requires the two password entries to match", () => {
    const result = accountSetupSchema.safeParse({
      ...valid,
      passwordConfirmation: "different123",
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some(
        (issue) => issue.path[0] === "passwordConfirmation",
      ),
    ).toBe(true);
  });

  it("reports an unusable phone against the phone field", () => {
    const result = accountSetupSchema.safeParse({ ...valid, phone: "55512" });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path[0] === "phone"),
    ).toBe(true);
  });

  it("rejects a name longer than the profiles CHECK allows", () => {
    expect(
      accountSetupSchema.safeParse({ ...valid, fullName: "a".repeat(121) })
        .success,
    ).toBe(false);
  });
});

describe("passwordResetSchema", () => {
  it("uses the same trimmed email contract", () => {
    expect(
      passwordResetSchema.safeParse({ email: "  user@example.test  " }).data
        ?.email,
    ).toBe("user@example.test");
  });
});
