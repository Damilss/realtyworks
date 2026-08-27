import { z } from "zod";

/**
 * Validation for the auth forms, imported by both the client form and the
 * server action (CLAUDE.md §5 — validate twice, trust once). The client copy is
 * for UX only; the server action re-parses because a server action is a public
 * POST endpoint, and the form only rendering on /login is not a boundary.
 */

/** Matches the `char_length(full_name) <= 120` CHECK on `profiles`. */
const FULL_NAME_MAX_LENGTH = 120;

/**
 * Sanity bound on what a human types into the phone field. This is not the
 * `profiles.phone` CHECK (<= 32): normalization below caps the *stored* value at
 * `+` plus 15 digits, so that CHECK can never fire. This just stops a pasted
 * essay from reaching the normalizer.
 */
const PHONE_MAX_INPUT_LENGTH = 32;

/**
 * E.164 allows at most 15 digits; 10 is the shortest number worth accepting for
 * a US-centric MVP. Phase 5 hands these to Twilio, so normalizing on the way in
 * is what keeps that from starting with a data-cleanup pass.
 */
const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;

/**
 * Reduces a typed phone number to digits, preserving a leading `+`. The
 * formatting humans use — spaces, dashes, parens, dots — carries no
 * information, and storing it means two spellings of one number never compare
 * equal.
 *
 * Returns null when the result isn't a plausible number, so callers get one
 * "invalid" signal instead of having to re-check the length themselves.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) {
    return null;
  }

  return hasPlus ? `+${digits}` : digits;
}

/**
 * `z.string().trim().pipe(z.email())` rather than `z.email().trim()` — the
 * latter validates *before* trimming, so a pasted address with a trailing space
 * is rejected as malformed.
 */
const emailField = z
  .string()
  .trim()
  .pipe(z.email("Enter a valid email address."));

export const loginSchema = z.object({
  email: emailField,
  // Deliberately not the 6-character minimum enforced on signup: a login form
  // that rejects a 5-character password before submitting has disclosed the
  // password policy to anyone who can load the page.
  password: z.string().min(1, "Enter your password."),
});

export const signupSchema = z.object({
  // Everything else is collected only after the emailed link proves ownership.
  // GoTrue resends signup links for an existing unconfirmed address without
  // replacing its password or metadata, so accepting those values here would
  // make the second submit look authoritative when it is not.
  email: emailField,
});

const fullNameField = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(
    FULL_NAME_MAX_LENGTH,
    `Use ${FULL_NAME_MAX_LENGTH} characters or fewer.`,
  );

const phoneField = z
  .string()
  .trim()
  .max(PHONE_MAX_INPUT_LENGTH, "Enter a valid phone number.")
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);

    if (normalized === null) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid phone number.",
      });
      return z.NEVER;
    }

    return normalized;
  });

const passwordField = z.string().min(6, "Use at least 6 characters.");

export const accountSetupSchema = z
  .object({
    fullName: fullNameField,
    // Required even though `profiles.phone` is nullable: SMS is the default
    // notification channel from Phase 5 (CLAUDE.md §6), while seeded and
    // invited accounts may legitimately have no number yet.
    phone: phoneField,
    // Matches [auth] minimum_password_length in supabase/config.toml. Keeping
    // the two in sync means the user sees the rule before GoTrue is called.
    password: passwordField,
    passwordConfirmation: z.string().min(1, "Confirm your password."),
  })
  .refine((values) => values.password === values.passwordConfirmation, {
    message: "Passwords do not match.",
    path: ["passwordConfirmation"],
  });

export const passwordResetSchema = z.object({
  email: emailField,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type AccountSetupInput = z.infer<typeof accountSetupSchema>;
