"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LISTING_FEE_KOBO, initialiseListingFee, paystackConfigured } from "@/lib/paystack";
import { env } from "@/lib/env";
import type { ListingFormState } from "@/lib/validation/listing";

/**
 * The landlord's own controls over the recurring listing fee.
 *
 * Two things a person can do about a monthly charge: stop it, or pay one that
 * did not go through. Both live here.
 *
 * As with every Server Action, these are reachable by anyone with any
 * arguments, so each re-establishes who is calling. The database checks
 * ownership again underneath — set_listing_renewal compares owner_id to
 * auth.uid() itself, and the renewal check here exists to produce a sentence
 * rather than to be the security boundary.
 */

/**
 * Turn monthly renewal off, or back on.
 *
 * Cancelling does NOT take the listing down. The owner keeps the month they
 * have already paid for and the listing lapses at the end of it — a platform
 * that pulls a listing the instant someone opts out is charging for a service
 * it then withdraws. That rule is enforced in the database (see
 * set_listing_renewal), not just described here.
 */
export async function setListingRenewalAction(
  listingId: string,
  renew: boolean
): Promise<ListingFormState> {
  const { user } = await getCurrentProfile();
  if (!user) return { ok: false, message: "Please sign in again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_listing_renewal", {
    p_listing_id: listingId,
    p_renew: renew,
  });

  if (error) {
    console.error("[setListingRenewal]", error.message);
    return {
      ok: false,
      message: "We couldn't change the renewal setting just now. Please try again.",
    };
  }

  const result = Array.isArray(data) ? data[0] : undefined;

  if (!result?.ok) {
    const messages: Record<string, string> = {
      not_owner: "You can only change this on your own listings.",
      not_found: "We couldn't find that listing.",
    };
    return {
      ok: false,
      message: messages[result?.reason ?? ""] ?? "We couldn't change the renewal setting.",
    };
  }

  revalidatePath(`/listings/${listingId}/status`);
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Pay an overdue month by hand.
 *
 * This is the path for a landlord with no saved card, or one whose card was
 * declined. It matters more than it looks: a card expires eventually for
 * everybody, so "pay this one yourself" is not a lesser fallback, it is the
 * route every account passes through sooner or later.
 *
 * ---------------------------------------------------------------------------
 * THE RESERVATION COMES FIRST, EXACTLY AS IN THE UNATTENDED RUN
 *
 * The billing period is claimed in the database BEFORE Paystack is contacted,
 * and the reference it hands back is the one the checkout uses. That is what
 * stops this becoming a second way to charge a month the daily run is already
 * charging: both go through the same unique index, and whichever gets there
 * first wins.
 *
 * If Paystack cannot be reached after the claim, the reservation is released
 * immediately rather than left to the 30-minute reaper — otherwise a landlord
 * who hit a network blip would be told "a payment is already in progress" for
 * the next half hour, with nothing they could do about it.
 * ---------------------------------------------------------------------------
 */
export async function startFeeRenewalPaymentAction(
  listingId: string
): Promise<ListingFormState & { redirectUrl?: string }> {
  const { user } = await getCurrentProfile();
  if (!user) return { ok: false, message: "Please sign in again." };

  if (!paystackConfigured()) {
    return {
      ok: false,
      message:
        "Card payment isn't switched on yet. Please get in touch and we'll sort "
        + "this out with you directly.",
    };
  }

  // Ownership, through the ordinary client so RLS applies. A listing the caller
  // does not own simply matches no row.
  const supabase = await createClient();
  const { data: listing } = await supabase
    .from("listings")
    .select("id, owner_id, status, listing_mode")
    .eq("id", listingId)
    .maybeSingle();

  if (!listing || listing.owner_id !== user.id) {
    return { ok: false, message: "We couldn't find that listing." };
  }

  // begin_listing_fee_charge is granted to service_role only, because it writes
  // a payments row and payments has no INSERT policy for anyone. The ownership
  // check above is what stands in for RLS across this boundary.
  const admin = createAdminClient();

  const { data: claimRows, error: claimError } = await admin.rpc("begin_listing_fee_charge", {
    p_listing_id: listingId,
    p_amount_kobo: LISTING_FEE_KOBO,
  });

  if (claimError) {
    console.error("[startFeeRenewalPayment] claim", claimError.message);
    return { ok: false, message: "We couldn't start that payment. Please try again." };
  }

  const claim = Array.isArray(claimRows) ? claimRows[0] : undefined;

  if (!claim?.claimed || !claim.reference) {
    const messages: Record<string, string> = {
      not_due:
        "Nothing is owed on this listing at the moment — it's already paid up for "
        + "this period.",
      renewal_cancelled:
        "Renewal is turned off for this listing. Turn it back on first, then the "
        + "fee can be paid.",
      not_live: "Only a live listing is billed, so there's nothing to pay here yet.",
      no_fee_for_mode:
        "Platform-Direct listings have no listing fee — there's nothing to pay.",
      already_in_flight:
        "A payment for this month is already going through. Give it a few minutes "
        + "and refresh this page.",
      not_found: "We couldn't find that listing.",
    };
    return {
      ok: false,
      message: messages[claim?.reason ?? ""] ?? "We couldn't start that payment.",
    };
  }

  const result = await initialiseListingFee({
    email: user.email ?? "",
    listingId,
    userId: user.id,
    reference: claim.reference,
    callbackUrl: `${env.NEXT_PUBLIC_SITE_URL}/listings/${listingId}/status?from=paystack`,
  });

  if (!result.ok) {
    // Hand the period straight back. Marking the attempt failed is what the
    // reaper would eventually do anyway; doing it now means the landlord can
    // press the button again immediately.
    const { error: releaseError } = await admin.rpc("settle_listing_fee_charge", {
      p_reference: claim.reference,
      p_succeeded: false,
      p_payload: null as never,
    });
    if (releaseError) {
      console.error("[startFeeRenewalPayment] release", releaseError.message);
    }
    return { ok: false, message: result.error };
  }

  return { ok: true, redirectUrl: result.authorizationUrl };
}
