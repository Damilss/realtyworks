"use client";

import { useActionState, useState } from "react";

import { PRIORITY_LABEL } from "@/components/features/work-orders/labels";
import { Button } from "@/components/ui/button";
import { FieldError, FormError } from "@/components/ui/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Constants } from "@/lib/database.types";
import {
  createWorkOrder,
  type WorkOrderFormState,
} from "@/server/actions/work-orders";
import type { PropertyOption } from "@/server/queries/properties";

const initialState: WorkOrderFormState = {};

export function WorkOrderForm({
  properties,
}: {
  properties: PropertyOption[];
}) {
  const [state, formAction, pending] = useActionState(
    createWorkOrder,
    initialState,
  );

  /**
   * Echoed back after a failed submit, exactly like the inputs — but a <select>
   * needs the `key` alongside it to actually move.
   *
   * React resets an uncontrolled form after every action, error paths included.
   * For an <input> that is harmless, because React writes `defaultValue` through
   * to the DOM on every render, so the reset restores the echoed value. It does
   * not do the same for a <select>: the mount-time `defaultValue` is what sets
   * `defaultSelected` on the options, and later renders leave it alone — so the
   * reset returns the field to whatever it mounted with, and the echo is
   * invisible. Making the select controlled does not fix it either: after the
   * reset the `value` prop is unchanged from the previous render, so React's
   * diff writes nothing to the DOM and the element sits desynced from the state
   * that is supposedly driving it — which is worse, because the form then posts
   * a value the user cannot see.
   *
   * Keying on the echoed value remounts the field whenever it differs from what
   * is currently mounted, and a remount is the one moment `defaultValue` is
   * read. When the value is unchanged the reset restores it anyway, so both
   * paths land on the same answer.
   */
  const defaultPropertyId = state.values?.propertyId ?? properties[0]?.id ?? "";
  const defaultUnitId = state.values?.unitId ?? "";
  const defaultPriority = state.values?.priority ?? "medium";

  // Mirrors the property select rather than controlling it: the unit list is
  // filtered locally, because the whole property/unit set already arrived as
  // props and re-fetching per change would be a round trip for data we hold.
  const [propertyId, setPropertyId] = useState(defaultPropertyId);

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
            key={`propertyId:${defaultPropertyId}`}
            id="propertyId"
            name="propertyId"
            required
            defaultValue={defaultPropertyId}
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
          {/* Keyed on the property too: the options below belong to it, so a
              different property has to re-read the default rather than keep an
              index into a list that no longer exists. A unit from the old
              property matches no option and the browser falls back to "Whole
              property", which is the right answer for a selection the composite
              FK would reject anyway. */}
          <NativeSelect
            key={`unitId:${propertyId}:${defaultUnitId}`}
            id="unitId"
            name="unitId"
            defaultValue={defaultUnitId}
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
            key={`priority:${defaultPriority}`}
            id="priority"
            name="priority"
            defaultValue={defaultPriority}
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
