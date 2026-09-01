"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError, FormError } from "@/components/ui/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp, type AuthFormState } from "@/server/actions/auth";

import { useCorrectableAddress } from "../use-correctable-address";

const initialState: AuthFormState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  // The panel is otherwise terminal and a mistyped address is undetectable
  // upstream, so it has to hand the form back. The gate, the reset and the
  // in-flight suppression live in the hook — see its header for why all three
  // are needed and why the copy below is not shared.
  const { showPanel, editAddress, formProps } = useCorrectableAddress(
    state.confirmationSent,
    pending,
  );

  // The account exists but has no session: `[auth.email] enable_confirmations`
  // is on, so there is nothing to redirect to yet. An address whose confirmation
  // is still outstanding lands here too; the wording deliberately fits both.
  if (showPanel) {
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
        <Button type="button" variant="outline" onClick={editAddress}>
          Use a different address
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} {...formProps} className="flex flex-col gap-4">
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
