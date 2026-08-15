import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { StatusPill } from "@/components/ui/status-pill";
import { PlatformDirectBadge } from "@/components/listings/platform-direct-badge";
import { loadOwnedListing } from "@/lib/listings/load";
import { stepPath } from "@/lib/listings/steps";
import { formatNaira } from "@/lib/utils";
import type { Listing, ListingStatus } from "@/lib/supabase/database.types";

export const metadata: Metadata = {
  title: "Listing status",
};

/**
 * Where a listing lands once it is no longer editable.
 *
 * app-flow.docx §1 ends the creation flow with: "Your listing is under review —
 * we'll notify you once it's live," with an expected review time. This page is
 * that screen, and it stays useful afterwards as the listing moves through
 * approval, rejection or closure.
 *
 * Every state below says what is happening AND what the owner can do about it.
 * A status with no next action is exactly the dead end the UI spec's empty-state
 * rule exists to prevent.
 */

const REVIEW_WINDOW = "within 24 hours";

function statusCopy(listing: Listing): {
  tone: "success" | "pending" | "danger" | "info";
  heading: string;
  body: string;
} {
  const map: Record<ListingStatus, { tone: "success" | "pending" | "danger" | "info"; heading: string; body: string }> = {
    draft: {
      tone: "info",
      heading: "This listing is still a draft",
      body: "It isn't visible to anyone yet. Finish the remaining steps to send it for review.",
    },
    pending_review: {
      tone: "pending",
      heading: "Your listing is under review",
      body:
        `Someone on our team is checking the photos, price and location — usually ${REVIEW_WINDOW}. `
        + "We'll email you as soon as it's live, or explain what needs changing if it isn't. "
        + "Every listing goes through this, which is what keeps fake listings off the platform.",
    },
    live: {
      tone: "success",
      heading: "Your listing is live",
      body:
        "Renters and buyers can find it now. When someone requests a viewing, we assign "
        + "a vetted agent and let you know.",
    },
    rejected: {
      tone: "danger",
      heading: "This listing wasn't approved",
      body: "Here's what needs changing. Once you've fixed it, you can send it back for review.",
    },
    closed: {
      tone: "info",
      heading: "This listing is closed",
      body: "It's no longer visible to renters or buyers.",
    },
  };
  return map[listing.status];
}

export default async function ListingStatusPage({
  params,
  searchParams,
}: PageProps<"/listings/[id]/status">) {
  const { id } = await params;
  const query = await searchParams;
  const listing = await loadOwnedListing(id, `/listings/${id}/status`);
  const copy = statusCopy(listing);

  // Shown once, straight after submitting. Distinct from the ongoing status
  // message below: this confirms the action succeeded, that one describes the
  // state. app-flow.docx §6 asks every irreversible action to be confirmed.
  const justSubmitted = query.submitted === "1" && listing.status === "pending_review";

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8">
      <Link href="/dashboard" className="text-sm text-brand-700 underline">
        ← Back to dashboard
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-brand-900">
          {listing.title || "Untitled listing"}
        </h1>
        <StatusPill status={listing.status} />
        {listing.listing_mode === "platform_direct" && <PlatformDirectBadge size="sm" />}
      </div>

      <p className="tabular mt-1 text-base text-ink-muted">
        {formatNaira(listing.price_kobo)}
        {listing.type === "rent" && " / year"}
        {listing.location_text && ` · ${listing.location_text}`}
      </p>

      {justSubmitted && (
        <div className="mt-6">
          <Alert tone="success" title="Listing submitted">
            Thanks — that&rsquo;s everything we need from you for now.
          </Alert>
        </div>
      )}

      <div className="mt-6">
        <Alert tone={copy.tone} title={copy.heading}>
          {copy.body}
        </Alert>
      </div>

      {/* The reason is required by the database whenever status is 'rejected',
          so if we are in this branch there is always something to show. */}
      {listing.status === "rejected" && listing.rejection_reason && (
        <div className="mt-4 rounded-lg border border-danger-line bg-surface-raised p-5">
          <h2 className="font-semibold text-ink">What needs changing</h2>
          <p className="mt-2 whitespace-pre-line text-base text-ink-muted">
            {listing.rejection_reason}
          </p>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3">
        {(listing.status === "draft" || listing.status === "rejected") && (
          <Link
            href={stepPath(listing.id, "details")}
            className="inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-6 text-base font-medium text-white hover:bg-brand-800"
          >
            {listing.status === "rejected" ? "Edit and resubmit" : "Continue this listing"}
          </Link>
        )}

        {listing.status === "live" && (
          <Link
            href={`/listings/${listing.id}`}
            className="inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-6 text-base font-medium text-white hover:bg-brand-800"
          >
            View your public listing
          </Link>
        )}

        <Link
          href="/dashboard"
          className="inline-flex min-h-touch items-center justify-center rounded-lg border border-line-strong bg-surface-raised px-6 text-base font-medium text-brand-800 hover:bg-surface-sunken"
        >
          Back to my listings
        </Link>
      </div>

      {listing.status === "pending_review" && (
        <p className="mt-6 text-sm text-ink-subtle">
          Submitted{" "}
          {new Date(listing.updated_at).toLocaleDateString("en-NG", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          . You don&rsquo;t need to do anything — we&rsquo;ll be in touch.
        </p>
      )}
    </div>
  );
}
