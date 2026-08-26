import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { signIn, signOut, signUp } from "@/server/actions/auth";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
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

type AuthStub = {
  signInWithPassword: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
};

function stubSupabase(overrides: Partial<AuthStub> = {}) {
  const auth: AuthStub = {
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  };

  mockedCreateClient.mockResolvedValue({
    auth,
  } as unknown as Awaited<ReturnType<typeof createClient>>);

  return auth;
}

function formData(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

const validLogin = {
  email: "manager@realtyworks.test",
  password: "password123",
};

const validSignup = {
  fullName: "New Person",
  email: "new@realtyworks.test",
  password: "password123",
  phone: "+1 (555) 123-4567",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signIn", () => {
  it("rejects invalid input without ever reaching Supabase", async () => {
    const auth = stubSupabase();

    const state = await signIn({}, formData({ email: "nope", password: "" }));

    expect(state.fieldErrors?.email).toBeDefined();
    expect(state.fieldErrors?.password).toBeDefined();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(mockedRedirect).not.toHaveBeenCalled();
  });

  it("returns one generic message and never leaks the provider's wording", async () => {
    const auth = stubSupabase({
      signInWithPassword: vi.fn().mockResolvedValue({
        error: {
          message: "Invalid login credentials",
          code: "invalid_credentials",
          status: 400,
        },
      }),
    });

    const state = await signIn({}, formData(validLogin));

    expect(state.error).toBe("Invalid email or password.");
    expect(auth.signInWithPassword).toHaveBeenCalledOnce();
    expect(mockedRedirect).not.toHaveBeenCalled();
  });

  it("gives the same message whether or not the account exists", async () => {
    stubSupabase({
      signInWithPassword: vi.fn().mockResolvedValue({
        error: {
          message: "User not found",
          code: "user_not_found",
          status: 400,
        },
      }),
    });
    const missing = await signIn({}, formData(validLogin));

    stubSupabase({
      signInWithPassword: vi.fn().mockResolvedValue({
        error: {
          message: "Invalid login credentials",
          code: "invalid_credentials",
          status: 400,
        },
      }),
    });
    const wrongPassword = await signIn({}, formData(validLogin));

    // Any divergence here turns the form into an enumeration oracle.
    expect(missing.error).toBe(wrongPassword.error);
  });

  it("distinguishes rate limiting, which is actionable", async () => {
    stubSupabase({
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ error: { message: "rate limited", status: 429 } }),
    });

    const state = await signIn({}, formData(validLogin));

    expect(state.error).toBe("Too many attempts. Try again in a few minutes.");
  });

  it("distinguishes an unconfirmed address, which is also actionable", async () => {
    stubSupabase({
      signInWithPassword: vi.fn().mockResolvedValue({
        error: {
          message: "Email not confirmed",
          code: "email_not_confirmed",
          status: 400,
        },
      }),
    });

    const state = await signIn({}, formData(validLogin));

    // Not an enumeration oracle: GoTrue only reaches this error once the
    // password checked out, so it reveals nothing the caller had not already
    // proven. The alternative tells someone who has not opened their email
    // that their password is wrong.
    expect(state.error).toBe(
      "Confirm your email address before signing in. Check your inbox for the link.",
    );
  });

  it("keeps every other failure collapsed into the one message", async () => {
    // The guard on the branch above: a new GoTrue error code must not acquire
    // its own wording by accident.
    for (const code of [
      "invalid_credentials",
      "user_not_found",
      "unexpected",
    ]) {
      stubSupabase({
        signInWithPassword: vi
          .fn()
          .mockResolvedValue({ error: { message: code, code, status: 400 } }),
      });

      const state = await signIn({}, formData(validLogin));

      expect(state.error).toBe("Invalid email or password.");
    }
  });

  it("redirects to the dashboard on success", async () => {
    stubSupabase();

    await expect(signIn({}, formData(validLogin))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
    expect(mockedRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("hands the submitted email back so the reset does not clear it", async () => {
    // React resets an uncontrolled form after every action, so an error state
    // that carries no values wipes the field the user has to correct.
    stubSupabase({
      signInWithPassword: vi.fn().mockResolvedValue({
        error: { message: "Invalid login credentials", status: 400 },
      }),
    });

    const state = await signIn({}, formData(validLogin));

    expect(state.values).toEqual({ email: "manager@realtyworks.test" });
  });

  it("hands it back on a validation failure too", async () => {
    const state = await signIn(
      {},
      formData({ email: "not-an-email", password: "" }),
    );

    expect(state.values?.email).toBe("not-an-email");
  });

  it("never echoes the password back to the browser", async () => {
    stubSupabase({
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ error: { message: "nope", status: 400 } }),
    });

    const state = await signIn({}, formData(validLogin));

    expect(JSON.stringify(state)).not.toContain(validLogin.password);
  });

  it("passes the trimmed email through to Supabase", async () => {
    const auth = stubSupabase();

    await expect(
      signIn(
        {},
        formData({ ...validLogin, email: "  manager@realtyworks.test  " }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "manager@realtyworks.test",
      password: "password123",
    });
  });
});

describe("signUp", () => {
  it("rejects invalid input without ever reaching Supabase", async () => {
    const auth = stubSupabase();

    const state = await signUp(
      {},
      formData({ fullName: "", email: "nope", password: "x", phone: "12" }),
    );

    expect(state.fieldErrors?.fullName).toBeDefined();
    expect(state.fieldErrors?.email).toBeDefined();
    expect(state.fieldErrors?.password).toBeDefined();
    expect(state.fieldErrors?.phone).toBeDefined();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("sends the name and normalized phone as user metadata", async () => {
    const auth = stubSupabase();

    await signUp({}, formData(validSignup));

    expect(auth.signUp).toHaveBeenCalledWith({
      email: "new@realtyworks.test",
      password: "password123",
      options: { data: { full_name: "New Person", phone: "+15551234567" } },
    });
  });

  it("sends nothing role-shaped, so a self-registration cannot self-promote", async () => {
    const auth = stubSupabase();

    await signUp(
      {},
      formData({ ...validSignup, role: "landlord", app_role: "landlord" }),
    );

    const sent = auth.signUp.mock.calls[0]?.[0];
    const metadataKeys = Object.keys(sent.options.data);

    expect(metadataKeys).toEqual(["full_name", "phone"]);
    expect(JSON.stringify(sent)).not.toContain("landlord");
  });

  it("hands every non-secret field back, as typed", async () => {
    stubSupabase({
      signUp: vi.fn().mockResolvedValue({
        error: { message: "User already registered", status: 422 },
      }),
    });

    const state = await signUp({}, formData(validSignup));

    expect(state.values).toEqual({
      fullName: "New Person",
      email: "new@realtyworks.test",
      // Not "+15551234567" — the user corrects what they typed, not what the
      // schema normalized it into.
      phone: "+1 (555) 123-4567",
    });
    expect(JSON.stringify(state)).not.toContain(validSignup.password);
  });

  it("hands back the fields that validated alongside the one that did not", async () => {
    const state = await signUp({}, formData({ ...validSignup, phone: "12" }));

    expect(state.fieldErrors?.phone).toBeDefined();
    expect(state.values?.fullName).toBe("New Person");
    expect(state.values?.email).toBe("new@realtyworks.test");
    expect(state.values?.phone).toBe("12");
  });

  it("bounds what it echoes, and drops a field that is not text", async () => {
    const data = formData({ ...validSignup, email: "nope" });
    data.set("fullName", "a".repeat(400));
    // A server action is a public POST endpoint: a caller can send a file part
    // where the form sends text, and String()-ing one yields "[object File]".
    data.set("phone", new File(["x"], "phone.txt"));

    const state = await signUp({}, data);

    expect(state.values?.fullName).toHaveLength(256);
    expect(state.values?.phone).toBeUndefined();
  });

  it("asks the new account to confirm, instead of signing it in", async () => {
    stubSupabase();

    const state = await signUp({}, formData(validSignup));

    // The heart of issue #93: with `[auth.email] enable_confirmations` on,
    // signUp() returns no session, so a redirect to /dashboard would bounce
    // straight back to /login.
    expect(mockedRedirect).not.toHaveBeenCalled();
    expect(state.confirmationSent).toBe(true);
    // The panel greets the user by the address it just mailed.
    expect(state.values?.email).toBe("new@realtyworks.test");
  });

  it("does not confirm whether an email is already registered", async () => {
    // The exact response a *confirmed* address still draws, checked against the
    // running stack rather than taken from the docs: turning confirmations on
    // did not obfuscate this into a success, so the branch is still live.
    stubSupabase({
      signUp: vi.fn().mockResolvedValue({
        error: {
          message: "User already registered",
          code: "user_already_exists",
          status: 422,
        },
      }),
    });

    const state = await signUp({}, formData(validSignup));

    expect(state.confirmationSent).toBeUndefined();
    expect(state.error).toBe(
      "Could not create that account. If you already have one, sign in.",
    );
    expect(state.error).not.toContain("already registered");
  });

  it("shows the same panel when an outstanding link is merely resent", async () => {
    // An address that exists but has not confirmed is not a duplicate to
    // GoTrue: it succeeds and sends the link again. Saying nothing about which
    // of the two happened is what keeps the form off the enumeration path — and
    // it is why there is no separate "resend" control to build.
    stubSupabase();

    const state = await signUp({}, formData(validSignup));

    expect(state.confirmationSent).toBe(true);
    expect(state.error).toBeUndefined();
  });
});

describe("signOut", () => {
  it("redirects to login after clearing the session", async () => {
    const auth = stubSupabase();

    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT:/login");
    // Not `toHaveBeenCalledOnce()`: auth-js defaults the scope to 'global',
    // which revokes every session the account holds, so the argument is the
    // whole point and an arity-only assertion would let the default creep back
    // silently (issues #92/#98).
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("still redirects when the provider call fails", async () => {
    // The cookies are already cleared locally; stranding the user on an
    // authenticated-looking page would be the worse outcome.
    stubSupabase({
      signOut: vi
        .fn()
        .mockResolvedValue({ error: { message: "network", status: 500 } }),
    });

    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
