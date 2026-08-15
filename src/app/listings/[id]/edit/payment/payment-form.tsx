"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  claimFeeWaiverAction,
  startListingFeePaymentAction,
  submitForReviewAction,
} from "@/app/actions/listings";
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
  feeLabel,
  paymentAvailable,
  returnedFromPaystack,
}: {
  listingId: string;
  feeSettled: boolean;
  waiversLeft: number;
  canSubmit: boolean;
  missing: string[];
  feeLabel: string;
  paymentAvailable: boolean;
  returnedFromPaystack: boolean;
}) {
  const router = useRouter();
  const [claiming, startClaim] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [paying, setPaying] = useState(false);
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

  async function pay() {
    setState(null);
    setPaying(true);
    const result = await startListingFeePaymentAction(listingId);
    if (result.ok && result.redirectUrl) {
      // Full page navigation to Paystack's hosted checkout — card details are
      // entered on their domain, never ours, so we never handle them.
      window.location.href = result.redirectUrl;
      return;
    }
    setPaying(false);
    setState(result);
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

      {/* Coming back from Paystack proves nothing on its own — anyone can visit
          this URL directly. The payment is only real once Paystack's webhook
          tells our server so, which can lag the redirect by a moment. So the
          message describes what we actually know. */}
      {returnedFromPaystack && !feeSettled && (
        <Alert tone="pending" title="Confirming your payment">
          We&rsquo;re waiting for confirmation from Paystack. This usually takes
          a few seconds — refresh the page shortly. If you were charged and this
          doesn&rsquo;t clear, get in touch and we&rsquo;ll sort it out.
        </Alert>
      )}

      {returnedFromPaystack && feeSettled && (
        <Alert tone="success" title="Payment received">
          Thanks — your listing fee is settled.
        </Alert>
      )}

      {!feeSettled && (
        <>
          {waiversLeft > 0 ? (
            <div className="rounded-lg border border-money-line bg-money-soft p-5">
              <p className="text-lg font-semibold text-money">
                Your listing fee is waived
              </p>
              <p className="mt-2 text-base text-ink">
                We&rsquo;re waiving the first month for our first 50 listings.{" "}
                <span className="tabular font-medium">{waiversLeft}</span>{" "}
                {waiversLeft === 1 ? "is" : "are"} still available, and this
                listing can use one.
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                Nothing to pay now. After the first month this listing is{" "}
                <span className="tabular">{feeLabel}</span> a month to keep up,
                and you can take it down at any time. Commission is separate and
                only ever applies after a deal actually closes.
              </p>
              <div className="mt-4">
                <Button onClick={claim} disabled={claiming} variant="money" fullWidth>
                  {claiming ? "Applying…" : "Use a free listing"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-money-line bg-money-soft p-5">
              <p className="text-lg font-semibold text-money">
                Listing fee: <span className="tabular">{feeLabel}</span> a month
              </p>
              <p className="mt-2 text-base text-ink">
                Our first 50 free months have all been taken, so the listing fee
                applies to this one from the start.
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                This pays for the first month, and you can take the listing down
                at any time. Commission is separate and only ever applies after a
                deal actually closes.
              </p>

              {!paymentAvailable ? (
                <div className="mt-4">
                  <Alert tone="pending">
                    Card payment isn&rsquo;t switched on yet — please get in
                    touch and we&rsquo;ll sort this out with you directly.
                  </Alert>
                </div>
              ) : (
                <div className="mt-4">
                  <Button onClick={pay} disabled={paying} variant="money" fullWidth>
                    {paying ? "Opening payment…" : `Pay ${feeLabel}`}
                  </Button>
                  <p className="mt-2 text-xs text-ink-subtle">
                    You&rsquo;ll be taken to Paystack to pay securely. We never
                    see or store your card details.
                  </p>
                </div>
              )}
            </div>
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
