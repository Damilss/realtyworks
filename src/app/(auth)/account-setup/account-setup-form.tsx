"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError, FormError } from "@/components/ui/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  completeAccountSetup,
  type AuthFormState,
  type AuthFormValues,
} from "@/server/actions/auth";

const initialState: AuthFormState = {};

export function AccountSetupForm({
  initialValues,
}: {
  initialValues: Pick<AuthFormValues, "fullName" | "phone">;
}) {
  const [state, formAction, pending] = useActionState(
    completeAccountSetup,
    initialState,
  );

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
          defaultValue={state.values?.fullName ?? initialValues.fullName}
          aria-invalid={Boolean(state.fieldErrors?.fullName)}
        />
        <FieldError messages={state.fieldErrors?.fullName} />
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
          defaultValue={state.values?.phone ?? initialValues.phone}
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
          aria-invalid={Boolean(state.fieldErrors?.password)}
        />
        <FieldError messages={state.fieldErrors?.password} />
        <p className="text-muted-foreground text-xs">At least 6 characters.</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="passwordConfirmation">Confirm password</Label>
        <Input
          id="passwordConfirmation"
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.passwordConfirmation)}
        />
        <FieldError messages={state.fieldErrors?.passwordConfirmation} />
      </div>

      <FormError message={state.error} />

      <Button type="submit" disabled={pending}>
        {pending ? "Saving account…" : "Finish account setup"}
      </Button>
    </form>
  );
}
