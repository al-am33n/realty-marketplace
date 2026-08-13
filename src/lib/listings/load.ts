import { notFound, redirect } from "next/navigation";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import type { Listing } from "@/lib/supabase/database.types";

/**
 * Loads a listing the current user owns, for the edit flow.
 *
 * Returns 404 rather than 403 when the listing is not theirs. That is
 * deliberate: a "you're not allowed to see this" response confirms the listing
 * exists, which lets someone probe for valid listing IDs. "Not found" reveals
 * nothing either way.
 *
 * Note this relies on RLS doing the real work — the query below has no
 * owner_id filter, because the policy already restricts the caller to their own
 * rows plus anything publicly live. The explicit owner check afterwards covers
 * the one case RLS deliberately allows through: a live listing owned by
 * somebody else, which the owner-only edit flow must still refuse.
 */
export async function loadOwnedListing(
  listingId: string,
  /**
   * Where to send the user after signing in. Callers pass their own path so a
   * signed-out visitor returns to the page they actually asked for — without
   * it, someone opening a status link would be dropped into the edit form.
   */
  returnTo = `/listings/${listingId}/edit/details`
): Promise<Listing> {
  const { user } = await getCurrentProfile();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("listings")
    .select("*")
    .eq("id", listingId)
    .maybeSingle();

  if (error) {
    console.error("[loadOwnedListing]", error.message);
    notFound();
  }

  if (!data || data.owner_id !== user.id) {
    notFound();
  }

  return data;
}

/**
 * Statuses whose owner may still edit them.
 *
 * `rejected` is included so an owner can act on the reviewer's feedback — the
 * whole point of rejecting with a reason is that the listing gets fixed and
 * resubmitted. `pending_review` is excluded: once submitted, a listing belongs
 * to the review queue, and letting it change underneath the reviewer would mean
 * they approved something other than what goes live.
 */
export const EDITABLE_STATUSES = ["draft", "rejected"] as const;

/**
 * Same as loadOwnedListing, but also insists the listing is still editable.
 *
 * The RLS update policy would refuse a write to a locked listing anyway — this
 * turns that into a clear redirect instead of a confusing failed save.
 */
export async function loadEditableListing(listingId: string): Promise<Listing> {
  const listing = await loadOwnedListing(listingId);

  if (!(EDITABLE_STATUSES as readonly string[]).includes(listing.status)) {
    redirect(`/listings/${listingId}/status`);
  }

  return listing;
}
