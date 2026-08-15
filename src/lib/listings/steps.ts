import type { Listing, ListingMode } from "@/lib/supabase/database.types";

/**
 * The steps of the listing form (app-flow.docx §1, UI spec §2).
 *
 * Defined once here so the progress indicator, the navigation and the
 * "can I submit yet?" checks cannot drift apart as the form grows.
 *
 * HOW MANY STEPS THERE ARE DEPENDS ON THE LISTING MODE
 *
 * A Platform-Direct listing owes no listing fee at all (CLAUDE.md revenue
 * model), so it has five steps, not six — the fee step is absent rather than
 * present-and-skipped. Showing a payment screen that says "nothing to pay"
 * would imply a fee exists and was let off, which is not what this mode is:
 * the platform is paid out of commission instead, and only if the sale closes.
 */
const ALL_LISTING_STEPS = [
  { slug: "details", label: "Details", hint: "What are you listing?" },
  { slug: "photos", label: "Photos", hint: "At least 3 photos" },
  { slug: "location", label: "Location", hint: "Where is it?" },
  { slug: "preview", label: "Preview", hint: "How it will look" },
  { slug: "terms", label: "Terms", hint: "Commission agreement" },
  { slug: "payment", label: "Fee", hint: "Listing fee" },
] as const;

export type ListingStepSlug = (typeof ALL_LISTING_STEPS)[number]["slug"];

export type ListingStep = (typeof ALL_LISTING_STEPS)[number];

/**
 * The steps this listing actually has, given its mode.
 *
 * A mode of null means the owner has not chosen yet. The full six-step sequence
 * is shown in that case — it is the one that applies unless they say otherwise,
 * and a listing cannot reach the fee step without passing the details step where
 * the choice is made.
 */
export function listingSteps(mode: ListingMode | null): readonly ListingStep[] {
  return mode === "platform_direct"
    ? ALL_LISTING_STEPS.filter((step) => step.slug !== "payment")
    : ALL_LISTING_STEPS;
}

export function stepSlugs(mode: ListingMode | null): readonly ListingStepSlug[] {
  return listingSteps(mode).map((step) => step.slug);
}

/**
 * Whether a step exists at all — used to reject a URL like
 * /listings/<id>/edit/nonsense before it reaches the database.
 *
 * Mode-independent on purpose: `payment` is a real step, just not one this
 * listing has. Routing a Platform-Direct owner away from it is the payment
 * page's job, and it can then say something useful rather than 404.
 */
export function isListingStep(value: string): value is ListingStepSlug {
  return ALL_LISTING_STEPS.some((step) => step.slug === value);
}

/** Position within this listing's own sequence. -1 if the step is not in it. */
export function stepIndex(slug: ListingStepSlug, mode: ListingMode | null): number {
  return stepSlugs(mode).indexOf(slug);
}

export function nextStep(slug: ListingStepSlug, mode: ListingMode | null): ListingStepSlug | null {
  const slugs = stepSlugs(mode);
  const i = slugs.indexOf(slug);
  return i === -1 ? null : slugs[i + 1] ?? null;
}

export function previousStep(slug: ListingStepSlug, mode: ListingMode | null): ListingStepSlug | null {
  const slugs = stepSlugs(mode);
  const i = slugs.indexOf(slug);
  return i > 0 ? slugs[i - 1]! : null;
}

export function stepPath(listingId: string, slug: ListingStepSlug): string {
  return `/listings/${listingId}/edit/${slug}`;
}

/** Where a listing goes after the terms step — the fee, or straight to review. */
export function stepAfterTerms(mode: ListingMode | null): ListingStepSlug {
  return nextStep("terms", mode) ?? "preview";
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
    // listing_mode is chosen on this step, and is required before review —
    // mirrors the constraint listings_mode_chosen_before_review.
    details: Boolean(listing.title && listing.price_kobo > 0 && listing.listing_mode),
    photos: (listing.images?.length ?? 0) >= 3,
    location: listing.lat !== null && listing.lng !== null && Boolean(listing.location_text),
    // Preview is a review screen with nothing to fill in — complete once the
    // three steps it displays are done.
    preview:
      Boolean(listing.title)
      && (listing.images?.length ?? 0) >= 3
      && listing.lat !== null,
    terms: listing.commission_clause_agreed_at !== null,
    // Nothing is owed on a Platform-Direct listing, so there is nothing
    // outstanding to hold up its submission. Mirrors the database constraint
    // listings_review_requires_settled_fee, which exempts the same case.
    payment:
      listing.listing_mode === "platform_direct"
      || listing.listing_fee_paid
      || listing.fee_waived,
  };
}

/** Everything needed before a listing may be submitted for review. */
export function readyToSubmit(listing: Listing): boolean {
  const done = stepCompletion(listing);
  return done.details && done.photos && done.location && done.terms && done.payment;
}
