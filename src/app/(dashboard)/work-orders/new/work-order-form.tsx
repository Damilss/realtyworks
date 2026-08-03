"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError, FormError } from "@/components/ui/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Constants, type Enums } from "@/lib/database.types";
import {
  createWorkOrder,
  type WorkOrderFormState,
} from "@/server/actions/work-orders";
import type { PropertyOption } from "@/server/queries/properties";

const initialState: WorkOrderFormState = {};

const PRIORITY_LABEL: Record<Enums<"work_order_priority">, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export function WorkOrderForm({
  properties,
}: {
  properties: PropertyOption[];
}) {
  const [state, formAction, pending] = useActionState(
    createWorkOrder,
    initialState,
  );

  // The unit list depends on the chosen property, and the whole property/unit
  // set already arrived as props — so this filters locally rather than
  // re-fetching per change. Controlled rather than echoed like the rest of the
  // form: React state survives the post-action reset on its own, and the same
  // value has to drive the unit list anyway.
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");

  const units = properties.find((p) => p.id === propertyId)?.units ?? [];

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          required
          maxLength={120}
          // React resets an uncontrolled form after every action, error paths
          // included, so without this a failed submit clears the whole form.
          defaultValue={state.values?.title}
          aria-invalid={Boolean(state.fieldErrors?.title)}
        />
        <FieldError messages={state.fieldErrors?.title} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="propertyId">Property</Label>
          <NativeSelect
            id="propertyId"
            name="propertyId"
            required
            value={propertyId}
            onChange={(event) => setPropertyId(event.target.value)}
            aria-invalid={Boolean(state.fieldErrors?.propertyId)}
          >
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={state.fieldErrors?.propertyId} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="unitId">Unit</Label>
          <NativeSelect
            id="unitId"
            name="unitId"
            defaultValue={state.values?.unitId}
            aria-invalid={Boolean(state.fieldErrors?.unitId)}
          >
            {/* A work order may be property-level: unit_id is nullable, and the
                composite FK passes on NULL (MATCH SIMPLE). */}
            <option value="">Whole property</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={state.fieldErrors?.unitId} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={state.values?.description}
          aria-invalid={Boolean(state.fieldErrors?.description)}
        />
        <FieldError messages={state.fieldErrors?.description} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="priority">Priority</Label>
          <NativeSelect
            id="priority"
            name="priority"
            defaultValue={state.values?.priority ?? "medium"}
            aria-invalid={Boolean(state.fieldErrors?.priority)}
          >
            {Constants.public.Enums.work_order_priority.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABEL[priority]}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={state.fieldErrors?.priority} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="dueDate">Due date</Label>
          <Input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={state.values?.dueDate}
            aria-invalid={Boolean(state.fieldErrors?.dueDate)}
          />
          <FieldError messages={state.fieldErrors?.dueDate} />
        </div>
      </div>

      <FormError message={state.error} />

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create work order"}
        </Button>
      </div>
    </form>
  );
}
