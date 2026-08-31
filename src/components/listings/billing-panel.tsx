import { RenewalControls } from "@/components/listings/renewal-controls";
import {
  FEE_GRACE_DAYS,
  cardHasExpired,
  listingBillingState,
  type SavedCard,
} from "@/lib/billing";
import { LISTING_FEE_KOBO } from "@/lib/paystack";
import { formatNaira } from "@/lib/utils";
import type { Listing } from "@/lib/supabase/database.types";

/**
 * Where a landlord sees what their listing costs and when.
 *
 * UI spec: every state says what is happening AND what to do about it. That
 * matters most here, because the states this panel describes are the ones that
 * end with a listing quietly vanishing from search — "overdue" with no visible
 * deadline and no button is precisely the dead end the spec exists to prevent.
 *
 * Nothing is shown for a Platform-Direct listing. It owes no fee at all, and a
 * panel reading "nothing to pay" would imply a fee exists and was let off,
 * which misdescribes the arrangement: the platform is paid out of commission
 * instead, and only if the sale closes.
 */

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function cardLabel(card: SavedCard): string {
  const brand = card.cardType ? card.cardType.replace(/\b\w/g, (c) => c.toUpperCase()) : "Card";
  return card.last4 ? `${brand} ending ${card.last4}` : brand;
}

export function BillingPanel({
  listing,
  savedCard,
  paymentAvailable,
}: {
  listing: Listing;
  savedCard: SavedCard | null;
  paymentAvailable: boolean;
}) {
  const state = listingBillingState(listing);

  // Not an independent listing, or billing has not started yet because the
  // listing has never been live. Either way there is nothing true to say.
  if (!state.applies || !state.paidThrough) return null;

  const feeLabel = formatNaira(LISTING_FEE_KOBO);
  const expiredCard = cardHasExpired(savedCard);

  const tone = state.hidden
    ? "border-danger-line bg-danger-soft"
    : state.overdue
      ? "border-pending-line bg-pending-soft"
      : "border-line bg-surface-raised";

  return (
    <section className={`mt-6 rounded-lg border p-5 ${tone}`}>
      <h2 className="font-semibold text-ink">Listing fee</h2>

      {state.hidden ? (
        <p className="mt-2 text-base text-ink">
          This listing is <strong>hidden from search</strong> because the{" "}
          <span className="tabular">{feeLabel}</span> monthly fee is unpaid. It
          hasn&rsquo;t been deleted and it doesn&rsquo;t need reviewing again —
          settling the fee brings it straight back.
        </p>
      ) : state.overdue ? (
        <p className="mt-2 text-base text-ink">
          This month&rsquo;s <span className="tabular">{feeLabel}</span> fee
          hasn&rsquo;t gone through yet. Your listing stays visible for{" "}
          <span className="tabular">{state.daysOfGraceLeft}</span> more{" "}
          {state.daysOfGraceLeft === 1 ? "day" : "days"}, then it&rsquo;s hidden
          from search until it&rsquo;s settled.
        </p>
      ) : state.renewalCancelled ? (
        <p className="mt-2 text-base text-ink">
          Renewal is <strong>off</strong>. This listing stays live until{" "}
          <span className="tabular">{formatDate(state.paidThrough)}</span> — the
          month you&rsquo;ve already paid for — and then stops appearing in
          search. Nothing further will be charged.
        </p>
      ) : (
        <p className="mt-2 text-base text-ink">
          Paid up to{" "}
          <span className="tabular">{formatDate(state.paidThrough)}</span>. We
          take <span className="tabular">{feeLabel}</span> a month after that,
          and you can turn renewal off whenever you like.
        </p>
      )}

      {/* The card is stated plainly, including its absence. "We'll charge your
          card" is not a claim to make when there is no card on file. */}
      <p className="mt-3 text-sm text-ink-muted">
        {savedCard ? (
          expiredCard ? (
            <>
              Your saved card ({cardLabel(savedCard)}) has expired, so the next
              renewal won&rsquo;t go through. Settling a fee here saves the new
              card in its place.
            </>
          ) : (
            <>
              We renew this from your saved card ({cardLabel(savedCard)}). We
              never see or store the card number itself — only these last digits
              and a token Paystack gives us.
            </>
          )
        ) : (
          <>
            There&rsquo;s no card saved for this account, so each month is paid
            by hand from this page. Paying here once saves the card, and after
            that renewal is automatic.
          </>
        )}
      </p>

      {!state.overdue && !state.renewalCancelled && (
        <p className="mt-2 text-sm text-ink-subtle">
          If a payment ever fails you get {FEE_GRACE_DAYS} days before the
          listing is hidden, and we email you as soon as it happens.
        </p>
      )}

      <RenewalControls
        listingId={listing.id}
        renewalCancelled={state.renewalCancelled}
        overdue={state.overdue}
        paymentAvailable={paymentAvailable}
      />
    </section>
  );
}
