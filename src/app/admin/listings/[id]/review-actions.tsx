"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { approveListingAction, rejectListingAction } from "@/app/actions/admin";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ListingFormState } from "@/lib/validation/listing";

const INITIAL: ListingFormState = { ok: false };

function ApproveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} fullWidth>
      {pending ? "Approving…" : "Approve and publish"}
    </Button>
  );
}

function RejectButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={pending} fullWidth>
      {pending ? "Rejecting…" : "Reject with this reason"}
    </Button>
  );
}

/**
 * Approve / reject controls.
 *
 * Both are irreversible from the landlord's point of view — approving makes a
 * property publicly visible, rejecting sends them a message — so each sits
 * behind a confirmation step rather than a single tap, per the UI spec's
 * confirmation-dialog pattern for irreversible actions.
 */
export function ReviewActions({ listingId }: { listingId: string }) {
  const approve = approveListingAction.bind(null, listingId);
  const reject = rejectListingAction.bind(null, listingId);

  const [approveState, approveAction] = useActionState(approve, INITIAL);
  const [rejectState, rejectAction] = useActionState(reject, INITIAL);

  const [mode, setMode] = useState<"idle" | "confirmApprove" | "reject">("idle");

  return (
    <div className="flex flex-col gap-4">
      {approveState.message && !approveState.ok && (
        <Alert tone="danger">{approveState.message}</Alert>
      )}
      {rejectState.message && !rejectState.ok && (
        <Alert tone="danger">{rejectState.message}</Alert>
      )}

      {mode === "idle" && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => setMode("confirmApprove")} fullWidth>
            Approve
          </Button>
          <Button variant="secondary" onClick={() => setMode("reject")} fullWidth>
            Reject
          </Button>
        </div>
      )}

      {mode === "confirmApprove" && (
        <div className="rounded-lg border border-line-strong bg-surface-raised p-4">
          <p className="font-medium text-ink">Publish this listing?</p>
          <p className="mt-1 text-sm text-ink-muted">
            It becomes visible to everyone browsing the site, and renters can
            request viewings on it.
          </p>
          <form action={approveAction} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <ApproveButton />
            <Button variant="secondary" onClick={() => setMode("idle")} fullWidth>
              Cancel
            </Button>
          </form>
        </div>
      )}

      {mode === "reject" && (
        <form
          action={rejectAction}
          className="rounded-lg border border-line-strong bg-surface-raised p-4"
        >
          <label htmlFor="reason" className="font-medium text-ink">
            Why is this being rejected?
          </label>
          <p id="reason-hint" className="mt-1 text-sm text-ink-muted">
            The landlord sees this exact text, and nothing else. Be specific
            about what to change so they can fix it and resubmit.
          </p>
          <textarea
            id="reason"
            name="reason"
            rows={4}
            required
            aria-describedby="reason-hint"
            defaultValue={rejectState.values?.reason}
            placeholder="e.g. The photos show a different property from the one described, and the price looks like it's missing a zero."
            className="mt-3 w-full rounded-lg border border-line-strong bg-surface px-3.5 py-3 text-base text-ink placeholder:text-ink-subtle"
          />
          {rejectState.fieldErrors?.reason && (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">
              {rejectState.fieldErrors.reason.join(". ")}
            </p>
          )}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <RejectButton />
            <Button variant="secondary" onClick={() => setMode("idle")} fullWidth>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
