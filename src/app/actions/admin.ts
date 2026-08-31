"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import {
  rejectListingSchema,
  toFieldErrors,
  type ListingFormState,
} from "@/lib/validation/listing";
import { notifyListingApproved, notifyListingRejected } from "@/lib/email/notify";

/**
 * Admin moderation actions (app-flow.docx §5).
 *
 * Approving a listing is the single most consequential action in the product:
 * it is the step that makes a property publicly visible, and the manual review
 * behind it is the platform's primary fraud control.
 *
 * Note these use the ordinary authenticated client, NOT the admin/service-role
 * client. That is deliberate. The RLS policy "listings: admin updates any"
 * already permits exactly this for admins and refuses it for everyone else, so
 * the database re-checks the caller's role on every statement. Reaching for the
 * service role here would bypass that check and leave the role test resting on
 * the `if` statement below alone.
 */

async function requireAdmin() {
  const { user, profile } = await getCurrentProfile();
  if (!user || !profile) redirect("/login?next=/admin/listings");
  if (profile.role !== "admin") {
    // 404 rather than 403: no reason to confirm to a non-admin that an admin
    // area exists at this address.
    redirect("/dashboard");
  }
  return { user, profile };
}

/** Approve a listing and make it publicly visible. */
// Only the bound listingId is declared — approving needs no form fields, and
// the bound zero-argument result still satisfies useActionState.
export async function approveListingAction(
  listingId: string
): Promise<ListingFormState | never> {
  await requireAdmin();

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("listings")
    .update({
      status: "live",
      published_at: new Date().toISOString(),
      // Clear stale reviewer feedback from a previous rejection so it cannot
      // resurface against a listing that is now approved.
      rejection_reason: null,
    })
    .eq("id", listingId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[approveListing]", error.message);
    // The most likely cause is the database refusing a listing whose fee is
    // not settled (listings_live_requires_settled_fee), so name that rather
    // than showing a bare failure.
    return {
      ok: false,
      message:
        "Couldn't approve this listing. Check that its listing fee is paid or waived.",
    };
  }

  if (!data) {
    return {
      ok: false,
      message: "That listing is no longer awaiting review — someone may have already handled it.",
    };
  }

  // Awaited before the redirect, not fired and forgotten. A serverless
  // function can be frozen the moment its response is sent, so an un-awaited
  // request is not "sent in the background" — it is quite likely never sent at
  // all. Waiting costs the admin a fraction of a second.
  //
  // The result is deliberately not checked: the listing is already live, and a
  // mail failure must not turn a completed approval into an error the admin
  // would then retry. sendEmail logs its own failures.
  await notifyListingApproved(listingId);

  revalidatePath("/admin/listings");
  redirect("/admin/listings?approved=1");
}

/** Reject a listing, with a reason the landlord will see. */
export async function rejectListingAction(
  listingId: string,
  _prevState: ListingFormState,
  formData: FormData
): Promise<ListingFormState | never> {
  await requireAdmin();

  const reason = String(formData.get("reason") ?? "");
  const parsed = rejectListingSchema.safeParse({ reason });

  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: toFieldErrors(parsed.error),
      values: { reason },
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("listings")
    .update({
      status: "rejected",
      rejection_reason: parsed.data.reason,
    })
    .eq("id", listingId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[rejectListing]", error.message);
    return {
      ok: false,
      message: "Couldn't reject this listing. Please try again.",
      values: { reason },
    };
  }

  if (!data) {
    return {
      ok: false,
      message: "That listing is no longer awaiting review — someone may have already handled it.",
      values: { reason },
    };
  }

  // The reason is the whole message. It also stays on the listing's status
  // page, so a landlord whose email is lost is not left guessing.
  await notifyListingRejected(listingId, parsed.data.reason);

  revalidatePath("/admin/listings");
  redirect("/admin/listings?rejected=1");
}
