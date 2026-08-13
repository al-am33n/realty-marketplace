import Link from "next/link";
import { StatusPill } from "@/components/ui/status-pill";
import { stepPath } from "@/lib/listings/steps";
import { formatNaira } from "@/lib/utils";
import type { Listing } from "@/lib/supabase/database.types";

/**
 * One listing in the landlord's "my listings" list (UI spec §2).
 *
 * A draft links back into the form to carry on; anything else links to its
 * status page. That means a tap always leads somewhere useful — no row is a
 * dead end, which is the point of the spec's empty-state and next-action rules.
 */
export function ListingRow({ listing }: { listing: Listing }) {
  const isEditable = listing.status === "draft" || listing.status === "rejected";
  const href = isEditable
    ? stepPath(listing.id, "details")
    : `/listings/${listing.id}/status`;

  const photoCount = listing.images?.length ?? 0;

  return (
    <li>
      <Link
        href={href}
        className="flex min-h-touch gap-4 rounded-lg border border-line bg-surface-raised p-4 transition-colors hover:border-brand-300"
      >
        {photoCount > 0 ? (
          /* Plain <img> rather than next/image: Cloudinary already serves these
             optimised, and Vercel's image optimisation is metered on the free
             tier — re-optimising would spend the allowance for no gain. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.images[0]}
            alt=""
            className="h-16 w-16 shrink-0 rounded object-cover"
            loading="lazy"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-surface-sunken text-xs text-ink-subtle"
          >
            No photo
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-ink">
              {listing.title || "Untitled draft"}
            </span>
            <StatusPill status={listing.status} />
          </div>

          <span className="tabular text-sm text-ink-muted">
            {listing.price_kobo > 1 ? formatNaira(listing.price_kobo) : "No price yet"}
            {listing.type === "rent" && listing.price_kobo > 1 && " / year"}
          </span>

          {listing.location_text && (
            <span className="truncate text-sm text-ink-subtle">
              {listing.location_text}
            </span>
          )}

          {/* Only surfaced once a listing is public — view counts on a draft
              would just be a confusing zero. */}
          {listing.status === "live" && (
            <span className="tabular text-sm text-ink-subtle">
              {listing.view_count} {listing.view_count === 1 ? "view" : "views"}
            </span>
          )}

          {listing.status === "rejected" && (
            <span className="text-sm font-medium text-danger">
              Needs changes — tap to see why
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
