"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError, FormError } from "@/components/ui/form-feedback";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  assignVendor,
  type WorkOrderFormState,
} from "@/server/actions/work-orders";
import type { VendorOption } from "@/server/queries/vendors";

const initialState: WorkOrderFormState = {};

export function AssignVendorForm({
  workOrderId,
  vendors,
  currentVendorId,
}: {
  workOrderId: string;
  vendors: VendorOption[];
  currentVendorId: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    assignVendor,
    initialState,
  );

  // Echoed and keyed together. React's post-action reset puts a <select> back to
  // the option it mounted with, and neither a changed `defaultValue` nor a
  // controlled `value` moves an already-mounted one — so without the key a
  // failed assignment drops the vendor just chosen and silently shows the
  // current one again. The full reasoning is on the create form.
  const defaultVendorId = state.values?.vendorId ?? currentVendorId ?? "";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workOrderId" value={workOrderId} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="vendorId">Vendor</Label>
        <NativeSelect
          key={`vendorId:${defaultVendorId}`}
          id="vendorId"
          name="vendorId"
          required
          defaultValue={defaultVendorId}
          aria-invalid={Boolean(state.fieldErrors?.vendorId)}
        >
          {/* No "unassign" option: clearing vendor_id would violate
              work_orders_assigned_has_vendor unless status moved back too, and
              that is a separate decision from picking a different vendor. */}
          <option value="" disabled>
            Choose a vendor…
          </option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </NativeSelect>
        <FieldError messages={state.fieldErrors?.vendorId} />
      </div>

      <FormError message={state.error} />

      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending
            ? "Saving…"
            : currentVendorId
              ? "Reassign vendor"
              : "Assign vendor"}
        </Button>
      </div>
    </form>
  );
}
