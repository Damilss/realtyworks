"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { loginSchema, signupSchema } from "@/schemas/auth";

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

export type AuthFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

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

/** GoTrue reports throttling as HTTP 429; the code spelling varies by version. */
function isRateLimited(error: { status?: number; code?: string }): boolean {
  return error.status === 429 || error.code === "over_request_rate_limit";
}

export async function signIn(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
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

    return { error: isRateLimited(error) ? RATE_LIMITED : INVALID_CREDENTIALS };
  }

  // Outside any try/catch: redirect() signals by throwing NEXT_REDIRECT, and a
  // catch would swallow it and silently leave the user on the login page.
  redirect("/dashboard");
}

export async function signUp(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    phone: formData.get("phone"),
  });

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Lands in `raw_user_meta_data`, which handle_new_user() reads for the
      // name and phone. It does NOT read that object for the role, and nothing
      // role-shaped is sent here — every self-registration is a 'vendor' with
      // no `vendors` link, and therefore no visibility, until staff link it.
      data: {
        full_name: parsed.data.fullName,
        phone: parsed.data.phone,
      },
    },
  });

  if (error) {
    console.error("[auth] Sign-up failed", {
      code: error.code,
      status: error.status,
    });

    if (isRateLimited(error)) {
      return { error: RATE_LIMITED };
    }

    // With email confirmations off, GoTrue returns `user_already_exists` rather
    // than the obfuscated response it gives when confirmations are on. Keep the
    // wording non-committal so the form is not a registration oracle either.
    return {
      error: "Could not create that account. If you already have one, sign in.",
    };
  }

  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

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
