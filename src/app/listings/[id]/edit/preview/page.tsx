import type { Metadata } from "next";
import Link from "next/link";
import { ListingStepper } from "@/components/listings/listing-stepper";
import { Alert } from "@/components/ui/alert";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { PlatformDirectBadge } from "@/components/listings/platform-direct-badge";
import { loadEditableListing } from "@/lib/listings/load";
import { readyToSubmit, stepCompletion, stepPath } from "@/lib/listings/steps";
import {
  LISTING_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
} from "@/lib/validation/listing";
import { formatNaira } from "@/lib/utils";
import { SubmitForReview } from "./submit-for-review";

export const metadata: Metadata = {
  title: "Preview your listing",
};

/**
 * Step 4 — Preview (app-flow.docx §1: "shows exactly how the listing will
 * appear publicly, with an 'Edit' option to go back to any step").
 *
 * Nothing is saved here. It exists so the owner sees their listing the way a
 * renter will, before it goes to review — which catches the mistakes a form
 * cannot: a title that reads oddly, a price with a missing zero, photos in a
 * confusing order.
 */
export default async function ListingPreviewStep({
  params,
}: PageProps<"/listings/[id]/edit/preview">) {
  const { id } = await params;
  const listing = await loadEditableListing(id);
  const done = stepCompletion(listing);

  const missing = [
    !done.details && { label: "Property details", step: "details" as const },
    !done.photos && { label: "At least 3 photos", step: "photos" as const },
    !done.location && { label: "Location and map pin", step: "location" as const },
  ].filter(Boolean) as Array<{ label: string; step: "details" | "photos" | "location" }>;

  return (
    <>
      <ListingStepper listing={listing} current="preview" />

      <h1 className="text-2xl font-semibold text-brand-900">How your listing looks</h1>
      <p className="mt-2 mb-6 text-base text-ink-muted">
        This is what renters and buyers will see. Check it over before it goes
        for review.
      </p>

      {missing.length > 0 && (
        <div className="mb-6">
          <Alert tone="pending" title="Some things are still missing">
            <ul className="mt-1 flex flex-col gap-1">
              {missing.map((item) => (
                <li key={item.step}>
                  <Link
                    href={stepPath(listing.id, item.step)}
                    className="font-medium underline"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      {/* The public listing card, as it will appear. */}
      <article className="overflow-hidden rounded-lg border border-line bg-surface-raised">
        {listing.images.length > 0 ? (
          <div className="flex gap-1 overflow-x-auto">
            {listing.images.map((src, i) => (
              /* A plain <img>, not next/image, on purpose. Cloudinary already
                 serves these resized and format-optimised (f_auto,q_auto), so
                 next/image would re-optimise an already-optimised image — and
                 on Vercel's free tier image optimisation is a metered resource.
                 Paying twice for the same work would burn the free allowance
                 for no visual gain. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt={`${listing.title} — photo ${i + 1}`}
                className="h-56 w-auto shrink-0 object-cover"
                loading="lazy"
              />
            ))}
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center bg-surface-sunken text-sm text-ink-subtle">
            No photos yet
          </div>
        )}

        <div className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="tabular text-2xl font-semibold text-brand-900">
              {formatNaira(listing.price_kobo)}
              {listing.type === "rent" && (
                <span className="text-base font-normal text-ink-muted"> / year</span>
              )}
            </p>
            <span className="flex flex-wrap items-center gap-2">
              {listing.listing_mode === "platform_direct" && (
                <PlatformDirectBadge size="sm" />
              )}
              <VerifiedBadge label="Reviewed listing" size="sm" />
            </span>
          </div>

          <h2 className="text-lg font-semibold text-ink">
            {listing.title || "Untitled listing"}
          </h2>

          <p className="text-sm text-ink-muted">
            {LISTING_TYPE_LABELS[listing.type]} ·{" "}
            {PROPERTY_TYPE_LABELS[listing.property_type]}
            {listing.bedrooms !== null && ` · ${listing.bedrooms} bed`}
            {listing.bathrooms !== null && ` · ${listing.bathrooms} bath`}
          </p>

          <p className="text-sm text-ink-muted">
            📍 {listing.location_text || "Location not set"}
          </p>

          {listing.description && (
            <p className="whitespace-pre-line text-base text-ink">{listing.description}</p>
          )}
        </div>
      </article>

      {/* Once every step is done, the listing can go straight to review from
          here rather than making the owner walk back through steps they have
          already completed. */}
      {readyToSubmit(listing) && (
        <div className="mt-8">
          <SubmitForReview listingId={listing.id} />
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <Link
          href={stepPath(listing.id, "terms")}
          className="inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-6 text-base font-medium text-white hover:bg-brand-800"
        >
          {readyToSubmit(listing) ? "Review the terms again" : "Looks right — continue"}
        </Link>
        <Link
          href={stepPath(listing.id, "details")}
          className="inline-flex min-h-touch items-center justify-center rounded-lg border border-line-strong bg-surface-raised px-6 text-base font-medium text-brand-800 hover:bg-surface-sunken"
        >
          Go back and edit
        </Link>
      </div>
    </>
  );
}
