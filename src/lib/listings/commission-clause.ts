import type { ListingMode } from "@/lib/supabase/database.types";

/**
 * The procuring-cause commission clause shown at listing creation
 * (app-flow.docx §1 step 5).
 *
 * This is the mechanism that protects commission WITHOUT taking a deposit — one
 * of the three protections named in the project brief, alongside the agent's
 * own stake in the deal and loss of platform access. It is the reason the
 * platform can honestly promise "no payment before a confirmed viewing".
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE TWO OF THEM
 *
 * The two listing modes are genuinely different agreements, not one agreement
 * at two prices:
 *
 *   independent      the platform introduces people and is NOT a party to the
 *                    sale or lease. An outside agent runs the viewing and takes
 *                    the larger share of the commission.
 *   platform_direct  the platform's own team runs the viewing and closes the
 *                    deal, keeps the whole commission, and charges no listing
 *                    fee. CLAUDE.md flags this as a deliberate, scoped,
 *                    visibly-labelled departure from the facilitator posture.
 *
 * The last section of the clause has to say the opposite thing in each case, so
 * one text cannot honestly cover both.
 *
 * WHY THIS IS VERSIONED
 *
 * `listings.commission_clause_version` records WHICH wording the owner agreed
 * to, alongside the timestamp of when. If the wording is ever revised, existing
 * listings stay bound to the text their owner actually read — nobody is
 * retroactively held to terms they never saw.
 *
 * So: when changing the wording below, add a NEW version rather than editing an
 * existing one, and bump the version constant for that mode.
 *
 * The independent version stays "v1" — its text is unchanged, so every listing
 * already signed under "v1" is still bound to exactly what it displayed.
 * Switching a listing's mode clears the signature and sends the owner back
 * through this step; that is enforced by a database trigger
 * (apply_listing_mode_change) so it cannot be skipped.
 *
 * NOT LEGAL ADVICE: this wording should be reviewed by a Nigerian lawyer before
 * real money depends on it — and CLAUDE.md requires a targeted consultation on
 * the Platform-Direct model specifically before it ships at all.
 * ---------------------------------------------------------------------------
 */

export const INDEPENDENT_CLAUSE_VERSION = "v1";
export const PLATFORM_DIRECT_CLAUSE_VERSION = "pd-v1";

/**
 * How long after an introduction the commission claim survives.
 *
 * Settled at 6 months (the brief left this open between 6 and 12). The reason
 * to state a window at all is that a claim with NO limit is the weakest version
 * of this term, not the strongest: an indefinite hold over someone's property
 * reads as unreasonable and is the kind of term a court is most willing to read
 * down. A stated, moderate window is far more defensible than an unbounded one.
 *
 * Exported as a constant so the number appears once. If it ever changes, that
 * is a NEW clause version — see the versioning note above.
 */
export const COMMISSION_WINDOW_MONTHS = 6;

/**
 * Deliberately plain language, not legalese.
 *
 * The target user may never have used a formal property platform, and
 * app-flow.docx §6 asks the first-run experience to over-explain rather than
 * assume familiarity. Terms nobody reads protect nobody — a clause the owner
 * actually understood is far more likely to be honoured, and far more
 * defensible if it is not.
 */

/** The sections both modes share word for word. */
const SHARED_TERMS = [
  {
    heading: "What you are agreeing to",
    body:
      "If Realty Marketplace introduces a renter or buyer to this property, "
      + "and you agree a rental or sale with that person within "
      + `${COMMISSION_WINDOW_MONTHS} months of that introduction, you agree `
      + "to pay our commission on that deal.",
  },
  {
    heading: `The ${COMMISSION_WINDOW_MONTHS}-month limit`,
    body:
      `The ${COMMISSION_WINDOW_MONTHS} months run from the date we introduce `
      + "the person to your property — normally the day of their viewing. "
      + "After that, no commission is owed to us for that person, and you are "
      + "free to deal with them however you like. Each person we introduce "
      + "has their own separate window.",
  },
  {
    heading: "This applies even if the deal happens off the platform",
    body:
      "Within that window, the commission is owed because we made the "
      + "introduction, not because the paperwork ran through our website. "
      + "Completing the deal privately with someone we introduced does not "
      + "remove what is owed.",
  },
] as const;

const PAYMENT_TERMS = [
  {
    heading: "When you pay",
    body:
      "Only after the deal closes. We never hold your sale proceeds or your "
      + "rent — we invoice our commission separately once the deal is done.",
  },
  {
    heading: "If you don't pay",
    body:
      "Unpaid commission means losing access to listing on the platform and "
      + "to our agents for future properties.",
  },
] as const;

/**
 * Independent-agent mode. Text unchanged from the original v1 — see the
 * versioning note above for why that matters.
 */
const INDEPENDENT_CLAUSE = {
  mode: "independent" as const,
  version: INDEPENDENT_CLAUSE_VERSION,
  title: "Commission agreement",
  summary:
    "If we introduce someone to your property and you agree a deal with that "
    + `person within ${COMMISSION_WINDOW_MONTHS} months, our commission is owed `
    + "— even if the paperwork happens elsewhere.",
  terms: [
    ...SHARED_TERMS,
    {
      heading: "How much it is",
      body:
        "For a sale, our commission is a percentage of the agreed sale price, "
        + "confirmed with you in writing before the deal is marked as agreed. "
        + "For a rental, it is a share of the standard agency fee that tenants "
        + "already pay in Nigeria — shared between us and the agent who carried "
        + "out the viewing. You will never be charged a commission we have not "
        + "shown you first.",
    },
    ...PAYMENT_TERMS,
    {
      heading: "What we are, legally",
      body:
        "Realty Marketplace introduces people and arranges viewings. We are not "
        + "a party to your lease or sale agreement, and the contract for the "
        + "property itself is between you and the renter or buyer.",
    },
  ],
} as const;

/**
 * Platform-Direct mode.
 *
 * The "What we are, legally" section is the reason this is a separate document
 * rather than a variant paragraph. In this mode the platform is not standing
 * outside the deal, and the clause has to say so in the same plain language as
 * everything else — someone who signs this should not be able to say later that
 * they thought they were dealing with an independent agent.
 */
const PLATFORM_DIRECT_CLAUSE = {
  mode: "platform_direct" as const,
  version: PLATFORM_DIRECT_CLAUSE_VERSION,
  title: "Commission agreement — Platform-Direct",
  summary:
    "Our own team will show this property and handle the sale. There is no "
    + "listing fee. If we introduce a buyer and you agree a sale with that "
    + `person within ${COMMISSION_WINDOW_MONTHS} months, our commission is owed `
    + "— even if the paperwork happens elsewhere.",
  terms: [
    ...SHARED_TERMS,
    {
      heading: "There is no listing fee",
      body:
        "You pay nothing to list this property and nothing month to month. We "
        + "are paid only if the property sells, out of the commission below.",
    },
    {
      heading: "How much it is",
      body:
        "Our commission is a percentage of the agreed sale price, confirmed "
        + "with you in writing before the deal is marked as agreed. Because our "
        + "own team carries out the viewings and handles the sale, the whole "
        + "commission comes to us — there is no separate agent fee on top. You "
        + "will never be charged a commission we have not shown you first.",
    },
    ...PAYMENT_TERMS,
    {
      heading: "What we are, legally — this is different",
      body:
        "On most listings we only introduce people and are not a party to the "
        + "deal. This one is not like that. Our own team acts as the agent for "
        + "this property: we show it, we negotiate, and we are directly "
        + "involved in the sale rather than standing outside it. Your listing "
        + "is labelled “Platform-Direct” wherever buyers see it, so they "
        + "know this too. The contract for the property itself is still between "
        + "you and the buyer.",
    },
  ],
} as const;

export type CommissionClause =
  | typeof INDEPENDENT_CLAUSE
  | typeof PLATFORM_DIRECT_CLAUSE;

/** The clause a listing in this mode must be shown and must agree to. */
export function commissionClauseFor(mode: ListingMode): CommissionClause {
  return mode === "platform_direct" ? PLATFORM_DIRECT_CLAUSE : INDEPENDENT_CLAUSE;
}

/**
 * The version string to record when an owner agrees.
 *
 * Always derived from the listing's own mode rather than passed in separately,
 * so a listing can never be recorded as having signed the other mode's terms.
 */
export function clauseVersionFor(mode: ListingMode): string {
  return commissionClauseFor(mode).version;
}
