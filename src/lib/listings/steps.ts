import type { Listing } from "@/lib/supabase/database.types";

/**
 * The six steps of the listing form (app-flow.docx §1, UI spec §2).
 *
 * Defined once here so the progress indicator, the navigation and the
 * "can I submit yet?" checks cannot drift apart as the form grows.
 */
export const LISTING_STEPS = [
  { slug: "details", label: "Details", hint: "What are you listing?" },
  { slug: "photos", label: "Photos", hint: "At least 3 photos" },
  { slug: "location", label: "Location", hint: "Where is it?" },
  { slug: "preview", label: "Preview", hint: "How it will look" },
  { slug: "terms", label: "Terms", hint: "Commission agreement" },
  { slug: "payment", label: "Fee", hint: "Listing fee" },
] as const;

export type ListingStepSlug = (typeof LISTING_STEPS)[number]["slug"];

export const STEP_SLUGS = LISTING_STEPS.map((s) => s.slug) as readonly ListingStepSlug[];

export function isListingStep(value: string): value is ListingStepSlug {
  return (STEP_SLUGS as readonly string[]).includes(value);
}

export function stepIndex(slug: ListingStepSlug): number {
  return STEP_SLUGS.indexOf(slug);
}

export function nextStep(slug: ListingStepSlug): ListingStepSlug | null {
  return STEP_SLUGS[stepIndex(slug) + 1] ?? null;
}

export function previousStep(slug: ListingStepSlug): ListingStepSlug | null {
  const i = stepIndex(slug);
  return i > 0 ? STEP_SLUGS[i - 1]! : null;
}

export function stepPath(listingId: string, slug: ListingStepSlug): string {
  return `/listings/${listingId}/edit/${slug}`;
}

/**
 * Which steps are complete, for the progress indicator and to stop someone
 * skipping ahead to payment with an empty listing.
 *
 * These mirror the database CHECK constraints that fire when a listing leaves
 * draft status. The database is the real enforcement; this exists so the user
 * finds out at the right moment instead of being rejected at the very end.
 */
export function stepCompletion(listing: Listing): Record<ListingStepSlug, boolean> {
  return {
    details: Boolean(listing.title && listing.price_kobo > 0),
    photos: (listing.images?.length ?? 0) >= 3,
    location: listing.lat !== null && listing.lng !== null && Boolean(listing.location_text),
    // Preview is a review screen with nothing to fill in — complete once the
    // three steps it displays are done.
    preview:
      Boolean(listing.title)
      && (listing.images?.length ?? 0) >= 3
      && listing.lat !== null,
    terms: listing.commission_clause_agreed_at !== null,
    payment: listing.listing_fee_paid || listing.fee_waived,
  };
}

/** Everything needed before a listing may be submitted for review. */
export function readyToSubmit(listing: Listing): boolean {
  const done = stepCompletion(listing);
  return done.details && done.photos && done.location && done.terms && done.payment;
}
