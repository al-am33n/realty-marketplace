import Link from "next/link";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { getCurrentProfile } from "@/lib/supabase/server";

/**
 * Landing page.
 *
 * The real home screen — search bar, map preview, featured listings — is built
 * in Phase 3 alongside search. For now this establishes the trust-led framing
 * the UI spec asks for and routes people to the right place.
 */

const TRUST_POINTS = [
  {
    icon: "🔎",
    title: "Every listing is reviewed",
    body: "A person on our team checks each property before it appears. Nothing goes live automatically.",
  },
  {
    icon: "🤝",
    title: "An agent joins every viewing",
    body: "You never view a property alone, and never deal with an unverified stranger. Every agent's rating and completion rate is public.",
  },
  {
    icon: "🔒",
    title: "You pay nothing up front",
    body: "No deposits, and no payment of any kind before a viewing is confirmed. That is how the common rental scam works — so we removed the step entirely.",
  },
];

export default async function HomePage() {
  const { user } = await getCurrentProfile();

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-4 px-5">
          <span className="text-lg font-semibold text-brand-900">
            <span aria-hidden="true" className="mr-1.5">
              🏠
            </span>
            Realty Marketplace
          </span>

          {user ? (
            <Link
              href="/dashboard"
              className="text-sm font-medium text-brand-700 underline"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-sm font-medium text-brand-700 underline"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12">
        <section className="flex flex-col gap-4">
          <VerifiedBadge label="Verified listings only" size="sm" className="self-start" />

          <h1 className="text-3xl font-semibold text-balance text-brand-900 sm:text-4xl">
            Homes to rent and buy in Abuja, without the guesswork
          </h1>

          <p className="max-w-2xl text-lg text-ink-muted">
            Browse properties that a real person has checked, and book a viewing
            with a vetted agent who meets you there.
          </p>

          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-6 text-base font-medium text-white hover:bg-brand-800"
            >
              Create an account
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-touch items-center justify-center rounded-lg border border-line-strong bg-surface-raised px-6 text-base font-medium text-brand-800 hover:bg-surface-sunken"
            >
              Sign in
            </Link>
          </div>
        </section>

        <section className="mt-14 grid gap-5 sm:grid-cols-3">
          {TRUST_POINTS.map((point) => (
            <div
              key={point.title}
              className="rounded-lg border border-line bg-surface-raised p-5"
            >
              <div aria-hidden="true" className="text-2xl">
                {point.icon}
              </div>
              <h2 className="mt-3 font-semibold text-ink">{point.title}</h2>
              <p className="mt-1.5 text-sm text-ink-muted">{point.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-line px-5 py-6 text-center text-xs text-ink-subtle">
        Realty Marketplace is a marketplace that introduces renters and buyers to
        properties and agents. We are not a party to any lease or sale.
      </footer>
    </div>
  );
}
