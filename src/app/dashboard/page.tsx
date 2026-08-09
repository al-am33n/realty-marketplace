import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { getCurrentProfile } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";
import { LogoutButton } from "./logout-button";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * Placeholder dashboard for Phase 1.
 *
 * The real role-specific dashboards arrive in Phase 4. What this proves today
 * is that the foundation works end to end: the session survives a page load,
 * the profile row was created by the database trigger with the right role, and
 * the verification gate reports accurately.
 *
 * Note the auth check here even though proxy.ts already redirects signed-out
 * users. The Next.js docs are explicit that proxy is an optimistic check, not
 * an authorisation boundary — the page that renders the data does its own.
 */

const ROLE_LABELS: Record<UserRole, string> = {
  renter_buyer: "Renter / Buyer",
  landlord: "Landlord",
  agent: "Agent",
  admin: "Administrator",
};

/**
 * Empty states, per the UI spec §3: every list that can be empty "shows a short
 * explanation plus a clear next action — never just a blank page."
 */
const ROLE_NEXT_STEPS: Record<
  UserRole,
  { title: string; body: string; cta?: { label: string; href: string } }
> = {
  renter_buyer: {
    title: "Find your next home",
    body: "Browse verified listings across Abuja and request a viewing. An agent from our team meets you there — you never view a property alone, and you never pay anything before a viewing is confirmed.",
    cta: { label: "Browse listings", href: "/" },
  },
  landlord: {
    title: "List your first property",
    body: "You haven't listed anything yet. Listings are reviewed by our team before going live, which is what keeps fake listings off the platform. The listing fee is waived for our first 50 listings.",
    cta: { label: "Create a listing", href: "/listings/new" },
  },
  agent: {
    title: "Your viewings will appear here",
    body: "Once our team activates your agent profile, viewing requests in your coverage area will show up here. Your completion rate and rating are public, so clients can see your track record.",
  },
  admin: {
    title: "Moderation queue",
    body: "Listings awaiting review will appear here once the admin panel is built in Phase 6.",
  },
};

export default async function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  const params = await searchParams;
  const { user, profile } = await getCurrentProfile();

  if (!user) redirect("/login?next=/dashboard");

  // The profile row is created by a database trigger inside the same
  // transaction as the signup, so this should be impossible. If it ever
  // happens, say so plainly rather than crashing on a null.
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

  const nextStep = ROLE_NEXT_STEPS[profile.role];
  const justConfirmed = params.welcome === "1";

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between gap-4 px-5">
          <Link href="/" className="text-lg font-semibold text-brand-900">
            <span aria-hidden="true" className="mr-1.5">
              🏠
            </span>
            Realty Marketplace
          </Link>
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8">
        <div className="flex flex-col gap-6">
          {justConfirmed && (
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
            <p className="mt-1 text-base text-ink-muted">
              {ROLE_LABELS[profile.role]}
            </p>
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

          <section className="rounded-lg border border-line bg-surface-raised p-6">
            <h2 className="text-lg font-semibold text-ink">{nextStep.title}</h2>
            <p className="mt-2 text-base text-ink-muted">{nextStep.body}</p>
            {nextStep.cta && (
              <Link
                href={nextStep.cta.href}
                className="mt-4 inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-5 text-base font-medium text-white hover:bg-brand-800"
              >
                {nextStep.cta.label}
              </Link>
            )}
          </section>

          <p className="text-sm text-ink-subtle">
            Phase 1 of 7 complete — accounts, roles and security are in place.
            Listings, search, bookings and deals are still to come.
          </p>
        </div>
      </main>
    </div>
  );
}
