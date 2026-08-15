import { z } from "zod";

/**
 * Validation for the multi-step listing form (app-flow.docx §1).
 *
 * Each step has its own schema. The form saves a draft row after step 1 and
 * updates it as the user progresses, so each step validates only its own
 * fields — a partially filled draft is legitimate and must not be rejected.
 *
 * The full set of "is this actually complete?" rules lives in the database as
 * CHECK constraints, and only applies when the listing leaves draft status.
 * That is the real gate; these schemas are for giving useful feedback.
 */

export const LISTING_TYPES = ["rent", "sale"] as const;

export const PROPERTY_TYPES = [
  "apartment",
  "house",
  "duplex",
  "bungalow",
  "self_contain",
  "room_and_parlour",
  "land",
  "commercial",
] as const;

/** Labels for the UI. Kept beside the values so the two cannot drift apart. */
export const PROPERTY_TYPE_LABELS: Record<(typeof PROPERTY_TYPES)[number], string> = {
  apartment: "Flat / Apartment",
  house: "House",
  duplex: "Duplex",
  bungalow: "Bungalow",
  self_contain: "Self-contain",
  room_and_parlour: "Room & Parlour",
  land: "Land",
  commercial: "Commercial",
};

export const LISTING_TYPE_LABELS: Record<(typeof LISTING_TYPES)[number], string> = {
  rent: "For rent",
  sale: "For sale",
};

/**
 * How the listing gets closed, and therefore what it costs (CLAUDE.md revenue
 * model). Presented to the owner with NEITHER option pre-selected — see the
 * chooser in the details form, and the migration that made the column nullable
 * so "not chosen yet" is a state the database can actually hold.
 */
export const LISTING_MODES = ["independent", "platform_direct"] as const;

export const LISTING_MODE_LABELS: Record<(typeof LISTING_MODES)[number], string> = {
  independent: "Independent agent",
  platform_direct: "Platform-Direct",
};

/** Property types where bedroom and bathroom counts are meaningless. */
export const TYPES_WITHOUT_ROOMS: ReadonlySet<string> = new Set(["land", "commercial"]);

/**
 * Naira typed by a human -> integer kobo for storage.
 *
 * Accepts the forms people actually type — "2,500,000", "₦2,500,000",
 * "2500000", "2500000.50" — tolerating the naira sign, commas and surrounding
 * spaces. Shorthand like "2.5m" is deliberately REJECTED rather than guessed
 * at: "2.5m" and "2.5" differ by a factor of a million, and silently picking
 * one would be a catastrophic way to be wrong about a property price.
 *
 * Everything is done in integers. Parsing "2500000.50" to a float and
 * multiplying by 100 can land on 250000049.99999997, which then truncates to a
 * kobo short — small, but it is money, and it compounds across commission
 * calculations. So the naira and kobo halves are parsed separately as integers.
 */
export function parseNairaToKobo(input: string): number | null {
  const cleaned = input.trim().replace(/[₦,\s]/g, "");
  if (cleaned === "") return null;

  // Reject anything that is not digits with at most two decimal places.
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const [nairaPart, koboPart = ""] = cleaned.split(".");
  const naira = Number.parseInt(nairaPart, 10);
  if (!Number.isSafeInteger(naira)) return null;

  // "2.5" means 50 kobo, not 5 — pad to two digits before parsing.
  const kobo = Number.parseInt(koboPart.padEnd(2, "0") || "0", 10);

  const total = naira * 100 + kobo;
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  return total;
}

const priceField = z
  .string()
  .trim()
  .min(1, "Enter the price")
  .transform((value, ctx) => {
    const kobo = parseNairaToKobo(value);
    if (kobo === null) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a price in naira, for example 2,500,000",
      });
      return z.NEVER;
    }
    // A sanity ceiling. Postgres would accept far more, but a price this large
    // is almost certainly a typo (an extra zero or two), and catching it here
    // is kinder than letting it reach the review queue.
    if (kobo > 500_000_000_000) {
      ctx.addIssue({
        code: "custom",
        message: "That price looks too high. Please check it and try again.",
      });
      return z.NEVER;
    }
    return kobo;
  });

/** Optional whole number from a text input — blank means "not specified". */
const optionalCount = (max: number, label: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null;
      if (!/^\d{1,2}$/.test(value)) {
        ctx.addIssue({ code: "custom", message: `Enter a number of ${label}` });
        return z.NEVER;
      }
      const n = Number.parseInt(value, 10);
      if (n > max) {
        ctx.addIssue({ code: "custom", message: `That is more ${label} than we can list` });
        return z.NEVER;
      }
      return n;
    });

/** Step 1 — Details. */
export const listingDetailsSchema = z.object({
  listing_mode: z.enum(LISTING_MODES, {
    message: "Choose how you'd like this listing handled",
  }),
  title: z
    .string()
    .trim()
    .min(8, "Give the listing a title of at least 8 characters")
    .max(120, "Keep the title under 120 characters"),
  type: z.enum(LISTING_TYPES, { message: "Choose whether this is for rent or for sale" }),
  property_type: z.enum(PROPERTY_TYPES, { message: "Choose a property type" }),
  price_kobo: priceField,
  bedrooms: optionalCount(20, "bedrooms"),
  bathrooms: optionalCount(20, "bathrooms"),
  description: z
    .string()
    .trim()
    .max(4000, "Keep the description under 4000 characters")
    .default(""),
})
  /**
   * Platform-Direct is sales only to start (CLAUDE.md: "Scope to start: sales
   * only, not rentals" — a bigger commission per deal, and a workload a 2-3
   * person in-house team can actually carry).
   *
   * The form does not offer the choice on a rental at all, so reaching this
   * means the request did not come from the form. The database enforces the
   * same rule in listings_platform_direct_is_sale_only; this exists so the
   * refusal is a sentence rather than a constraint violation.
   */
  .refine((data) => !(data.listing_mode === "platform_direct" && data.type === "rent"), {
    message: "Platform-Direct is only available for properties for sale at the moment",
    path: ["listing_mode"],
  });

/** Step 3 — Location. */
export const listingLocationSchema = z.object({
  location_text: z
    .string()
    .trim()
    .min(4, "Enter the area or address")
    .max(200, "That address is too long"),
  // Abuja-only for v1 (launch scope), but the bounds are kept generous so a
  // slightly-off geocode near the city edge is not rejected outright.
  lat: z.coerce
    .number()
    .min(-90, "Invalid location")
    .max(90, "Invalid location"),
  lng: z.coerce
    .number()
    .min(-180, "Invalid location")
    .max(180, "Invalid location"),
});

/** Step 5 — Commission clause. Agreement must be explicit, never pre-ticked. */
export const commissionClauseSchema = z.object({
  agreed: z
    .string()
    .refine((v) => v === "on" || v === "true", {
      message: "You need to accept the commission terms before continuing",
    }),
});

/**
 * Admin rejection. The reason is mandatory in the database too
 * (listings_rejected_requires_reason), because app-flow.docx §5 sends it
 * straight to the landlord — a rejection with no explanation is a dead end for
 * someone who cannot see the queue and has no way to guess what was wrong.
 *
 * The minimum length is not bureaucracy: "no" is technically a reason and
 * helps nobody.
 */
export const rejectListingSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(15, "Explain what needs changing — the landlord only sees this message")
    .max(1000, "Keep the reason under 1000 characters"),
});

export type ListingDetailsInput = z.infer<typeof listingDetailsSchema>;
export type ListingLocationInput = z.infer<typeof listingLocationSchema>;

/** Shared result shape for the listing form's server actions. */
export type ListingFormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
