"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError, FormError } from "@/components/ui/form-feedback";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addNote, type WorkOrderFormState } from "@/server/actions/work-orders";

const initialState: WorkOrderFormState = {};

export function AddNoteForm({ workOrderId }: { workOrderId: string }) {
  const [state, formAction, pending] = useActionState(addNote, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workOrderId" value={workOrderId} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="note">Add a note</Label>
        <Textarea
          id="note"
          name="note"
          rows={3}
          required
          maxLength={2000}
          placeholder="What happened?"
          // Echoed back only on failure. On success the action returns no
          // values, so React's post-action reset leaves the box empty — which
          // is what you want after the note has been recorded.
          defaultValue={state.values?.note}
          aria-invalid={Boolean(state.fieldErrors?.note)}
        />
        <FieldError messages={state.fieldErrors?.note} />
      </div>

      <FormError message={state.error} />

      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Adding…" : "Add note"}
        </Button>
      </div>
    </form>
  );
}
