import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, type EmailResult } from "./send";
import {
  feeChargeFailedEmail,
  feeChargedEmail,
  listingApprovedEmail,
  listingRejectedEmail,
  listingSubmittedEmail,
  type EmailContent,
} from "./templates";

/**
 * Sending a listing email, given only a listing id.
 *
 * The address itself lives in `auth.users`, which is Supabase's table, not
 * ours, and is only readable with the service role — so every one of these
 * needs the admin client regardless of who triggered the action. That is why
 * this is one module rather than a lookup repeated in each caller.
 *
 * Nothing here throws. See the note in send.ts: these messages report work that
 * has already been committed, so a mail failure must not surface as a failure
 * of the action itself.
 */

async function ownerEmailAndListing(listingId: string) {
  const admin = createAdminClient();

  const { data: listing, error } = await admin
    .from("listings")
    .select("id, title, owner_id, fee_paid_through")
    .eq("id", listingId)
    .maybeSingle();

  if (error || !listing) {
    console.error("[notify] listing not found", listingId, error?.message);
    return null;
  }

  const { data: userResult } = await admin.auth.admin.getUserById(listing.owner_id);
  const email = userResult?.user?.email;

  if (!email) {
    console.error("[notify] no email on file for owner", listing.owner_id);
    return null;
  }

  return { listing, email };
}

async function deliver(listingId: string, build: (title: string) => EmailContent) {
  try {
    const found = await ownerEmailAndListing(listingId);
    if (!found) return { ok: false, error: "no recipient" } satisfies EmailResult;

    const content = build(found.listing.title);
    return await sendEmail({ to: found.email, ...content });
  } catch (error) {
    console.error("[notify]", error instanceof Error ? error.message : error);
    return { ok: false, error: "failed" } satisfies EmailResult;
  }
}

export function notifyListingApproved(listingId: string) {
  return deliver(listingId, (title) =>
    listingApprovedEmail({ listingTitle: title, listingId })
  );
}

export function notifyListingRejected(listingId: string, reason: string) {
  return deliver(listingId, (title) =>
    listingRejectedEmail({ listingTitle: title, listingId, reason })
  );
}

export function notifyListingSubmitted(listingId: string) {
  return deliver(listingId, (title) =>
    listingSubmittedEmail({ listingTitle: title, listingId })
  );
}

export function notifyFeeChargeFailed(
  listingId: string,
  { graceDays, feeLabel }: { graceDays: number; feeLabel: string }
) {
  return deliver(listingId, (title) =>
    feeChargeFailedEmail({ listingTitle: title, listingId, graceDays, feeLabel })
  );
}

export function notifyFeeCharged(
  listingId: string,
  { feeLabel, paidThrough }: { feeLabel: string; paidThrough: string }
) {
  return deliver(listingId, (title) =>
    feeChargedEmail({ listingTitle: title, listingId, feeLabel, paidThrough })
  );
}
