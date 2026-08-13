import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { ListingRow } from "@/components/listings/listing-row";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import type { Listing, UserRole } from "@/lib/supabase/database.types";
import { LogoutButton } from "./logout-button";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * The landlord dashboard (UI spec §2: "My listings (status badges: pending
 * review / live / closed), booking requests per listing, view counts").
 *
 * Booking requests arrive in Phase 4; this covers listings and view counts.
 *
 * Renters, agents and admins get their own dashboards in Phase 4 too, so for
 * now they see a short explanation of what happens next rather than an empty
 * landlord view that does not apply to them.
 */

const ROLE_LABELS: Record<UserRole, string> = {
  renter_buyer: "Renter / Buyer",
  landlord: "Landlord",
  agent: "Agent",
  admin: "Administrator",
};

/** Drafts first — they are the ones needing the owner's attention. */
const STATUS_ORDER: Record<string, number> = {
  rejected: 0,
  draft: 1,
  pending_review: 2,
  live: 3,
  closed: 4,
};

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const params = await searchParams;
  const { user, profile } = await getCurrentProfile();

  if (!user) redirect("/login?next=/dashboard");

  if (!profile) {
    return (
      <main className="mx-auto w-full max-w-2xl px-5 py-12">
        <Alert tone="danger" title="We couldn't load your profile">
          Your account exists but its details are missing. Please sign out and
          back in — if that doesn&rsquo;t help, contact us.
        </Alert>
        <div className="mt-4">
          <LogoutButton />
        </div>
      </main>
    );
  }

  const canList = profile.role === "landlord" || profile.role === "agent";

  let listings: Listing[] = [];
  if (canList) {
    const supabase = await createClient();
    // No owner_id filter needed — the RLS policy already limits this to the
    // caller's own listings plus anything publicly live. The explicit filter is
    // there so a live listing belonging to someone else cannot appear in a list
    // titled "your listings".
    const { data } = await supabase
      .from("listings")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    listings = data ?? [];
    listings.sort(
      (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
    );
  }

  const needsAttention = listings.filter((l) => l.status === "rejected").length;

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
          <div className="flex items-center gap-3">
            {profile.role === "admin" && (
              <Link href="/admin/listings" className="text-sm font-medium text-brand-700 underline">
                Review queue
              </Link>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
        <div className="flex flex-col gap-6">
          {params.welcome === "1" && (
            <Alert tone="success" title="Your email is confirmed">
              Your account is now active. Welcome to Realty Marketplace.
            </Alert>
          )}

          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-brand-900">
                {profile.full_name || "Your account"}
              </h1>
              {profile.verified && <VerifiedBadge size="sm" />}
            </div>
            <p className="mt-1 text-base text-ink-muted">{ROLE_LABELS[profile.role]}</p>
          </div>

          {!profile.verified && (
            <Alert tone="pending" title="Confirm your email to continue">
              You can browse listings, but creating a listing or booking a
              viewing needs a confirmed account.{" "}
              <Link href="/verify" className="font-medium underline">
                Confirm now
              </Link>
            </Alert>
          )}

          {needsAttention > 0 && (
            <Alert tone="danger" title="Some listings need changes">
              {needsAttention === 1
                ? "One of your listings wasn't approved."
                : `${needsAttention} of your listings weren't approved.`}{" "}
              Open it to see what the reviewer asked for.
            </Alert>
          )}

          {canList ? (
            <section>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-ink">Your listings</h2>
                {listings.length > 0 && profile.verified && (
                  <Link
                    href="/listings/new"
                    className="inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-5 text-sm font-medium text-white hover:bg-brand-800"
                  >
                    New listing
                  </Link>
                )}
              </div>

              {listings.length === 0 ? (
                /* Empty state with a clear next action, per UI spec §3 —
                   never just a blank page. */
                <div className="mt-4 rounded-lg border border-line bg-surface-raised p-6">
                  <h3 className="font-semibold text-ink">List your first property</h3>
                  <p className="mt-2 text-base text-ink-muted">
                    Listings are reviewed by our team before going live, which
                    is what keeps fake listings off the platform. The listing
                    fee is waived for our first 50 listings.
                  </p>
                  {profile.verified && (
                    <Link
                      href="/listings/new"
                      className="mt-4 inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-5 text-base font-medium text-white hover:bg-brand-800"
                    >
                      Create a listing
                    </Link>
                  )}
                </div>
              ) : (
                <ul className="mt-4 flex flex-col gap-3">
                  {listings.map((listing) => (
                    <ListingRow key={listing.id} listing={listing} />
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <section className="rounded-lg border border-line bg-surface-raised p-6">
              <h2 className="text-lg font-semibold text-ink">
                {profile.role === "admin" ? "Moderation" : "Find your next home"}
              </h2>
              <p className="mt-2 text-base text-ink-muted">
                {profile.role === "admin"
                  ? "Listings awaiting review appear in the review queue."
                  : "Browse verified listings across Abuja and request a viewing. An agent from our team meets you there — you never view a property alone, and you never pay anything before a viewing is confirmed."}
              </p>
              <Link
                href={profile.role === "admin" ? "/admin/listings" : "/"}
                className="mt-4 inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-5 text-base font-medium text-white hover:bg-brand-800"
              >
                {profile.role === "admin" ? "Open review queue" : "Browse listings"}
              </Link>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
