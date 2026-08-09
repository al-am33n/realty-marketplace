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
export async function loadOwnedListing(listingId: string): Promise<Listing> {
  const { user } = await getCurrentProfile();
  if (!user) {
    redirect(`/login?next=/listings/${listingId}/edit/details`);
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
 * Same, but also insists the listing is still editable.
 *
 * Once a listing is submitted it belongs to the review queue, and the RLS
 * update policy would refuse the write anyway — this just turns that into a
 * clear redirect instead of a confusing failed save.
 */
export async function loadEditableListing(listingId: string): Promise<Listing> {
  const listing = await loadOwnedListing(listingId);

  if (listing.status !== "draft") {
    redirect(`/listings/${listingId}/status`);
  }

  return listing;
}
