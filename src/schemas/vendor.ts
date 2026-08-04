import { z } from "zod";

/**
 * Validation for the vendor forms, imported by both the client form and the
 * server actions (CLAUDE.md §5 — validate twice, trust once). As with
 * `./work-order.ts`, none of this is the boundary: `vendors_insert_staff` picks
 * who may write, `grant insert (name, phone, email)` picks which columns, and
 * `vendors_contact_method` is what actually guarantees a vendor is reachable.
 * These bounds mirror `20260717120400_create_vendors.sql` so the user hears
 * about a problem before the round trip instead of as a raw SQLSTATE.
 */

/** `char_length(name) between 1 and 120` on `vendors`. */
const NAME_MAX_LENGTH = 120;

/**
 * No length CHECK on `vendors.phone`/`vendors.email` in the migration, so these
 * are product limits rather than mirrors. Generous enough not to reject a real
 * value, bounded so a server action — a public POST endpoint — cannot be handed
 * an unbounded string that comes straight back out in the echoed state.
 */
const PHONE_MAX_LENGTH = 32;
const EMAIL_MAX_LENGTH = 254;

/** Same reasoning as the twin in ./work-order.ts: `""` from a form is "unset". */
const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalPhone = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(PHONE_MAX_LENGTH, `Use ${PHONE_MAX_LENGTH} characters or fewer.`)
    .nullable(),
);

/**
 * Email is validated as an email, not merely as text: it is the address the
 * magic-link invite is minted against, and `auth.admin.createUser` rejects a
 * malformed one with an error the vendor form cannot usefully translate.
 */
const optionalEmail = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(EMAIL_MAX_LENGTH, `Use ${EMAIL_MAX_LENGTH} characters or fewer.`)
    .pipe(z.email("Enter a valid email address."))
    .nullable(),
);

/**
 * Exactly the three columns `authenticated` holds an INSERT grant on.
 * `profile_id` is absent by design, not by omission — the auth link is written
 * only by the invite action through the service role, so it cannot be forged or
 * moved from the API. `created_by` defaults to `auth.uid()`.
 *
 * The refine mirrors `vendors_contact_method`, which is
 * `nullif(trim(phone), '') is not null or nullif(trim(email), '') is not null`.
 * Whitespace-only input therefore has to fail here too: `emptyToNull` above
 * already collapses `'   '` to null, so this check sees exactly what the
 * constraint sees. Without it the user gets a bare 23514 for a rule no field on
 * the form mentions.
 */
export const createVendorSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter a name.")
      .max(NAME_MAX_LENGTH, `Use ${NAME_MAX_LENGTH} characters or fewer.`),
    phone: optionalPhone,
    email: optionalEmail,
  })
  .refine((vendor) => vendor.phone !== null || vendor.email !== null, {
    // Reported on `email` rather than at the form root: it is the field a
    // vendor actually needs filled in to be invitable, so pointing there is
    // the actionable half of "one of these two is required".
    path: ["email"],
    message: "Enter an email address or a phone number.",
  });

/**
 * The invite takes only the vendor row and the job to deep-link at. Everything
 * else — the email to mint the link against, whether an account already exists —
 * is read server-side, because the client is not trusted to say which address a
 * vendor row belongs to.
 */
export const inviteVendorSchema = z.object({
  vendorId: z.guid(),
  workOrderId: z.guid(),
});

export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type InviteVendorInput = z.infer<typeof inviteVendorSchema>;
