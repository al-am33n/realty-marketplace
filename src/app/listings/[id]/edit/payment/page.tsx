import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ListingStepper } from "@/components/listings/listing-stepper";
import { createClient } from "@/lib/supabase/server";
import { loadEditableListing } from "@/lib/listings/load";
import { readyToSubmit, stepCompletion, stepPath } from "@/lib/listings/steps";
import { LISTING_FEE_KOBO, paystackConfigured } from "@/lib/paystack";
import { formatNaira } from "@/lib/utils";
import { PaymentForm } from "./payment-form";

export const metadata: Metadata = {
  title: "Listing fee",
};

/**
 * Step 6 — the listing fee (app-flow.docx §1: "Paystack checkout, skipped
 * automatically if within the first-50 waiver window, with a visible 'fee
 * waived' message instead").
 *
 * Only the waiver path is built. That is not a stopgap for the launch itself:
 * the first 50 listings are free by design, so the entire soft-launch cohort
 * goes through this path and never sees a payment screen. Paystack becomes
 * necessary at listing 51.
 */
export default async function ListingPaymentStep({
  params,
  searchParams,
}: PageProps<"/listings/[id]/edit/payment">) {
  const { id } = await params;
  const query = await searchParams;
  const listing = await loadEditableListing(id);

  // A Platform-Direct listing has no fee step at all — see listingSteps(). This
  // URL is still reachable by hand or from an old bookmark, so send them to the
  // step that actually follows the terms for their listing rather than showing
  // a fee screen for a fee that does not exist.
  if (listing.listing_mode === "platform_direct") {
    redirect(stepPath(listing.id, "preview"));
  }

  // Read-only pool state. A separate function from the claim on purpose —
  // simply viewing this page must not consume a waiver.
  const supabase = await createClient();
  const { data: poolRows } = await supabase.rpc("listing_fee_waiver_status");
  const pool = Array.isArray(poolRows) ? poolRows[0] : undefined;
  const waiversLeft = pool?.waivers_left ?? 0;

  const feeSettled = listing.listing_fee_paid || listing.fee_waived;
  const done = stepCompletion(listing);

  const missing = [
    !done.details && "The property details",
    !done.photos && "At least 3 photos",
    !done.location && "The location and map pin",
    !done.terms && "The commission agreement",
  ].filter(Boolean) as string[];

  return (
    <>
      <ListingStepper listing={listing} current="payment" />

      <h1 className="text-2xl font-semibold text-brand-900">Listing fee</h1>
      <p className="mt-2 mb-6 text-base text-ink-muted">
        The last step before your listing goes to our review team.
      </p>

      <PaymentForm
        listingId={listing.id}
        feeSettled={feeSettled}
        waiversLeft={waiversLeft}
        canSubmit={readyToSubmit(listing)}
        missing={missing}
        feeLabel={formatNaira(LISTING_FEE_KOBO)}
        paymentAvailable={paystackConfigured()}
        returnedFromPaystack={query.from === "paystack"}
      />

      <p className="mt-8 text-sm text-ink-subtle">
        We never collect any payment from a renter or buyer before a viewing is
        confirmed, and we never hold your sale proceeds or rent.
      </p>
    </>
  );
}
