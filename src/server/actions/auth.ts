"use server";

import { randomBytes } from "node:crypto";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  accountSetupSchema,
  loginSchema,
  passwordResetSchema,
  signupSchema,
} from "@/schemas/auth";

/**
 * Auth mutations.
 *
 * Note the absence of `import "server-only"` here, unlike the query modules.
 * Server actions are the one part of `src/server/` that client components are
 * meant to import — `"use server"` swaps the body for an RPC reference in the
 * client bundle, so the implementation never ships. `server-only` would break
 * the forms without adding protection.
 *
 * That reference is a public POST endpoint, so each action re-validates its
 * input. The form only rendering on /login is not a boundary
 * (node_modules/next/dist/docs/01-app/02-guides/server-actions.md, "Security").
 */

/**
 * The subset of a submission worth handing back to the browser. React resets an
 * uncontrolled form after *every* function action — `startHostTransition` calls
 * `requestFormReset` before the action runs, so the commit that renders an error
 * is the same one that empties the inputs. Whatever is not echoed here is
 * retyped, so a mistyped phone costs the user the whole form.
 *
 * Passwords are deliberately absent. Echoing one would round-trip a credential
 * through the action response to save retyping a single field; clearing it on
 * failure is both the safer and the expected behaviour.
 */
export type AuthFormValues = {
  fullName?: string;
  email?: string;
  phone?: string;
};

export type AuthFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: AuthFormValues;
  /**
   * Set by `signUp` when the account was accepted and a confirmation email is
   * on its way. There is no session yet — `[auth.email] enable_confirmations`
   * is on — so there is nothing to redirect to, and the form swaps itself for a
   * "check your inbox" panel instead.
   */
  confirmationSent?: boolean;
  /** Set after a non-enumerating password-recovery request completes. */
  passwordResetSent?: boolean;
};

/**
 * Past every field's own maximum (name 120, phone 32, email 254), so truncation
 * can only ever shorten input that is already invalid. The bound exists because
 * the action is a public POST endpoint: without it, an arbitrarily long field
 * comes straight back out in the response.
 */
const MAX_ECHOED_LENGTH = 256;

/**
 * GoTrue's password endpoint requires a credential even though RealtyWorks does
 * not let the user choose one until their email is verified. This random value
 * is never returned, logged, or shown; 32 random bytes are comfortably inside
 * GoTrue's password length limits and make the pre-confirmation account
 * unreachable by password.
 */
function pendingAccountPassword(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Reads the named fields back out as typed — not from the parsed result, which
 * does not exist when validation is what failed, and which has already
 * normalized the phone number the user is being asked to correct.
 */
function submittedValues(
  formData: FormData,
  names: readonly (keyof AuthFormValues)[],
): AuthFormValues {
  const values: AuthFormValues = {};

  for (const name of names) {
    const value = formData.get(name);

    // A FormData entry can be a File; String()-ing one yields "[object File]".
    if (typeof value === "string") {
      values[name] = value.slice(0, MAX_ECHOED_LENGTH);
    }
  }

  return values;
}

/**
 * Both failure modes return the same string. GoTrue distinguishes "no such
 * user" from "wrong password", and surfacing that difference turns the login
 * form into an account-enumeration oracle.
 */
const INVALID_CREDENTIALS = "Invalid email or password.";

/**
 * `[auth.rate_limit] sign_in_sign_ups` in supabase/config.toml caps attempts at
 * 30 per 5 minutes per IP. Saying so beats a generic failure that reads like a
 * bug and invites the user to keep retrying.
 */
const RATE_LIMITED = "Too many attempts. Try again in a few minutes.";

/**
 * The one sign-in failure worth naming, and the reason it is not an oracle:
 * GoTrue only returns `email_not_confirmed` *after* the password checked out.
 * Saying so therefore tells an attacker nothing they had not already proven by
 * holding the password, while the alternative tells a real user who simply has
 * not opened their email that their password is wrong — a support call, and one
 * that reads like the app is broken.
 */
const EMAIL_NOT_CONFIRMED =
  "Confirm your email address before signing in. Check your inbox for the link.";

/** GoTrue reports throttling as HTTP 429; the code spelling varies by version. */
function isRateLimited(error: { status?: number; code?: string }): boolean {
  return error.status === 429 || error.code === "over_request_rate_limit";
}

/**
 * Everything that is not rate limiting or an unconfirmed address collapses to
 * one string, deliberately — see INVALID_CREDENTIALS.
 */
function describeSignInError(error: {
  status?: number;
  code?: string;
}): string {
  if (isRateLimited(error)) {
    return RATE_LIMITED;
  }

  if (error.code === "email_not_confirmed") {
    return EMAIL_NOT_CONFIRMED;
  }

  return INVALID_CREDENTIALS;
}

export async function signIn(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const values = submittedValues(formData, ["email"]);
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Logged in full server-side, returned as a single opaque string.
    console.error("[auth] Sign-in failed", {
      code: error.code,
      status: error.status,
    });

    return { error: describeSignInError(error), values };
  }

  // Outside any try/catch: redirect() signals by throwing NEXT_REDIRECT, and a
  // catch would swallow it and silently leave the user on the login page.
  redirect("/dashboard");
}

export async function signUp(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const values = submittedValues(formData, ["email"]);
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: pendingAccountPassword(),
  });

  if (error) {
    console.error("[auth] Sign-up failed", {
      code: error.code,
      status: error.status,
    });

    if (isRateLimited(error)) {
      return { error: RATE_LIMITED, values };
    }

    // Keep the wording non-committal so the form is not a registration oracle.
    return {
      error: "Could not create that account. If you already have one, sign in.",
      values,
    };
  }

  // No redirect: `[auth.email] enable_confirmations` is on, so signUp() returns
  // `session: null` and @supabase/ssr writes no cookies. Sending the browser to
  // /dashboard would bounce it straight back to /login.
  //
  // An address that already exists but has *not* confirmed lands here too.
  // GoTrue resends the link but does not replace its password or metadata. That
  // ambiguity is why signUp accepts only an email: whichever owner follows the
  // newest link chooses every authoritative value in completeAccountSetup().
  return { confirmationSent: true, values };
}

export async function requestPasswordReset(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const values = submittedValues(formData, ["email"]);
  const parsed = passwordResetSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
  );

  if (error) {
    console.error("[auth] Password-reset request failed", {
      code: error.code,
      status: error.status,
    });

    if (isRateLimited(error)) {
      return { error: RATE_LIMITED, values };
    }

    return {
      error: "Could not send a password-reset link. Try again.",
      values,
    };
  }

  // Supabase deliberately returns success for an unknown address. The panel is
  // identical in both cases, so this action does not become an account oracle.
  return { passwordResetSent: true, values };
}

export async function completeAccountSetup(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const values = submittedValues(formData, ["fullName", "phone"]);
  const parsed = accountSetupSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error("[auth] Account setup could not verify the session", {
      code: userError?.code,
      status: userError?.status,
    });
    return {
      error: "Your setup link is no longer active. Request a new one.",
      values,
    };
  }

  // Write the profile first. If this fails, the unknown pending password is
  // untouched. If the later Auth update fails, retrying is safe: these two
  // profile columns are ordinary current-state data, not an audit record.
  //
  // Selected back rather than written blind: PostgREST answers an UPDATE that
  // matched no row with 204 and a null error, so `profileError` alone cannot
  // tell "written" apart from "no such row". That state is not hypothetical —
  // getCurrentProfile() handles a live session whose profile row is missing —
  // and this is the worst place to let it pass. The password below would still
  // change and the one-time link would still be spent, so the user would be
  // told setup succeeded, land on a dashboard that says their account is not
  // configured, and have no link left to try again with.
  const { data: updatedProfile, error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      phone: parsed.data.phone,
    })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();

  if (profileError || !updatedProfile) {
    console.error("[auth] Account setup could not update the profile", {
      code: profileError?.code,
      // Separates a rejected write from one that silently matched nothing.
      matchedRow: Boolean(updatedProfile),
    });
    return {
      error: "Could not finish setting up your account. Try again.",
      values,
    };
  }

  const { error: passwordError } = await supabase.auth.updateUser({
    password: parsed.data.password,
    data: {
      full_name: parsed.data.fullName,
      phone: parsed.data.phone,
    },
  });

  if (passwordError) {
    console.error("[auth] Account setup could not update credentials", {
      code: passwordError.code,
      status: passwordError.status,
    });

    if (isRateLimited(passwordError)) {
      return { error: RATE_LIMITED, values };
    }

    if (passwordError.code === "same_password") {
      return {
        fieldErrors: { password: ["Choose a different password."] },
        values,
      };
    }

    return {
      error: "Could not finish setting up your account. Try again.",
      values,
    };
  }

  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  // `scope` is not optional in practice: auth-js declares
  // `signOut(options = { scope: 'global' })`, which revokes every refresh token
  // the account holds. The control is labeled "Sign out", not "Sign out
  // everywhere" — and the failure is delayed rather than obvious, because the
  // other device's access-token JWT stays valid until `jwt_expiry` (3600s) and
  // only then bounces off src/proxy.ts to /login (issues #92/#98). A deliberate
  // "sign out everywhere" affordance is a Phase 5 account-settings feature, and
  // `scope: "others"` exists for it.
  const { error } = await supabase.auth.signOut({ scope: "local" });

  if (error) {
    console.error("[auth] Sign-out failed", {
      code: error.code,
      status: error.status,
    });
  }

  // Redirect regardless. signOut() clears the cookies before any network call
  // it makes can fail, so the session is gone locally either way; keeping the
  // user on an authenticated-looking page would be the worse outcome.
  redirect("/login");
}
