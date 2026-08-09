"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createDraftAction } from "@/app/actions/listings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ListingFormState } from "@/lib/validation/listing";

const INITIAL: ListingFormState = { ok: false };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} fullWidth>
      {pending ? "Setting things up…" : label}
    </Button>
  );
}

export function StartListingForm({ hasDrafts }: { hasDrafts: boolean }) {
  const [state, formAction] = useActionState(createDraftAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
      <SubmitButton label={hasDrafts ? "Start another listing" : "Start a listing"} />
    </form>
  );
}
