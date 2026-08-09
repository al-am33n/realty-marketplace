"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { stepPath } from "@/lib/listings/steps";
import {
  listingDetailsSchema,
  toFieldErrors,
  type ListingFormState,
} from "@/lib/validation/listing";

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
    .eq("status", "draft")
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
