import type { Metadata } from "next";
import { ListingStepper } from "@/components/listings/listing-stepper";
import { loadEditableListing } from "@/lib/listings/load";
import { DetailsForm } from "./details-form";

export const metadata: Metadata = {
  title: "Listing details",
};

export default async function ListingDetailsStep({
  params,
}: PageProps<"/listings/[id]/edit/details">) {
  const { id } = await params;
  const listing = await loadEditableListing(id);

  return (
    <>
      <ListingStepper listing={listing} current="details" />

      <h1 className="text-2xl font-semibold text-brand-900">Property details</h1>
      <p className="mt-2 mb-6 text-base text-ink-muted">
        The basics someone needs to decide whether it&rsquo;s worth a viewing.
      </p>

      <DetailsForm listing={listing} />
    </>
  );
}
