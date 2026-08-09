"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { agreeCommissionAction } from "@/app/actions/listings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ListingFormState } from "@/lib/validation/listing";

const INITIAL: ListingFormState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth disabled={pending}>
      {pending ? "Saving…" : "I agree — continue"}
    </Button>
  );
}

export function TermsForm({ listingId }: { listingId: string }) {
  const action = agreeCommissionAction.bind(null, listingId);
  const [state, formAction] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}

      {/* Never pre-ticked. Agreement has to be a deliberate act — both because
          it is the honest thing to do and because a pre-ticked box is far
          weaker evidence that the owner actually accepted the terms. */}
      <label className="flex cursor-pointer gap-3 rounded-lg border-2 border-line-strong bg-surface-raised p-4 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
        <input
          type="checkbox"
          name="agreed"
          className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700"
          aria-describedby="agree-error"
        />
        <span className="text-base text-ink">
          I have read and agree to the commission terms above.
        </span>
      </label>

      {state.fieldErrors?.agreed && (
        <p id="agree-error" role="alert" className="text-sm font-medium text-danger">
          {state.fieldErrors.agreed.join(". ")}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
