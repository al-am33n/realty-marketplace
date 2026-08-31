"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setListingRenewalAction,
  startFeeRenewalPaymentAction,
} from "@/app/actions/billing";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ListingFormState } from "@/lib/validation/listing";

/**
 * The two buttons a landlord has over their monthly fee: settle an overdue
 * month, and turn renewal off or back on.
 *
 * Turning renewal OFF asks for confirmation; turning it back on does not. The
 * asymmetry is on purpose — one of those decisions ends with a listing
 * disappearing from search at the end of the month, and the other is instantly
 * reversible. Confirming everything trains people to tap through confirmations
 * without reading them, which is how the one that mattered gets missed.
 */
export function RenewalControls({
  listingId,
  renewalCancelled,
  overdue,
  paymentAvailable,
}: {
  listingId: string;
  renewalCancelled: boolean;
  overdue: boolean;
  paymentAvailable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [paying, setPaying] = useState(false);
  const [state, setState] = useState<ListingFormState | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  function setRenewal(renew: boolean) {
    setState(null);
    setConfirmingCancel(false);
    startTransition(async () => {
      const result = await setListingRenewalAction(listingId, renew);
      setState(result);
      if (result.ok) router.refresh();
    });
  }

  async function pay() {
    setState(null);
    setPaying(true);
    const result = await startFeeRenewalPaymentAction(listingId);
    if (result.ok && result.redirectUrl) {
      // Full page navigation to Paystack's hosted checkout — card details are
      // entered on their domain, never ours.
      window.location.href = result.redirectUrl;
      return;
    }
    setPaying(false);
    setState(result);
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {state?.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}

      {overdue && !renewalCancelled && (
        paymentAvailable ? (
          <Button onClick={pay} disabled={paying} variant="money" fullWidth>
            {paying ? "Opening payment…" : "Settle this month's fee"}
          </Button>
        ) : (
          <Alert tone="pending">
            Card payment isn&rsquo;t switched on yet — please get in touch and
            we&rsquo;ll sort this out with you directly.
          </Alert>
        )
      )}

      {renewalCancelled ? (
        <Button
          variant="secondary"
          onClick={() => setRenewal(true)}
          disabled={pending}
          fullWidth
        >
          {pending ? "Turning renewal on…" : "Turn renewal back on"}
        </Button>
      ) : !confirmingCancel ? (
        <Button
          variant="secondary"
          onClick={() => setConfirmingCancel(true)}
          disabled={pending}
          fullWidth
        >
          Turn off monthly renewal
        </Button>
      ) : (
        <div className="rounded-lg border border-line-strong bg-surface-raised p-4">
          <p className="font-medium text-ink">Turn off monthly renewal?</p>
          <p className="mt-1 text-sm text-ink-muted">
            Your listing stays live for the rest of the month you&rsquo;ve
            already paid for — we won&rsquo;t take anything else. After that it
            stops appearing in search. You can turn renewal back on at any time,
            and nothing needs reviewing again.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <Button
              variant="secondary"
              onClick={() => setRenewal(false)}
              disabled={pending}
              fullWidth
            >
              {pending ? "Turning renewal off…" : "Yes, turn off renewal"}
            </Button>
            <Button
              onClick={() => setConfirmingCancel(false)}
              disabled={pending}
              fullWidth
            >
              Keep it renewing
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
