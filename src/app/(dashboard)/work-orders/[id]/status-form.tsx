"use client";

import { useActionState } from "react";

import { STATUS_LABEL } from "@/components/features/work-orders/labels";
import { Button } from "@/components/ui/button";
import { FieldError, FormError } from "@/components/ui/form-feedback";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { VENDOR_STATUSES } from "@/schemas/work-order";
import {
  updateWorkOrderStatus,
  type WorkOrderFormState,
} from "@/server/actions/work-orders";

const initialState: WorkOrderFormState = {};

export function StatusForm({
  workOrderId,
  currentStatus,
}: {
  workOrderId: string;
  currentStatus: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateWorkOrderStatus,
    initialState,
  );

  // Echoed and keyed together, for the reason spelled out on the assign form:
  // React's post-action reset puts a <select> back to the option it mounted
  // with, so without the key a failed submit silently reverts the choice.
  const defaultStatus =
    state.values?.status ??
    (VENDOR_STATUSES as readonly string[]).find(
      (status) => status === currentStatus,
    ) ??
    "";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workOrderId" value={workOrderId} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="status">Status</Label>
        <NativeSelect
          key={`status:${defaultStatus}`}
          id="status"
          name="status"
          required
          defaultValue={defaultStatus}
          aria-invalid={Boolean(state.fieldErrors?.status)}
        >
          <option value="" disabled>
            Choose a status…
          </option>
          {/* Only the two `guard_work_order_update()` admits for a vendor.
              Cancelling is a staff decision, and reopening a job is not a
              progress report — the trigger raises 42501 on either. */}
          {VENDOR_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </NativeSelect>
        <FieldError messages={state.fieldErrors?.status} />
      </div>

      <FormError message={state.error} />

      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Update status"}
        </Button>
      </div>
    </form>
  );
}
