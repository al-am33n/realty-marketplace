import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { StatusPill } from "@/components/ui/status-pill";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { stepPath } from "@/lib/listings/steps";
import { formatNaira } from "@/lib/utils";
import { StartListingForm } from "./start-listing-form";

export const metadata: Metadata = {
  title: "Create a listing",
};

export default async function NewListingPage() {
  const { user, profile } = await getCurrentProfile();

  if (!user || !profile) redirect("/login?next=/listings/new");

  const supabase = await createClient();
  const { data: drafts } = await supabase
    .from("listings")
    .select("id, title, price_kobo, status, created_at")
    .eq("owner_id", user.id)
    .eq("status", "draft")
    .order("created_at", { ascending: false });

  const startedDrafts = (drafts ?? []).filter((d) => d.title);
  const canList = profile.role === "landlord" || profile.role === "agent";

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8">
      <Link href="/dashboard" className="text-sm text-brand-700 underline">
        ← Back to dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-brand-900">Create a listing</h1>
      <p className="mt-2 text-base text-ink-muted">
        Six short steps. Your progress saves as you go, so you can stop and come
        back at any point.
      </p>

      {!canList && (
        <div className="mt-6">
          <Alert tone="pending" title="Your account can't create listings">
            Listings can only be created by landlord and agent accounts. Get in
            touch if your account type needs changing.
          </Alert>
        </div>
      )}

      {canList && !profile.verified && (
        <div className="mt-6">
          <Alert tone="pending" title="Confirm your email first">
            We need a confirmed account before a listing can be created.{" "}
            <Link href="/verify" className="font-medium underline">
              Confirm now
            </Link>
          </Alert>
        </div>
      )}

      {/* Unfinished drafts, so a half-built listing is easy to find again
          rather than being silently abandoned. */}
      {startedDrafts.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">Continue where you left off</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {startedDrafts.map((draft) => (
              <li key={draft.id}>
                <Link
                  href={stepPath(draft.id, "details")}
                  className="flex min-h-touch items-center justify-between gap-4 rounded-lg border border-line bg-surface-raised px-4 py-3 hover:border-brand-300"
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-ink">{draft.title}</span>
                    <span className="tabular text-sm text-ink-muted">
                      {formatNaira(draft.price_kobo)}
                    </span>
                  </span>
                  <StatusPill status={draft.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canList && profile.verified && (
        <div className="mt-8">
          <StartListingForm hasDrafts={startedDrafts.length > 0} />
        </div>
      )}

      <section className="mt-10 rounded-lg border border-line bg-surface-raised p-5">
        <h2 className="font-semibold text-ink">What happens after you submit</h2>
        <ol className="mt-3 flex flex-col gap-2 text-sm text-ink-muted">
          <li>
            <strong className="text-ink">1.</strong> Someone on our team reviews
            the listing — photos, price and location — before it appears
            publicly. Nothing goes live automatically.
          </li>
          <li>
            <strong className="text-ink">2.</strong> We email you when it&rsquo;s
            approved, or explain what needs changing if it isn&rsquo;t.
          </li>
          <li>
            <strong className="text-ink">3.</strong> Interested renters and
            buyers request viewings, and we assign a vetted agent to each one.
          </li>
        </ol>
      </section>
    </div>
  );
}
