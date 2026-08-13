import type { Metadata } from "next";
import { ListingStepper } from "@/components/listings/listing-stepper";
import { Alert } from "@/components/ui/alert";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { loadEditableListing } from "@/lib/listings/load";
import { PhotosForm } from "./photos-form";

export const metadata: Metadata = {
  title: "Listing photos",
};

export default async function ListingPhotosStep({
  params,
}: PageProps<"/listings/[id]/edit/photos">) {
  const { id } = await params;
  const listing = await loadEditableListing(id);

  return (
    <>
      <ListingStepper listing={listing} current="photos" />

      <h1 className="text-2xl font-semibold text-brand-900">Photos</h1>
      <p className="mt-2 mb-6 text-base text-ink-muted">
        At least 3. Photos are the single biggest thing renters judge a listing
        on, and our reviewers check they match the description.
      </p>

      {/* If the keys are missing, say so plainly rather than letting every
          upload fail with a generic error. */}
      {!cloudinaryConfigured() ? (
        <Alert tone="danger" title="Photo uploads aren't set up yet">
          The image service isn&rsquo;t configured on this deployment. Please
          contact us — this isn&rsquo;t something you can fix from here.
        </Alert>
      ) : (
        <PhotosForm listing={listing} />
      )}
    </>
  );
}
