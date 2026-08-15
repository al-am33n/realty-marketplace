import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ListingStepper } from "@/components/listings/listing-stepper";
import { Alert } from "@/components/ui/alert";
import { loadEditableListing } from "@/lib/listings/load";
import { commissionClauseFor } from "@/lib/listings/commission-clause";
import { stepPath } from "@/lib/listings/steps";
import { TermsForm } from "./terms-form";

export const metadata: Metadata = {
  title: "Commission agreement",
};

export default async function ListingTermsStep({
  params,
}: PageProps<"/listings/[id]/edit/terms">) {
  const { id } = await params;
  const listing = await loadEditableListing(id);

  // There is no single set of terms to show until the owner has picked a mode —
  // the two modes say opposite things about whether the platform is a party to
  // the sale. Send them back to make that choice rather than guessing one.
  if (!listing.listing_mode) {
    redirect(stepPath(listing.id, "details"));
  }

  const clause = commissionClauseFor(listing.listing_mode);
  const alreadyAgreed = listing.commission_clause_agreed_at !== null;

  return (
    <>
      <ListingStepper listing={listing} current="terms" />

      <h1 className="text-2xl font-semibold text-brand-900">
        {clause.title}
      </h1>
      <p className="mt-2 text-base text-ink-muted">{clause.summary}</p>

      {alreadyAgreed && (
        <div className="mt-6">
          <Alert tone="success" title="You've already agreed to these terms">
            Agreed on{" "}
            {new Date(listing.commission_clause_agreed_at!).toLocaleDateString("en-NG", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            . You can re-read them below.
          </Alert>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-5 rounded-lg border border-line bg-surface-raised p-5">
        {clause.terms.map((term) => (
          <section key={term.heading}>
            <h2 className="font-semibold text-ink">{term.heading}</h2>
            <p className="mt-1 text-base text-ink-muted">{term.body}</p>
          </section>
        ))}
      </div>

      {/* Reinforces the platform's core promise right where money is first
          mentioned — the point at which a user is most likely to worry. */}
      <div className="mt-6">
        <Alert tone="info" title="You are not paying anything now">
          There is no deposit.{" "}
          {listing.listing_mode === "platform_direct"
            ? "There is no listing fee on this listing at all."
            : "The only charge for listing is the fee on the next step."}{" "}
          Commission only ever applies after a deal actually closes.
        </Alert>
      </div>

      <div className="mt-8">
        <TermsForm listingId={listing.id} />
      </div>

      <p className="mt-4 text-xs text-ink-subtle">
        Version {clause.version}. We record which version you agreed
        to, so if these terms ever change, this listing stays covered by the
        wording you actually read.
      </p>
    </>
  );
}
