import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  completeAccountSetup,
  requestPasswordReset,
  signIn,
  signOut,
  signUp,
} from "@/server/actions/auth";

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
  getUser: ReturnType<typeof vi.fn>;
  resetPasswordForEmail: ReturnType<typeof vi.fn>;
  signInWithPassword: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  updateUser: ReturnType<typeof vi.fn>;
};

function stubSupabase(
  overrides: Partial<AuthStub> = {},
  profileResult: { error: null | { code: string } } = { error: null },
) {
  const auth: AuthStub = {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: "00000000-0000-0000-0000-000000000099" } },
      error: null,
    }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  };
  const profileEq = vi.fn().mockResolvedValue(profileResult);
  const profileUpdate = vi.fn().mockReturnValue({ eq: profileEq });
  const from = vi.fn().mockReturnValue({ update: profileUpdate });

  mockedCreateClient.mockResolvedValue({
    auth,
    from,
  } as unknown as Awaited<ReturnType<typeof createClient>>);

  return Object.assign(auth, { from, profileEq, profileUpdate });
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
  email: "new@realtyworks.test",
};

const validAccountSetup = {
  fullName: "New Person",
  password: "password123",
  passwordConfirmation: "password123",
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

    const state = await signUp({}, formData({ email: "nope" }));

    expect(state.fieldErrors?.email).toBeDefined();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("creates an unreachable pending account from only the verified address", async () => {
    const auth = stubSupabase();

    await signUp({}, formData(validSignup));

    const sent = auth.signUp.mock.calls[0]?.[0];

    expect(sent).toEqual({
      email: "new@realtyworks.test",
      password: expect.any(String),
    });
    expect(sent.password).toHaveLength(43);
    expect(sent).not.toHaveProperty("options");
  });

  it("hands the email back on provider failure", async () => {
    stubSupabase({
      signUp: vi.fn().mockResolvedValue({
        error: { message: "User already registered", status: 422 },
      }),
    });

    const state = await signUp({}, formData(validSignup));

    expect(state.values).toEqual({ email: "new@realtyworks.test" });
  });

  it("bounds what it echoes", async () => {
    const data = formData({ email: "a".repeat(400) });

    const state = await signUp({}, data);

    expect(state.values?.email).toHaveLength(256);
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
    // The second response is indistinguishable from a new account. Because the
    // action accepted no password or profile data, that ambiguity is harmless:
    // the email owner supplies every authoritative value after verification.
    stubSupabase();

    const state = await signUp({}, formData(validSignup));

    expect(state.confirmationSent).toBe(true);
    expect(state.error).toBeUndefined();
  });
});

describe("requestPasswordReset", () => {
  it("rejects an invalid email before reaching Supabase", async () => {
    const auth = stubSupabase();

    const state = await requestPasswordReset({}, formData({ email: "nope" }));

    expect(state.fieldErrors?.email).toBeDefined();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("requests a recovery link without revealing whether the account exists", async () => {
    const auth = stubSupabase();

    const state = await requestPasswordReset(
      {},
      formData({ email: "  new@realtyworks.test  " }),
    );

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "new@realtyworks.test",
    );
    expect(state.passwordResetSent).toBe(true);
    expect(state.values?.email).toBe("  new@realtyworks.test  ");
  });

  it("turns provider throttling into an actionable message", async () => {
    stubSupabase({
      resetPasswordForEmail: vi
        .fn()
        .mockResolvedValue({ error: { status: 429 } }),
    });

    const state = await requestPasswordReset({}, formData(validSignup));

    expect(state.passwordResetSent).toBeUndefined();
    expect(state.error).toBe("Too many attempts. Try again in a few minutes.");
  });
});

describe("completeAccountSetup", () => {
  it("rejects invalid details before reading the session", async () => {
    const auth = stubSupabase();

    const state = await completeAccountSetup(
      {},
      formData({ ...validAccountSetup, phone: "12" }),
    );

    expect(state.fieldErrors?.phone).toBeDefined();
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(auth.profileUpdate).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses a request without the verified-link session", async () => {
    const auth = stubSupabase({
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { code: "session_not_found", status: 401 },
      }),
    });

    const state = await completeAccountSetup({}, formData(validAccountSetup));

    expect(state.error).toContain("setup link is no longer active");
    expect(auth.profileUpdate).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("updates the verified user's profile and password", async () => {
    const auth = stubSupabase();

    await expect(
      completeAccountSetup({}, formData(validAccountSetup)),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");

    expect(auth.from).toHaveBeenCalledWith("profiles");
    expect(auth.profileUpdate).toHaveBeenCalledWith({
      full_name: "New Person",
      phone: "+15551234567",
    });
    expect(auth.profileEq).toHaveBeenCalledWith(
      "id",
      "00000000-0000-0000-0000-000000000099",
    );
    expect(auth.updateUser).toHaveBeenCalledWith({
      password: "password123",
      data: { full_name: "New Person", phone: "+15551234567" },
    });
  });

  it("does not change the password when the profile write fails", async () => {
    const auth = stubSupabase({}, { error: { code: "42501" } });

    const state = await completeAccountSetup({}, formData(validAccountSetup));

    expect(state.error).toBe(
      "Could not finish setting up your account. Try again.",
    );
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("keeps non-secret details but never echoes either password on failure", async () => {
    stubSupabase({
      updateUser: vi.fn().mockResolvedValue({
        error: { code: "unexpected", status: 500 },
      }),
    });

    const state = await completeAccountSetup({}, formData(validAccountSetup));
    const serialized = JSON.stringify(state);

    expect(state.values).toEqual({
      fullName: "New Person",
      phone: "+1 (555) 123-4567",
    });
    expect(serialized).not.toContain(validAccountSetup.password);
    expect(serialized).not.toContain(validAccountSetup.passwordConfirmation);
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
