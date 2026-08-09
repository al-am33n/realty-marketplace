import type { Metadata } from "next";
import { ListingStepper } from "@/components/listings/listing-stepper";
import { loadEditableListing } from "@/lib/listings/load";
import { LocationForm } from "./location-form";

export const metadata: Metadata = {
  title: "Listing location",
};

export default async function ListingLocationStep({
  params,
}: PageProps<"/listings/[id]/edit/location">) {
  const { id } = await params;
  const listing = await loadEditableListing(id);

  return (
    <>
      <ListingStepper listing={listing} current="location" />

      <h1 className="text-2xl font-semibold text-brand-900">Where is it?</h1>
      <p className="mt-2 mb-6 text-base text-ink-muted">
        Search for the address, then drag the pin to the exact spot.
      </p>

      <LocationForm listing={listing} />
    </>
  );
}
