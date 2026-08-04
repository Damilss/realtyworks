"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError, FormError } from "@/components/ui/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createVendor, type VendorFormState } from "@/server/actions/vendors";

const initialState: VendorFormState = {};

export function VendorForm() {
  const [state, formAction, pending] = useActionState(
    createVendor,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          placeholder="Bob's Handyman Services"
          // Echoed back on every failure path. React resets an uncontrolled
          // form after *every* function action, errors included, so anything
          // not echoed here is retyped (CLAUDE.md §0).
          defaultValue={state.values?.name}
          aria-invalid={Boolean(state.fieldErrors?.name)}
        />
        <FieldError messages={state.fieldErrors?.name} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          maxLength={254}
          placeholder="bob@example.com"
          defaultValue={state.values?.email}
          aria-invalid={Boolean(state.fieldErrors?.email)}
        />
        <FieldError messages={state.fieldErrors?.email} />
        <p className="text-muted-foreground text-sm">
          Needed to send this vendor a login link. A vendor with only a phone
          number can be recorded now and invited once text-message delivery
          arrives.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          maxLength={32}
          placeholder="+15551230000"
          defaultValue={state.values?.phone}
          aria-invalid={Boolean(state.fieldErrors?.phone)}
        />
        <FieldError messages={state.fieldErrors?.phone} />
      </div>

      <FormError message={state.error} />

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add vendor"}
        </Button>
      </div>
    </form>
  );
}
