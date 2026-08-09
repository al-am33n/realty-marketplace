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
 * WHY THIS IS VERSIONED
 *
 * `listings.commission_clause_version` records WHICH wording the owner agreed
 * to, alongside the timestamp of when. If the wording is ever revised, existing
 * listings stay bound to the text their owner actually read — nobody is
 * retroactively held to terms they never saw.
 *
 * So: when changing the wording below, add a NEW version rather than editing an
 * existing one, and bump CURRENT_VERSION.
 * ---------------------------------------------------------------------------
 */

export const COMMISSION_CLAUSE_VERSION = "v1";

/**
 * Deliberately plain language, not legalese.
 *
 * The target user may never have used a formal property platform, and
 * app-flow.docx §6 asks the first-run experience to over-explain rather than
 * assume familiarity. Terms nobody reads protect nobody — a clause the owner
 * actually understood is far more likely to be honoured, and far more
 * defensible if it is not.
 *
 * NOT LEGAL ADVICE: this wording should be reviewed by a Nigerian lawyer before
 * real money depends on it. The enforceability window in particular (6 vs 12
 * months) is still an open question in the project brief.
 */
export const COMMISSION_CLAUSE = {
  version: COMMISSION_CLAUSE_VERSION,
  title: "Commission agreement",
  summary:
    "If we introduce someone to your property and a deal closes with that "
    + "person, our commission is owed — even if the paperwork happens "
    + "elsewhere.",
  terms: [
    {
      heading: "What you are agreeing to",
      body:
        "If Realty Marketplace introduces a renter or buyer to this property "
        + "and a rental or sale is agreed with that person, you agree to pay "
        + "our commission on that deal.",
    },
    {
      heading: "This applies even if the deal happens off the platform",
      body:
        "The commission is owed because we made the introduction, not because "
        + "the paperwork ran through our website. Completing the deal privately "
        + "with someone we introduced does not remove what is owed.",
    },
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
    {
      heading: "What we are, legally",
      body:
        "Realty Marketplace introduces people and arranges viewings. We are not "
        + "a party to your lease or sale agreement, and the contract for the "
        + "property itself is between you and the renter or buyer.",
    },
  ],
} as const;
