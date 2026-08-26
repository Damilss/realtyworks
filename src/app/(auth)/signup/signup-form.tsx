"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError, FormError } from "@/components/ui/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp, type AuthFormState } from "@/server/actions/auth";

const initialState: AuthFormState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  // The account exists but has no session: `[auth.email] enable_confirmations`
  // is on, so there is nothing to redirect to and nothing left to submit. The
  // form is replaced rather than merely annotated, because leaving it on screen
  // invites a second submit that only re-sends the same email.
  //
  // An address whose confirmation is still outstanding lands here too — GoTrue
  // resends the link rather than refusing — so this panel is what both a new
  // registration and a second attempt at one see.
  if (state.confirmationSent) {
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
          . Follow it to finish setting up your account.
        </p>
        <p className="text-muted-foreground text-sm">
          The link is single use and expires in an hour. Until you follow it,
          the account cannot sign in.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          // React resets an uncontrolled form after every action, error paths
          // included. Without these defaults one bad phone number costs the
          // user every field on the form.
          defaultValue={state.values?.fullName}
          aria-invalid={Boolean(state.fieldErrors?.fullName)}
        />
        <FieldError messages={state.fieldErrors?.fullName} />
      </div>

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

      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+1 555 123 4567"
          required
          // As typed, not normalized — the number being corrected should read
          // back the way it was entered.
          defaultValue={state.values?.phone}
          aria-invalid={Boolean(state.fieldErrors?.phone)}
        />
        <FieldError messages={state.fieldErrors?.phone} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          // No defaultValue on purpose: the action never echoes a password
          // back, so this one field clears on failure.
          aria-invalid={Boolean(state.fieldErrors?.password)}
        />
        <FieldError messages={state.fieldErrors?.password} />
        <p className="text-muted-foreground text-xs">At least 6 characters.</p>
      </div>

      <FormError message={state.error} />

      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
