import type { Metadata } from "next";
import { ListingStepper } from "@/components/listings/listing-stepper";
import { Alert } from "@/components/ui/alert";
import { loadEditableListing } from "@/lib/listings/load";
import { COMMISSION_CLAUSE } from "@/lib/listings/commission-clause";
import { TermsForm } from "./terms-form";

export const metadata: Metadata = {
  title: "Commission agreement",
};

export default async function ListingTermsStep({
  params,
}: PageProps<"/listings/[id]/edit/terms">) {
  const { id } = await params;
  const listing = await loadEditableListing(id);

  const alreadyAgreed = listing.commission_clause_agreed_at !== null;

  return (
    <>
      <ListingStepper listing={listing} current="terms" />

      <h1 className="text-2xl font-semibold text-brand-900">
        {COMMISSION_CLAUSE.title}
      </h1>
      <p className="mt-2 text-base text-ink-muted">{COMMISSION_CLAUSE.summary}</p>

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
        {COMMISSION_CLAUSE.terms.map((term) => (
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
          There is no deposit and no charge for listing beyond the listing fee
          on the next step. Commission only ever applies after a deal actually
          closes.
        </Alert>
      </div>

      <div className="mt-8">
        <TermsForm listingId={listing.id} />
      </div>

      <p className="mt-4 text-xs text-ink-subtle">
        Version {COMMISSION_CLAUSE.version}. We record which version you agreed
        to, so if these terms ever change, this listing stays covered by the
        wording you actually read.
      </p>
    </>
  );
}
