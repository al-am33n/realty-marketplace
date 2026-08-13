import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { StatusPill } from "@/components/ui/status-pill";
import { WaitingTime } from "@/components/ui/waiting-time";
import { createClient } from "@/lib/supabase/server";
import { formatNaira } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Review queue",
};

/**
 * Pending listings queue (app-flow.docx §5).
 *
 * Oldest first, deliberately. Reviewing newest-first would leave the listings
 * that have already waited longest waiting even longer, and the promise made on
 * the landlord's status screen is a review within 24 hours.
 */
export default async function AdminListingsPage({
  searchParams,
}: PageProps<"/admin/listings">) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: pending, error } = await supabase
    .from("listings")
    .select("*")
    .eq("status", "pending_review")
    .order("updated_at", { ascending: true });

  const { count: liveCount } = await supabase
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("status", "live");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-900">Review queue</h1>
          <p className="mt-1 text-base text-ink-muted">
            Every listing is checked here before it becomes publicly visible.
          </p>
        </div>
        <p className="tabular text-sm text-ink-muted">
          {liveCount ?? 0} live · {pending?.length ?? 0} waiting
        </p>
      </div>

      {params.approved === "1" && (
        <div className="mt-6">
          <Alert tone="success" title="Listing approved">
            It&rsquo;s now publicly visible.
          </Alert>
        </div>
      )}

      {params.rejected === "1" && (
        <div className="mt-6">
          <Alert tone="pending" title="Listing rejected">
            The landlord can see your reason on their listing page and can fix
            it and resubmit.
          </Alert>
        </div>
      )}

      {error && (
        <div className="mt-6">
          <Alert tone="danger" title="Couldn't load the queue">
            Please refresh the page.
          </Alert>
        </div>
      )}

      {!error && (pending?.length ?? 0) === 0 ? (
        <div className="mt-8 rounded-lg border border-line bg-surface-raised p-8 text-center">
          <p className="text-lg font-medium text-ink">Nothing waiting</p>
          <p className="mt-2 text-base text-ink-muted">
            Every submitted listing has been reviewed.
          </p>
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {pending?.map((listing) => {
            return (
              <li key={listing.id}>
                <Link
                  href={`/admin/listings/${listing.id}`}
                  className="flex min-h-touch gap-4 rounded-lg border border-line bg-surface-raised p-4 hover:border-brand-300"
                >
                  {listing.images.length > 0 ? (
                    /* Plain <img>: Cloudinary already serves these optimised,
                       and Vercel's image optimisation is metered on free tier. */
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={listing.images[0]}
                      alt=""
                      className="h-20 w-20 shrink-0 rounded object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="flex h-20 w-20 shrink-0 items-center justify-center rounded bg-surface-sunken text-xs text-ink-subtle"
                    >
                      No photo
                    </div>
                  )}

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-ink">{listing.title}</span>
                      <StatusPill status={listing.status} />
                    </div>
                    <span className="tabular text-sm text-ink-muted">
                      {formatNaira(listing.price_kobo)}
                      {listing.type === "rent" && " / year"}
                    </span>
                    <span className="truncate text-sm text-ink-subtle">
                      {listing.location_text} · {listing.images.length} photos
                    </span>
                    {/* Surfaces anything approaching the 24-hour promise made
                        on the landlord's status page. */}
                    <WaitingTime since={listing.updated_at} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
