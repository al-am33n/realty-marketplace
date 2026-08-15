import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { StatusPill } from "@/components/ui/status-pill";
import { createClient } from "@/lib/supabase/server";
import {
  LISTING_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
} from "@/lib/validation/listing";
import { formatNaira } from "@/lib/utils";
import { ReviewActions } from "./review-actions";

export const metadata: Metadata = {
  title: "Review listing",
};

/**
 * Full listing detail for review (app-flow.docx §5: "each listing shown with
 * photos, details, and an Approve / Reject action").
 *
 * The reviewer is the platform's primary fraud control, so everything they
 * need to judge the listing is on one screen — including a checklist of the
 * things worth looking for, since consistency between reviews is what makes the
 * guarantee meaningful.
 */
export default async function AdminListingDetail({
  params,
}: PageProps<"/admin/listings/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  // No owner filter and no status filter: the admin RLS policy grants read
  // access to every listing, which is exactly what a reviewer needs.
  const { data: listing } = await supabase
    .from("listings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!listing) notFound();

  const feeSettled = listing.listing_fee_paid || listing.fee_waived;

  return (
    <>
      <Link href="/admin/listings" className="text-sm text-brand-700 underline">
        ← Back to queue
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-brand-900">{listing.title}</h1>
        <StatusPill status={listing.status} />
      </div>

      <p className="tabular mt-1 text-lg font-semibold text-brand-900">
        {formatNaira(listing.price_kobo)}
        {listing.type === "rent" && (
          <span className="text-base font-normal text-ink-muted"> / year</span>
        )}
      </p>

      {listing.status !== "pending_review" && (
        <div className="mt-6">
          <Alert tone="info" title="This listing isn't awaiting review">
            It is currently marked <strong>{listing.status.replace("_", " ")}</strong>.
            Approve and reject only apply to listings in the queue.
          </Alert>
        </div>
      )}

      {/* The database refuses to publish a listing whose fee is unsettled, so
          flag it here rather than letting the reviewer discover it via a
          failed approval. */}
      {listing.status === "pending_review" && !feeSettled && (
        <div className="mt-6">
          <Alert tone="pending" title="Listing fee not settled">
            This listing can&rsquo;t be published until its fee is paid or
            waived — approving will fail until then.
          </Alert>
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-ink">Photos ({listing.images.length})</h2>
        {listing.images.length > 0 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {listing.images.map((src, i) => (
              /* Plain <img>: Cloudinary already serves these optimised, and
                 Vercel's image optimisation is metered on the free tier. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt={`Photo ${i + 1} of ${listing.title}`}
                className="h-52 w-auto shrink-0 rounded object-cover"
              />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-base text-ink-muted">No photos.</p>
        )}
      </section>

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-line bg-surface-raised p-5 sm:grid-cols-3">
        {[
          ["Type", LISTING_TYPE_LABELS[listing.type]],
          // Decides who runs the viewing, what the split is, and whether a fee
          // was ever owed — so a reviewer needs it in front of them, not
          // inferred from the fee row reading "Unpaid".
          [
            "Handled by",
            listing.listing_mode === "platform_direct"
              ? "Our own team (Platform-Direct)"
              : listing.listing_mode === "independent"
                ? "Independent agent"
                : "Not chosen",
          ],
          ["Property", PROPERTY_TYPE_LABELS[listing.property_type]],
          ["Bedrooms", listing.bedrooms?.toString() ?? "—"],
          ["Bathrooms", listing.bathrooms?.toString() ?? "—"],
          ["Location", listing.location_text],
          [
            "Map pin",
            listing.lat !== null && listing.lng !== null
              ? `${listing.lat.toFixed(5)}, ${listing.lng.toFixed(5)}`
              : "Not set",
          ],
          [
            "Fee",
            listing.listing_mode === "platform_direct"
              ? "None owed"
              : listing.fee_waived
                ? "Waived"
                : listing.listing_fee_paid
                  ? "Paid"
                  : "Unpaid",
          ],
          [
            "Commission clause",
            listing.commission_clause_agreed_at
              ? `Agreed (${listing.commission_clause_version ?? "?"})`
              : "Not agreed",
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-ink-subtle">{label}</dt>
            <dd className="tabular text-base text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {listing.description && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-ink">Description</h2>
          <p className="mt-2 whitespace-pre-line text-base text-ink">
            {listing.description}
          </p>
        </section>
      )}

      {listing.status === "pending_review" && (
        <>
          <section className="mt-8 rounded-lg border border-line bg-surface-sunken p-5">
            <h2 className="font-semibold text-ink">Before approving, check</h2>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink-muted">
              <li>· Photos show one property, and match the description</li>
              <li>· Photos don&rsquo;t look like stock images or estate-agent marketing shots</li>
              <li>· Price is plausible for the area — watch for a missing or extra zero</li>
              <li>· Map pin is in the right neighbourhood</li>
              <li>· Nothing in the description asks people to pay or make contact off-platform</li>
            </ul>
          </section>

          <div className="mt-6">
            <ReviewActions listingId={listing.id} />
          </div>
        </>
      )}
    </>
  );
}
