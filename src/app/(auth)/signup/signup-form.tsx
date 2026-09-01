"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError, FormError } from "@/components/ui/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp, type AuthFormState } from "@/server/actions/auth";

const initialState: AuthFormState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  /**
   * Lets the confirmation panel hand the form back.
   *
   * Nothing upstream checks that the address is *deliverable* — GoTrue accepts
   * any syntactically valid one — so a typo like `you@realtyworks.tst` succeeds
   * and the panel then names an address whose link will never arrive. Without
   * this the panel is terminal: `useActionState` exposes no reset, so the only
   * way back is knowing to reload the page.
   *
   * Cleared on submit rather than in the click handler, so the *next* result
   * renders its own panel instead of being suppressed by a stale flag.
   */
  const [editingAddress, setEditingAddress] = useState(false);

  // The account exists but has no session: `[auth.email] enable_confirmations`
  // is on, so there is nothing to redirect to yet. An address whose confirmation
  // is still outstanding lands here too; the wording deliberately fits both.
  //
  // `!pending` is what stops the reset above from undoing itself. `useActionState`
  // keeps the *previous* result for the whole of the next submission, so clearing
  // `editingAddress` on submit re-satisfies this condition immediately: the old
  // panel returns while the corrected address is still in flight, naming the typo
  // the user just fixed and asserting a link was sent that has not been. Its
  // "Use a different address" button is live in that window too, and would hand
  // back a form whose `defaultValue` is the stale echoed email — discarding the
  // correction. A panel is a claim about a settled result, and `pending` is
  // precisely "not settled yet"; the form stays up and reports its own progress.
  if (state.confirmationSent && !editingAddress && !pending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-live="polite">
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="text-muted-foreground text-sm">
          We sent a confirmation link
          {state.values?.email ? (
            <>
              {" to "}
              <span className="text-foreground font-medium">
                {state.values.email}
              </span>
            </>
          ) : null}
          . Follow it to verify your address, then enter your account details
          and choose your password.
        </p>
        <p className="text-muted-foreground text-sm">
          The link is single use and expires in an hour. Until you follow it,
          the account cannot sign in.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditingAddress(true)}
        >
          Use a different address
        </Button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={() => setEditingAddress(false)}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          aria-invalid={Boolean(state.fieldErrors?.email)}
        />
        <FieldError messages={state.fieldErrors?.email} />
      </div>

      <FormError message={state.error} />

      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
