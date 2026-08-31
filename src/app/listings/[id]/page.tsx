import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { PlatformDirectBadge } from "@/components/listings/platform-direct-badge";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  LISTING_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
} from "@/lib/validation/listing";
import { formatNaira } from "@/lib/utils";
import type { Listing } from "@/lib/supabase/database.types";

/**
 * The public listing page.
 *
 * This is the address a landlord is sent to from "View your public listing", so
 * it is part of Phase 2 rather than Phase 3 — until it existed, finishing a
 * listing ended at a 404 on the platform's own link. Search, the map view and
 * filters are still Phase 3; this is the single-listing page they will link to.
 *
 * ---------------------------------------------------------------------------
 * WHO CAN SEE WHAT IS DECIDED BY THE DATABASE, NOT BY THIS FILE
 *
 * The query below has no status filter, deliberately. The RLS policy on
 * `listings` already says a stranger may read a row only when it is live AND
 * still inside its fee grace period, while an owner may always read their own.
 * Restating that here would give it two homes and one day two meanings.
 *
 * So a draft, a listing under review, or one hidden for an unpaid fee all
 * return nothing to a visitor, and this renders notFound() — which is also the
 * right answer for security. A 403 would confirm the listing exists.
 * ---------------------------------------------------------------------------
 */

// Never statically rendered: the visitor's own session decides whether they can
// see the row at all, and the view count below changes on every request.
export const dynamic = "force-dynamic";

async function loadPublicListing(id: string): Promise<Listing | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("listings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[publicListing]", error.message);
    return null;
  }
  return data;
}

export async function generateMetadata({
  params,
}: PageProps<"/listings/[id]">): Promise<Metadata> {
  const { id } = await params;
  const listing = await loadPublicListing(id);

  if (!listing) return { title: "Listing not found" };

  return {
    title: `${listing.title} — ${listing.location_text}`,
    description: listing.description.slice(0, 160) || undefined,
  };
}

/**
 * Counts a view.
 *
 * `view_count` is one of the fields guard_listing_privileged_fields refuses to
 * let an owner write — otherwise the number on their dashboard would be a
 * number they set — so this goes through the service role.
 *
 * The owner's own visits are not counted. A landlord refreshing their listing
 * to see whether anything has happened is the most frequent visitor it will
 * have, and counting them turns the one number that should mean "interest from
 * strangers" into a measure of the owner's own anxiety.
 *
 * This is a rough count, not analytics: a refresh counts again, and nothing
 * here distinguishes a person from a crawler. Worth being plain about, because
 * the dashboard presents it to a landlord as a fact about demand.
 */
async function countView(listing: Listing, viewerId: string | null): Promise<void> {
  if (listing.status !== "live") return;
  if (viewerId && viewerId === listing.owner_id) return;

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("listings")
      .update({ view_count: listing.view_count + 1 })
      .eq("id", listing.id);
    if (error) console.error("[publicListing] view count", error.message);
  } catch (error) {
    // A view that goes uncounted is not worth failing a page render over.
    console.error("[publicListing] view count", error instanceof Error ? error.message : error);
  }
}

export default async function PublicListingPage({
  params,
}: PageProps<"/listings/[id]">) {
  const { id } = await params;

  const [listing, { user }] = await Promise.all([
    loadPublicListing(id),
    getCurrentProfile(),
  ]);

  if (!listing) notFound();

  const isOwner = user?.id === listing.owner_id;

  // Not awaited into the render path any more than it has to be, but still
  // awaited: a serverless function can be frozen the instant its response is
  // sent, so an un-awaited write is a write that may simply never happen.
  await countView(listing, user?.id ?? null);

  const rooms = [
    listing.bedrooms !== null && `${listing.bedrooms} bed`,
    listing.bathrooms !== null && `${listing.bathrooms} bath`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-5">
          <Link href="/" className="text-lg font-semibold text-brand-900">
            <span aria-hidden="true" className="mr-1.5">
              🏠
            </span>
            Realty Marketplace
          </Link>
          <Link
            href={user ? "/dashboard" : "/login"}
            className="text-sm font-medium text-brand-700 underline"
          >
            {user ? "Dashboard" : "Sign in"}
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
        {/* An owner arriving from their dashboard needs to know whether what
            they are looking at is what the public sees. On a listing that is
            not live, it is not. */}
        {isOwner && listing.status !== "live" && (
          <div className="mb-6">
            <Alert tone="pending" title="Only you can see this">
              This listing isn&rsquo;t public yet — you&rsquo;re seeing it
              because it&rsquo;s yours.{" "}
              <Link href={`/listings/${listing.id}/status`} className="font-medium underline">
                Check its status
              </Link>
            </Alert>
          </div>
        )}

        <article className="overflow-hidden rounded-lg border border-line bg-surface-raised">
          {listing.images.length > 0 ? (
            <div className="flex snap-x snap-mandatory gap-1 overflow-x-auto">
              {listing.images.map((src, i) => (
                /* A plain <img>, not next/image. Cloudinary already serves
                   these resized and format-optimised, and Vercel meters image
                   optimisation on the free tier — re-optimising would spend the
                   allowance to redo work that is already done. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={src}
                  src={src}
                  alt={`${listing.title} — photo ${i + 1} of ${listing.images.length}`}
                  className="h-64 w-auto shrink-0 snap-start object-cover sm:h-80"
                  loading={i === 0 ? "eager" : "lazy"}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center bg-surface-sunken text-sm text-ink-subtle">
              No photos
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

            <h1 className="text-xl font-semibold text-ink">{listing.title}</h1>

            <p className="text-sm text-ink-muted">
              {LISTING_TYPE_LABELS[listing.type]} ·{" "}
              {PROPERTY_TYPE_LABELS[listing.property_type]}
              {rooms.length > 0 && ` · ${rooms.join(" · ")}`}
            </p>

            <p className="text-sm text-ink-muted">📍 {listing.location_text}</p>

            {listing.description && (
              <p className="whitespace-pre-line text-base text-ink">
                {listing.description}
              </p>
            )}
          </div>
        </article>

        {/* The viewing flow itself is Phase 4. Saying so plainly beats a button
            that does nothing, and beats no button at all: someone who wants to
            see this property needs to know what happens next and that it costs
            them nothing to find out. */}
        <section className="mt-6 rounded-lg border border-line bg-surface-raised p-5">
          <h2 className="font-semibold text-ink">Seeing this property</h2>
          <p className="mt-2 text-base text-ink-muted">
            A vetted agent from our team meets you at the property — you never
            view a place alone, and never arrange it with a stranger. Nothing is
            paid before a viewing is confirmed, and no deposit is ever taken
            through us.
          </p>
          <p className="mt-3 text-sm text-ink-subtle">
            Viewing requests open shortly. Create an account now and you&rsquo;ll
            be able to book one the day they do.
          </p>
          <Link
            href={user ? "/dashboard" : "/signup"}
            className="mt-4 inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-6 text-base font-medium text-white hover:bg-brand-800"
          >
            {user ? "Go to your dashboard" : "Create an account"}
          </Link>
        </section>

        {listing.listing_mode === "platform_direct" && (
          <div className="mt-6">
            <Alert tone="info" title="This one is handled by our own team">
              A member of the Realty Marketplace team shows this property and
              handles the sale directly, rather than an independent agent. We
              label every listing that works this way.
            </Alert>
          </div>
        )}

        <p className="mt-8 text-xs text-ink-subtle">
          Realty Marketplace introduces renters and buyers to properties and
          agents. Except where a listing is labelled as handled by our own team,
          we are not a party to any lease or sale.
        </p>
      </main>
    </div>
  );
}
