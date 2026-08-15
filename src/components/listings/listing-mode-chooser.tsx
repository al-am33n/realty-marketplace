"use client";

import { cn } from "@/lib/utils";
import { LISTING_MODES, LISTING_MODE_LABELS } from "@/lib/validation/listing";
import type { ListingMode } from "@/lib/supabase/database.types";

/**
 * The independent-agent vs Platform-Direct choice (CLAUDE.md revenue model).
 *
 * ---------------------------------------------------------------------------
 * THE NEUTRALITY REQUIREMENT IS THE POINT OF THIS COMPONENT
 *
 * CLAUDE.md: "The choice must be presented neutrally in the UI — not
 * pre-selected or worded to nudge toward whichever option is more profitable
 * for the platform."
 *
 * Platform-Direct is the more profitable option for the platform: no listing
 * fee collected, but the whole commission on close. So every design decision
 * here has to be checked against the question "would this push someone toward
 * it?" Concretely:
 *
 *   · Neither option is pre-selected. `listing_mode` is nullable in the
 *     database precisely so this is possible — a default would have been the
 *     strongest nudge available, since most people never change one.
 *   · Both cards state the SAME three facts in the same order: who does the
 *     work, what it costs to list, what the commission is. Neither gets an
 *     extra selling point the other doesn't.
 *   · No "recommended", no "most popular", no badge, no visual emphasis on
 *     either card. They are the same size and the same colour.
 *   · The one asymmetric line — that Platform-Direct listings are publicly
 *     labelled — is a disclosure the brief requires, and it is a fact a
 *     landlord might weigh AGAINST choosing it. Its presence is not a nudge
 *     toward the platform's own interest.
 *
 * If this component is ever restyled, that list is the thing to re-check.
 * ---------------------------------------------------------------------------
 */

type ModeFacts = {
  who: string;
  cost: string;
  commission: string;
  extra?: string;
};

const FACTS: Record<ListingMode, ModeFacts> = {
  independent: {
    who: "A vetted agent from our network shows the property and handles the deal.",
    cost: "₦5,000 per month to keep the listing up.",
    commission:
      "On a sale, the commission is split 70% to the agent who closes it, 30% to us.",
  },
  platform_direct: {
    who: "Our own in-house team shows the property and handles the deal.",
    cost: "No listing fee, ever — nothing now and nothing month to month.",
    commission: "On a sale, the whole commission comes to us. There is no separate agent share.",
    extra: "Buyers see this listing marked “Platform-Direct”, so they know we are the ones handling it.",
  },
};

export function ListingModeChooser({
  value,
  onChange,
  errors,
}: {
  value: ListingMode | null;
  onChange: (mode: ListingMode) => void;
  errors?: string[];
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium text-ink">
        How would you like this listing handled?
      </legend>
      <p className="mb-1 text-sm text-ink-muted">
        Two ways to sell through us. They cost different things and involve
        different people — pick whichever suits you.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {LISTING_MODES.map((mode) => {
          const facts = FACTS[mode];
          return (
            <label
              key={mode}
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-lg border-2 bg-surface-raised p-4 transition-colors",
                "border-line-strong hover:border-brand-300",
                "has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
              )}
            >
              <input
                type="radio"
                name="listing_mode"
                value={mode}
                checked={value === mode}
                onChange={() => onChange(mode)}
                className="sr-only-text"
              />
              <span className="text-base font-semibold text-brand-900">
                {LISTING_MODE_LABELS[mode]}
              </span>
              <span className="text-sm text-ink">{facts.who}</span>
              <span className="text-sm text-ink">{facts.cost}</span>
              <span className="text-sm text-ink">{facts.commission}</span>
              {facts.extra && (
                <span className="text-sm text-ink-muted">{facts.extra}</span>
              )}
            </label>
          );
        })}
      </div>

      {errors && errors.length > 0 && (
        <p role="alert" className="text-sm font-medium text-danger">
          {errors.join(". ")}
        </p>
      )}
    </fieldset>
  );
}
