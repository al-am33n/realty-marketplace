"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitForReviewAction } from "@/app/actions/listings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ListingFormState } from "@/lib/validation/listing";

const INITIAL: ListingFormState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth disabled={pending}>
      {pending ? "Submitting…" : "Yes, send it for review"}
    </Button>
  );
}

/**
 * Sends the listing to the review queue.
 *
 * Behind a confirmation step because it is effectively irreversible for the
 * owner: once submitted the listing locks, and only an admin can move it on.
 * app-flow.docx §6 asks every irreversible action to be confirmed.
 */
export function SubmitForReview({ listingId }: { listingId: string }) {
  const action = submitForReviewAction.bind(null, listingId);
  const [state, formAction] = useActionState(action, INITIAL);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}

      {!confirming ? (
        <Button onClick={() => setConfirming(true)} fullWidth>
          Submit for review
        </Button>
      ) : (
        <div className="rounded-lg border border-line-strong bg-surface-raised p-4">
          <p className="font-medium text-ink">Send this listing for review?</p>
          <p className="mt-1 text-sm text-ink-muted">
            You won&rsquo;t be able to edit it while our team checks it —
            usually within 24 hours. We&rsquo;ll email you either way.
          </p>
          <form action={formAction} className="mt-4 flex flex-col gap-3">
            <SubmitButton />
            <Button variant="secondary" onClick={() => setConfirming(false)} fullWidth>
              Not yet
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
