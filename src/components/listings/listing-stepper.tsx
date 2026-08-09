import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  LISTING_STEPS,
  stepCompletion,
  stepIndex,
  stepPath,
  type ListingStepSlug,
} from "@/lib/listings/steps";
import type { Listing } from "@/lib/supabase/database.types";

/**
 * Progress indicator for the listing form (UI spec §2: "Progress indicator
 * across steps, one focused task per screen").
 *
 * Completed steps link back so the user can revisit them; steps ahead of the
 * current one are not links, because jumping to Payment from Details would
 * only produce a confusing dead end.
 *
 * On mobile this is a compact "Step 2 of 6" line plus a bar — a six-item
 * horizontal stepper does not fit a phone screen without becoming unreadable,
 * and the UI spec is explicit that this is a mobile-first product. The full
 * stepper appears from the small breakpoint upwards.
 */
export function ListingStepper({
  listing,
  current,
}: {
  listing: Listing;
  current: ListingStepSlug;
}) {
  const done = stepCompletion(listing);
  const currentIndex = stepIndex(current);
  const currentStep = LISTING_STEPS[currentIndex]!;

  return (
    <nav aria-label="Listing progress" className="mb-8">
      {/* Mobile */}
      <div className="sm:hidden">
        <p className="text-sm font-medium text-ink">
          Step {currentIndex + 1} of {LISTING_STEPS.length}
          <span className="text-ink-muted"> · {currentStep.label}</span>
        </p>
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuenow={currentIndex + 1}
          aria-valuemin={1}
          aria-valuemax={LISTING_STEPS.length}
          aria-label={`Step ${currentIndex + 1} of ${LISTING_STEPS.length}: ${currentStep.label}`}
        >
          <div
            className="h-full rounded-full bg-brand-700 transition-all"
            style={{ width: `${((currentIndex + 1) / LISTING_STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Desktop */}
      <ol className="hidden sm:flex sm:items-center sm:gap-1">
        {LISTING_STEPS.map((step, index) => {
          const isCurrent = step.slug === current;
          const isComplete = done[step.slug];
          // Only allow navigating back to steps already visited or completed.
          const isReachable = index < currentIndex || isComplete;

          const body = (
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  isCurrent && "bg-brand-700 text-white",
                  !isCurrent && isComplete && "bg-success-soft text-success ring-1 ring-success-line",
                  !isCurrent && !isComplete && "bg-surface-sunken text-ink-subtle"
                )}
              >
                {isComplete && !isCurrent ? "✓" : index + 1}
              </span>
              <span
                className={cn(
                  "text-sm",
                  isCurrent ? "font-semibold text-brand-900" : "text-ink-muted"
                )}
              >
                {step.label}
              </span>
            </span>
          );

          return (
            <li key={step.slug} className="flex items-center gap-1">
              {isReachable && !isCurrent ? (
                <Link
                  href={stepPath(listing.id, step.slug)}
                  className="rounded px-1 py-1 hover:bg-surface-sunken"
                >
                  {body}
                </Link>
              ) : (
                <span
                  className="px-1 py-1"
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {body}
                </span>
              )}

              {index < LISTING_STEPS.length - 1 && (
                <span aria-hidden="true" className="mx-1 h-px w-4 bg-line-strong" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
