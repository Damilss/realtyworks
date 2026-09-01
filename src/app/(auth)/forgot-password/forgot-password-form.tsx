"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError, FormError } from "@/components/ui/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestPasswordReset,
  type AuthFormState,
} from "@/server/actions/auth";

const initialState: AuthFormState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    initialState,
  );

  /**
   * Same terminal-panel problem as the signup form, and sharper here: this
   * panel cannot name the address it sent to without becoming the account
   * oracle the wording exists to avoid, so a typo leaves nothing on screen to
   * notice. Handing the form back is the only correction available.
   */
  const [editingAddress, setEditingAddress] = useState(false);

  // `!pending` for the same reason as the signup form, and the consequence is
  // worse here: `useActionState` holds the previous result across the next
  // submission, so without it the panel returns the instant a corrected address
  // is submitted and states that a reset link was sent — before the request that
  // would send it has returned. This panel names no address, so there is nothing
  // on screen to contradict it, and its live "Use a different address" button
  // would restore the stale email over the correction just typed.
  if (state.passwordResetSent && !editingAddress && !pending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-live="polite">
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="text-muted-foreground text-sm">
          If an account matches that address, we sent a password-reset link. It
          is single use and expires in an hour.
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
        {pending ? "Sending link…" : "Send password-reset link"}
      </Button>
    </form>
  );
}
