"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimFeeWaiverAction, submitForReviewAction } from "@/app/actions/listings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ListingFormState } from "@/lib/validation/listing";

/**
 * Claim the free listing, then submit for review.
 *
 * Two separate actions rather than one combined "claim and submit", because
 * they can fail for different reasons and the landlord needs to know which
 * happened — "the free listings ran out" and "your listing is missing photos"
 * call for completely different responses.
 */
export function PaymentForm({
  listingId,
  feeSettled,
  waiversLeft,
  canSubmit,
  missing,
}: {
  listingId: string;
  feeSettled: boolean;
  waiversLeft: number;
  canSubmit: boolean;
  missing: string[];
}) {
  const router = useRouter();
  const [claiming, startClaim] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [state, setState] = useState<ListingFormState | null>(null);
  const [confirming, setConfirming] = useState(false);

  function claim() {
    setState(null);
    startClaim(async () => {
      const result = await claimFeeWaiverAction(listingId);
      setState(result);
      if (result.ok) router.refresh();
    });
  }

  function submit() {
    setState(null);
    startSubmit(async () => {
      // On success this redirects, so nothing after it runs.
      const result = await submitForReviewAction(listingId);
      if (result && !result.ok) setState(result);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {state?.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}

      {!feeSettled && (
        <>
          {waiversLeft > 0 ? (
            <div className="rounded-lg border border-money-line bg-money-soft p-5">
              <p className="text-lg font-semibold text-money">
                Your listing fee is waived
              </p>
              <p className="mt-2 text-base text-ink">
                We&rsquo;re waiving the fee for our first 50 listings.{" "}
                <span className="tabular font-medium">{waiversLeft}</span>{" "}
                {waiversLeft === 1 ? "is" : "are"} still available, and this
                listing can use one.
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                Nothing to pay now, and nothing to pay later on this listing.
                Commission only ever applies after a deal closes.
              </p>
              <div className="mt-4">
                <Button onClick={claim} disabled={claiming} variant="money" fullWidth>
                  {claiming ? "Applying…" : "Use a free listing"}
                </Button>
              </div>
            </div>
          ) : (
            /* Paystack lands here. Being explicit beats a dead button — the
               landlord can see exactly where they stand. */
            <Alert tone="pending" title="Our 50 free listings have all been taken">
              A listing fee applies to this one. Card payment isn&rsquo;t
              switched on yet — please get in touch and we&rsquo;ll sort it out
              with you directly.
            </Alert>
          )}
        </>
      )}

      {feeSettled && (
        <div className="rounded-lg border border-success-line bg-success-soft p-5">
          <p className="font-semibold text-success">Nothing to pay</p>
          <p className="mt-1 text-base text-ink">
            This listing&rsquo;s fee is settled. You can send it for review.
          </p>
        </div>
      )}

      {feeSettled && !canSubmit && (
        <Alert tone="pending" title="A few things still to finish">
          <ul className="mt-1 flex flex-col gap-1">
            {missing.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </Alert>
      )}

      {feeSettled && canSubmit && (
        <>
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
              <div className="mt-4 flex flex-col gap-3">
                <Button onClick={submit} disabled={submitting} fullWidth>
                  {submitting ? "Submitting…" : "Yes, send it for review"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setConfirming(false)}
                  disabled={submitting}
                  fullWidth
                >
                  Not yet
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
