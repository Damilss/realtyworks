"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp, type AuthFormState } from "@/server/actions/auth";

import { FieldError, FormError } from "../form-feedback";

const initialState: AuthFormState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

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

      <FormError message={state.error} />

      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
