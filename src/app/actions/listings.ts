"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { EDITABLE_STATUSES } from "@/lib/listings/load";
import { CLOUDINARY_CLOUD_NAME, MAX_PHOTOS_PER_LISTING, listingFolder } from "@/lib/cloudinary";
import { initialiseListingFee, paystackConfigured } from "@/lib/paystack";
import { env } from "@/lib/env";
import { readyToSubmit, stepCompletion, stepPath } from "@/lib/listings/steps";
import {
  commissionClauseSchema,
  listingDetailsSchema,
  listingLocationSchema,
  toFieldErrors,
  type ListingFormState,
} from "@/lib/validation/listing";
import { COMMISSION_CLAUSE_VERSION } from "@/lib/listings/commission-clause";

/**
 * Server Actions for the listing form.
 *
 * As with the auth actions, these are effectively public endpoints: anyone can
 * call them with any arguments. So each one re-establishes who the caller is
 * and what they may touch, rather than trusting the page that rendered the
 * form. RLS is the backstop underneath — a query for a listing the user does
 * not own simply matches no rows.
 */

/**
 * Starts a new draft, or hands back the caller's existing empty draft.
 *
 * Reusing an empty draft matters because this runs on a button press: a double
 * tap on a slow connection would otherwise leave two half-built listings
 * cluttering the dashboard.
 */
// Takes no parameters: it needs neither the previous state nor any form field.
// A zero-argument function is still assignable to what useActionState expects,
// so this stays compatible without declaring arguments it would never read.
export async function createDraftAction(): Promise<ListingFormState | never> {
  const { user, profile } = await getCurrentProfile();

  if (!user || !profile) {
    redirect("/login?next=/listings/new");
  }

  if (profile.role !== "landlord" && profile.role !== "agent") {
    return {
      ok: false,
      message:
        "Only landlord and agent accounts can create listings. "
        + "Get in touch if your account type needs changing.",
    };
  }

  // Mirrors the RLS policy on listings INSERT. Checking here too means the user
  // gets a sentence they can act on rather than a bare permission error.
  if (!profile.verified) {
    redirect("/verify");
  }

  const supabase = await createClient();

  const { data: existingDrafts, error: lookupError } = await supabase
    .from("listings")
    .select("id, title")
    .eq("owner_id", user.id)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1);

  if (lookupError) {
    console.error("[createDraft] lookup", lookupError.message);
    return { ok: false, message: "We couldn't start a new listing just now. Please try again." };
  }

  const reusable = existingDrafts?.[0];
  if (reusable && !reusable.title) {
    redirect(stepPath(reusable.id, "details"));
  }

  const { data: created, error: insertError } = await supabase
    .from("listings")
    .insert({
      owner_id: user.id,
      // Placeholders that satisfy NOT NULL while the draft is being filled in.
      // The DB length constraint on title only bites when the listing leaves
      // draft, which is exactly why an empty-ish draft is allowed to exist.
      title: "",
      type: "rent",
      property_type: "apartment",
      price_kobo: 1,
      location_text: "",
      status: "draft",
    })
    .select("id")
    .single();

  if (insertError || !created) {
    console.error("[createDraft] insert", insertError?.message);
    return {
      ok: false,
      message: "We couldn't start a new listing just now. Please try again.",
    };
  }

  revalidatePath("/dashboard");
  redirect(stepPath(created.id, "details"));
}

/** Step 1 — save the details and move on to photos. */
export async function saveDetailsAction(
  listingId: string,
  _prevState: ListingFormState,
  formData: FormData
): Promise<ListingFormState | never> {
  const raw = {
    title: String(formData.get("title") ?? ""),
    type: String(formData.get("type") ?? ""),
    property_type: String(formData.get("property_type") ?? ""),
    price_kobo: String(formData.get("price") ?? ""),
    bedrooms: String(formData.get("bedrooms") ?? ""),
    bathrooms: String(formData.get("bathrooms") ?? ""),
    description: String(formData.get("description") ?? ""),
  };

  // Echo back what was typed so a rejected submit does not clear the form.
  const values = {
    title: raw.title,
    type: raw.type,
    property_type: raw.property_type,
    price: raw.price_kobo,
    bedrooms: raw.bedrooms,
    bathrooms: raw.bathrooms,
    description: raw.description,
  };

  const parsed = listingDetailsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error), values };
  }

  const supabase = await createClient();

  // No separate ownership check is needed for safety: RLS restricts this UPDATE
  // to rows the caller owns, so a forged listingId matches nothing. The status
  // filter additionally blocks edits to a listing already under review.
  const { data, error } = await supabase
    .from("listings")
    .update({
      title: parsed.data.title,
      type: parsed.data.type,
      property_type: parsed.data.property_type,
      price_kobo: parsed.data.price_kobo,
      bedrooms: parsed.data.bedrooms,
      bathrooms: parsed.data.bathrooms,
      description: parsed.data.description,
    })
    .eq("id", listingId)
    .in("status", [...EDITABLE_STATUSES])
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[saveDetails]", error.message);
    return { ok: false, message: "We couldn't save those details. Please try again.", values };
  }

  if (!data) {
    return {
      ok: false,
      message: "That listing can no longer be edited. It may already be under review.",
      values,
    };
  }

  revalidatePath(stepPath(listingId, "details"));
  redirect(stepPath(listingId, "photos"));
}

/** Step 3 — save the address and map pin, then move on to preview. */
export async function saveLocationAction(
  listingId: string,
  _prevState: ListingFormState,
  formData: FormData
): Promise<ListingFormState | never> {
  const raw = {
    location_text: String(formData.get("location_text") ?? ""),
    lat: String(formData.get("lat") ?? ""),
    lng: String(formData.get("lng") ?? ""),
  };
  const values = { location_text: raw.location_text, lat: raw.lat, lng: raw.lng };

  const parsed = listingLocationSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    // lat/lng are set by the map, not typed, so a validation failure there is
    // not something the user can fix by editing a field. Say what to do.
    if (fieldErrors.lat || fieldErrors.lng) {
      return {
        ok: false,
        message: "Please pick the property's position on the map before continuing.",
        fieldErrors,
        values,
      };
    }
    return { ok: false, fieldErrors, values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("listings")
    .update({
      location_text: parsed.data.location_text,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
    })
    .eq("id", listingId)
    .in("status", [...EDITABLE_STATUSES])
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[saveLocation]", error.message);
    return { ok: false, message: "We couldn't save the location. Please try again.", values };
  }
  if (!data) {
    return {
      ok: false,
      message: "That listing can no longer be edited. It may already be under review.",
      values,
    };
  }

  revalidatePath(stepPath(listingId, "location"));
  redirect(stepPath(listingId, "preview"));
}

/** Step 5 — record agreement to the commission clause. */
export async function agreeCommissionAction(
  listingId: string,
  _prevState: ListingFormState,
  formData: FormData
): Promise<ListingFormState | never> {
  const parsed = commissionClauseSchema.safeParse({
    agreed: String(formData.get("agreed") ?? ""),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();

  // Record WHEN they agreed and to WHICH wording. If the clause text is later
  // revised, this listing stays bound to the version its owner actually read —
  // see src/lib/listings/commission-clause.ts.
  const { data, error } = await supabase
    .from("listings")
    .update({
      commission_clause_agreed_at: new Date().toISOString(),
      commission_clause_version: COMMISSION_CLAUSE_VERSION,
    })
    .eq("id", listingId)
    .in("status", [...EDITABLE_STATUSES])
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[agreeCommission]", error.message);
    return { ok: false, message: "We couldn't record your agreement. Please try again." };
  }
  if (!data) {
    return {
      ok: false,
      message: "That listing can no longer be edited. It may already be under review.",
    };
  }

  revalidatePath(stepPath(listingId, "terms"));
  redirect(stepPath(listingId, "payment"));
}

/**
 * Submits a finished listing for manual review.
 *
 * This is the moment the listing leaves the owner's hands: status moves to
 * `pending_review`, and from then on only an admin can set it live. That
 * one-way door is what makes "every listing manually reviewed before going
 * live" a real guarantee rather than a policy statement — the RLS update policy
 * refuses `live` to anyone but an admin.
 *
 * Readiness is checked here for a good error message, and again by the database
 * CHECK constraints, which are the actual enforcement. Both matter: the
 * constraints cannot produce a sentence a landlord can act on, and this check
 * cannot be trusted, because a request could be crafted to skip it.
 */
// Declares only the bound listingId: once bound, the result is a zero-argument
// function, which is still assignable to what useActionState expects. No point
// naming parameters this never reads.
export async function submitForReviewAction(
  listingId: string
): Promise<ListingFormState | never> {
  const supabase = await createClient();

  const { data: listing, error: loadError } = await supabase
    .from("listings")
    .select("*")
    .eq("id", listingId)
    .maybeSingle();

  if (loadError || !listing) {
    return { ok: false, message: "We couldn't find that listing." };
  }

  if (!(EDITABLE_STATUSES as readonly string[]).includes(listing.status)) {
    return {
      ok: false,
      message:
        listing.status === "pending_review"
          ? "This listing has already been submitted — we're reviewing it now."
          : "This listing can no longer be submitted.",
    };
  }

  if (!readyToSubmit(listing)) {
    const done = stepCompletion(listing);
    const missing: string[] = [];
    if (!done.details) missing.push("the property details");
    if (!done.photos) missing.push("at least 3 photos");
    if (!done.location) missing.push("the location and map pin");
    if (!done.terms) missing.push("the commission agreement");
    if (!done.payment) missing.push("the listing fee");

    return {
      ok: false,
      message: `Before submitting, please finish ${missing.join(", ")}.`,
    };
  }

  const { data, error } = await supabase
    .from("listings")
    .update({
      status: "pending_review",
      // Clear any previous reviewer feedback: it referred to the old version,
      // and leaving it would show stale "what needs changing" text against a
      // listing that has since been fixed.
      rejection_reason: null,
    })
    .eq("id", listingId)
    .in("status", [...EDITABLE_STATUSES])
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[submitForReview]", error.message);
    return {
      ok: false,
      message: "We couldn't submit the listing. Please check the details and try again.",
    };
  }

  if (!data) {
    return { ok: false, message: "This listing can no longer be submitted." };
  }

  revalidatePath("/dashboard");
  redirect(`/listings/${listingId}/status?submitted=1`);
}

/**
 * Step 2 — save the listing's photo URLs.
 *
 * The browser uploads directly to Cloudinary and sends back the resulting URLs,
 * so this validates that what came back genuinely belongs to our Cloudinary
 * account and to THIS listing's folder. Without that check, a crafted request
 * could point a listing's photos at any URL on the internet — including an
 * image that later changes to something else entirely, on someone else's
 * server, after a human has reviewed and approved the listing.
 */
export async function savePhotosAction(
  listingId: string,
  images: string[]
): Promise<ListingFormState> {
  const { user } = await getCurrentProfile();
  if (!user) return { ok: false, message: "Please sign in again." };

  if (!Array.isArray(images)) {
    return { ok: false, message: "We couldn't save those photos." };
  }

  if (images.length > MAX_PHOTOS_PER_LISTING) {
    return {
      ok: false,
      message: `You can add up to ${MAX_PHOTOS_PER_LISTING} photos per listing.`,
    };
  }

  // Must be an https URL, on OUR Cloudinary account, inside THIS listing's
  // folder. The folder check is what stops one listing's photos being attached
  // to another.
  const expectedPrefix = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/`;
  const expectedFolder = listingFolder(listingId);

  const invalid = images.filter(
    (src) =>
      typeof src !== "string"
      || !src.startsWith(expectedPrefix)
      || !src.includes(expectedFolder)
  );

  if (invalid.length > 0) {
    console.error("[savePhotos] rejected non-Cloudinary or wrong-folder URLs", {
      listingId,
      count: invalid.length,
    });
    return { ok: false, message: "We couldn't save those photos. Please try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("listings")
    .update({ images })
    .eq("id", listingId)
    .in("status", [...EDITABLE_STATUSES])
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[savePhotos]", error.message);
    return { ok: false, message: "We couldn't save those photos. Please try again." };
  }
  if (!data) {
    return {
      ok: false,
      message: "That listing can no longer be edited. It may already be under review.",
    };
  }

  revalidatePath(stepPath(listingId, "photos"));
  return { ok: true };
}

/**
 * Step 6 — claim a first-50 listing fee waiver.
 *
 * All the real work happens inside the claim_listing_fee_waiver database
 * function, deliberately. Counting the waivers used and then writing one is two
 * steps, and two landlords arriving at the same moment would both read the same
 * remaining count and both be granted the last waiver. The function does it
 * inside an advisory lock so that cannot happen — see the migration for the
 * full reasoning.
 *
 * This action's job is only to translate the outcome into something the
 * landlord can act on.
 */
export async function claimFeeWaiverAction(
  listingId: string
): Promise<ListingFormState> {
  const { user } = await getCurrentProfile();
  if (!user) return { ok: false, message: "Please sign in again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_listing_fee_waiver", {
    p_listing_id: listingId,
  });

  if (error) {
    console.error("[claimFeeWaiver]", error.message);
    return { ok: false, message: "We couldn't apply the free listing. Please try again." };
  }

  const result = Array.isArray(data) ? data[0] : undefined;
  if (!result) {
    return { ok: false, message: "We couldn't apply the free listing. Please try again." };
  }

  if (result.granted) {
    revalidatePath(stepPath(listingId, "payment"));
    return { ok: true };
  }

  // Every branch says what happened AND what to do about it. "Pool exhausted"
  // in particular is not the landlord's fault and must not read like a refusal.
  const messages: Record<string, string> = {
    pool_exhausted:
      "Our first 50 free listings have all been taken. A listing fee applies to "
      + "this one — we'll have payment available shortly.",
    owner_has_open_waiver:
      "You already have another unfinished listing using a free listing. Finish "
      + "and submit that one first, then this listing can use the next.",
    not_owner: "You can only do this on your own listings.",
    not_editable: "This listing can no longer be edited. It may already be under review.",
    not_found: "We couldn't find that listing.",
  };

  return {
    ok: false,
    message: messages[result.reason] ?? "We couldn't apply the free listing.",
  };
}

/**
 * Step 6 — start a Paystack checkout for the listing fee.
 *
 * Only reachable once the first-50 waiver pool is exhausted. Returns the URL to
 * send the landlord to; the actual money is confirmed later by the webhook, not
 * by the browser coming back. A user returning from Paystack proves nothing —
 * they could simply navigate to the success URL themselves.
 */
export async function startListingFeePaymentAction(
  listingId: string
): Promise<ListingFormState & { redirectUrl?: string }> {
  const { user, profile } = await getCurrentProfile();
  if (!user || !profile) return { ok: false, message: "Please sign in again." };

  if (!paystackConfigured()) {
    return {
      ok: false,
      message:
        "Card payment isn't switched on yet. Please get in touch and we'll sort "
        + "this out with you directly.",
    };
  }

  const supabase = await createClient();
  const { data: listing } = await supabase
    .from("listings")
    .select("id, owner_id, status, listing_fee_paid, fee_waived")
    .eq("id", listingId)
    .maybeSingle();

  if (!listing || listing.owner_id !== user.id) {
    return { ok: false, message: "We couldn't find that listing." };
  }

  if (listing.listing_fee_paid || listing.fee_waived) {
    return { ok: false, message: "This listing's fee is already settled." };
  }

  if (!(EDITABLE_STATUSES as readonly string[]).includes(listing.status)) {
    return { ok: false, message: "This listing can no longer be edited." };
  }

  const result = await initialiseListingFee({
    email: user.email ?? "",
    listingId,
    userId: user.id,
    callbackUrl: `${env.NEXT_PUBLIC_SITE_URL}/listings/${listingId}/edit/payment?from=paystack`,
  });

  if (!result.ok) {
    return { ok: false, message: result.error };
  }

  return { ok: true, redirectUrl: result.authorizationUrl };
}
