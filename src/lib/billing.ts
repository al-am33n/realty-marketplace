import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  LISTING_FEE_KOBO,
  chargeAuthorization,
  paystackConfigured,
} from "@/lib/paystack";

/**
 * The monthly listing-fee billing run.
 *
 * CLAUDE.md revenue model: ₦5,000/month, recurring, on independent-agent
 * listings only. This is the part that makes "recurring" true.
 *
 * ---------------------------------------------------------------------------
 * HOW IT RUNS
 *
 * A scheduled request hits /api/billing/run once a day. It is a plain HTTP
 * endpoint rather than a background worker because the free-tier stack has no
 * always-on process to put a worker in — and a daily HTTP call is all a monthly
 * charge needs.
 *
 * Daily, not monthly: each listing has its own anniversary, set when it went
 * live. The run simply asks "which listings are past their paid-up date today?"
 * so nothing depends on the run landing on a particular calendar day, and a run
 * that is missed entirely is caught up by the next one.
 *
 * ---------------------------------------------------------------------------
 * WHY EACH LISTING IS CLAIMED IN THE DATABASE FIRST
 *
 * begin_listing_fee_charge reserves the billing period by INSERTING the payment
 * row before any money moves, and a unique index makes a second reservation for
 * the same period impossible. So the sequence is always:
 *
 *   reserve the period  ->  charge the card  ->  settle the reservation
 *
 * If the process dies between steps 2 and 3, the reservation is left pending
 * and no retry can charge that period again until it is reaped as abandoned —
 * which is the safe direction to fail. An unbilled month costs ₦5,000; a
 * double-billed month costs a landlord's trust.
 * ---------------------------------------------------------------------------
 */

export type BillingRunResult = {
  considered: number;
  charged: number;
  failed: number;
  skipped: number;
  /** Set when the run could not proceed at all, rather than per-listing. */
  halted?: string;
  details: Array<{
    listingId: string;
    outcome: "charged" | "failed" | "skipped";
    reason?: string;
  }>;
};

export async function runListingFeeBilling(
  { limit = 200 }: { limit?: number } = {}
): Promise<BillingRunResult> {
  const result: BillingRunResult = {
    considered: 0,
    charged: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  if (!paystackConfigured()) {
    // Not an error worth alarming about in development, but the run must not
    // silently report success when it charged nothing.
    result.halted = "Paystack is not configured";
    return result;
  }

  const admin = createAdminClient();

  const { data: due, error } = await admin.rpc("listings_due_for_fee", { p_limit: limit });

  if (error) {
    console.error("[billing] could not load due listings", error.message);
    result.halted = "Could not load the listings due for billing";
    return result;
  }

  const listings = due ?? [];
  result.considered = listings.length;

  for (const listing of listings) {
    const record = (outcome: "charged" | "failed" | "skipped", reason?: string) => {
      result[outcome === "charged" ? "charged" : outcome === "failed" ? "failed" : "skipped"] += 1;
      result.details.push({ listingId: listing.listing_id, outcome, reason });
    };

    // A saved card is what makes an unattended charge possible. Without one —
    // the landlord paid by transfer, or their card was removed — there is
    // nothing to charge, and they fall back to paying by hand from the listing's
    // status page during the grace period.
    const { data: auths } = await admin
      .from("billing_authorizations")
      .select("authorization_code")
      .eq("user_id", listing.owner_id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1);

    const authorizationCode = auths?.[0]?.authorization_code;
    if (!authorizationCode) {
      record("skipped", "no saved card — the landlord pays this one by hand");
      continue;
    }

    // Paystack identifies a customer by email, and the authoritative copy lives
    // in auth.users rather than in profiles.
    const { data: userResult } = await admin.auth.admin.getUserById(listing.owner_id);
    const email = userResult?.user?.email;
    if (!email) {
      record("skipped", "no email on file");
      continue;
    }

    // Reserve the period. Nothing below this line can run twice for the same
    // listing and month.
    const { data: claimRows, error: claimError } = await admin.rpc("begin_listing_fee_charge", {
      p_listing_id: listing.listing_id,
      p_amount_kobo: LISTING_FEE_KOBO,
    });

    if (claimError) {
      console.error("[billing] claim failed", listing.listing_id, claimError.message);
      record("skipped", "could not reserve the billing period");
      continue;
    }

    const claim = Array.isArray(claimRows) ? claimRows[0] : undefined;
    if (!claim?.claimed || !claim.reference) {
      record("skipped", claim?.reason ?? "not claimable");
      continue;
    }

    const charge = await chargeAuthorization({
      authorizationCode,
      email,
      reference: claim.reference,
      amountKobo: LISTING_FEE_KOBO,
      listingId: listing.listing_id,
      userId: listing.owner_id,
    });

    // Settle either way. A declined card is an ordinary outcome that has to be
    // written down, not an exception — leaving the reservation pending would
    // block this listing's billing until the reaper cleared it.
    const { error: settleError } = await admin.rpc("settle_listing_fee_charge", {
      p_reference: claim.reference,
      p_succeeded: charge.ok,
      p_payload: (charge.raw ?? null) as never,
    });

    if (settleError) {
      // The money may well have moved. Do NOT retry the charge — the webhook
      // for this same reference will settle it, because settling is idempotent.
      console.error(
        "[billing] settle failed, leaving it to the webhook",
        claim.reference,
        settleError.message
      );
      record("failed", "charged but not recorded — the webhook will settle it");
      continue;
    }

    if (charge.ok) {
      record("charged");
    } else {
      record("failed", charge.message ?? charge.status ?? "the card was declined");
    }
  }

  return result;
}

/**
 * Where a listing stands on its fee, for the owner's own screens.
 *
 * Derived rather than stored: a column saying "overdue" would need something to
 * keep it true as time passes, and would be wrong between the moment a period
 * lapses and the moment the run next notices.
 */
export type ListingBillingState = {
  applies: boolean;
  paidThrough: Date | null;
  overdue: boolean;
  hidden: boolean;
  renewalCancelled: boolean;
  daysOfGraceLeft: number;
};

/** Mirrors listing_fee_grace() in the database. Both must say 7 days. */
export const FEE_GRACE_DAYS = 7;

export function listingBillingState(listing: {
  listing_mode: "independent" | "platform_direct" | null;
  fee_paid_through: string | null;
  renewal_cancelled_at: string | null;
}): ListingBillingState {
  const applies = listing.listing_mode === "independent";
  const paidThrough = listing.fee_paid_through ? new Date(listing.fee_paid_through) : null;

  if (!applies || !paidThrough) {
    return {
      applies,
      paidThrough,
      overdue: false,
      hidden: false,
      renewalCancelled: listing.renewal_cancelled_at !== null,
      daysOfGraceLeft: 0,
    };
  }

  const now = Date.now();
  const overdue = paidThrough.getTime() <= now;
  const graceEnds = paidThrough.getTime() + FEE_GRACE_DAYS * 24 * 60 * 60 * 1000;

  return {
    applies,
    paidThrough,
    overdue,
    hidden: graceEnds <= now,
    renewalCancelled: listing.renewal_cancelled_at !== null,
    daysOfGraceLeft: overdue ? Math.max(0, Math.ceil((graceEnds - now) / 86_400_000)) : 0,
  };
}
