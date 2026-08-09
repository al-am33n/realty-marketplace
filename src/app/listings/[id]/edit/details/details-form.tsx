"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveDetailsAction } from "@/app/actions/listings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  LISTING_TYPES,
  LISTING_TYPE_LABELS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  TYPES_WITHOUT_ROOMS,
  type ListingFormState,
} from "@/lib/validation/listing";
import type { Listing } from "@/lib/supabase/database.types";

const INITIAL: ListingFormState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth disabled={pending}>
      {pending ? "Saving…" : "Save and continue"}
    </Button>
  );
}

export function DetailsForm({ listing }: { listing: Listing }) {
  // Bind the listing id server-side. It is not a form field, so it cannot be
  // tampered with in the browser — and the action re-checks ownership anyway.
  const action = saveDetailsAction.bind(null, listing.id);
  const [state, formAction] = useActionState(action, INITIAL);

  const values = state.values ?? {};

  // Bedroom and bathroom counts are meaningless for land and commercial units,
  // so those inputs are hidden rather than left to be filled in with noise.
  const [propertyType, setPropertyType] = useState<string>(
    values.property_type || listing.property_type
  );
  const showRoomCounts = !TYPES_WITHOUT_ROOMS.has(propertyType);

  // The stored price is kobo; the input shows whole naira, which is what people
  // think and type in.
  const initialPrice =
    values.price ?? (listing.price_kobo > 1 ? String(Math.round(listing.price_kobo / 100)) : "");

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium text-ink">
          Is this for rent or for sale?
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {LISTING_TYPES.map((type) => (
            <label
              key={type}
              className={cn(
                "flex min-h-touch cursor-pointer items-center justify-center rounded-lg border-2 bg-surface-raised px-4 text-base font-medium transition-colors",
                "border-line-strong hover:border-brand-300",
                "has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-900"
              )}
            >
              <input
                type="radio"
                name="type"
                value={type}
                defaultChecked={(values.type || listing.type) === type}
                className="sr-only-text"
              />
              {LISTING_TYPE_LABELS[type]}
            </label>
          ))}
        </div>
        {state.fieldErrors?.type && (
          <p role="alert" className="text-sm font-medium text-danger">
            {state.fieldErrors.type.join(". ")}
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="property_type" className="text-sm font-medium text-ink">
          Property type
        </label>
        <select
          id="property_type"
          name="property_type"
          value={propertyType}
          onChange={(e) => setPropertyType(e.target.value)}
          className="min-h-touch w-full rounded-lg border border-line-strong bg-surface-raised px-3.5 text-base text-ink"
        >
          {PROPERTY_TYPES.map((type) => (
            <option key={type} value={type}>
              {PROPERTY_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        {state.fieldErrors?.property_type && (
          <p role="alert" className="text-sm font-medium text-danger">
            {state.fieldErrors.property_type.join(". ")}
          </p>
        )}
      </div>

      <Field
        label="Listing title"
        name="title"
        defaultValue={values.title ?? listing.title}
        errors={state.fieldErrors?.title}
        hint="What someone would scan in a list — e.g. “Two bedroom flat in Wuse 2”."
        maxLength={120}
        required
      />

      <Field
        label="Price (₦)"
        name="price"
        // inputMode="decimal" gives phones a number pad while still permitting
        // the commas people naturally type. type="number" would reject them.
        inputMode="decimal"
        defaultValue={initialPrice}
        errors={state.fieldErrors?.price_kobo}
        placeholder="2,500,000"
        hint={
          (values.type || listing.type) === "rent"
            ? "The annual rent, as you'd quote it to a tenant."
            : "The asking price."
        }
        className="tabular"
        required
      />

      {showRoomCounts && (
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Bedrooms"
            name="bedrooms"
            inputMode="numeric"
            defaultValue={values.bedrooms ?? (listing.bedrooms?.toString() || "")}
            errors={state.fieldErrors?.bedrooms}
            placeholder="3"
          />
          <Field
            label="Bathrooms"
            name="bathrooms"
            inputMode="numeric"
            defaultValue={values.bathrooms ?? (listing.bathrooms?.toString() || "")}
            errors={state.fieldErrors?.bathrooms}
            placeholder="2"
          />
        </div>
      )}
      {/* Keep the fields in the submission even when hidden, so the server
          receives a definite empty value rather than nothing at all. */}
      {!showRoomCounts && (
        <>
          <input type="hidden" name="bedrooms" value="" />
          <input type="hidden" name="bathrooms" value="" />
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-medium text-ink">
          Description
        </label>
        <p id="description-hint" className="text-sm text-ink-muted">
          What would you tell someone viewing it? Condition, what&rsquo;s
          nearby, whether service charge is included.
        </p>
        <textarea
          id="description"
          name="description"
          rows={6}
          maxLength={4000}
          aria-describedby="description-hint"
          defaultValue={values.description ?? listing.description}
          className="w-full rounded-lg border border-line-strong bg-surface-raised px-3.5 py-3 text-base text-ink placeholder:text-ink-subtle"
        />
        {state.fieldErrors?.description && (
          <p role="alert" className="text-sm font-medium text-danger">
            {state.fieldErrors.description.join(". ")}
          </p>
        )}
      </div>

      <SubmitButton />
    </form>
  );
}
