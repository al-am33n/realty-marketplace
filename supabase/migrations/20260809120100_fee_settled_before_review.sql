-- ============================================================================
-- Require a settled listing fee BEFORE review, not just before publishing
-- Phase 2 (feature/listings-core)
--
-- The Phase 1 constraint only guarded the `live` status:
--
--   check (status <> 'live' or listing_fee_paid or fee_waived)
--
-- which let a listing enter `pending_review` with no fee paid and no waiver
-- claimed. Two problems with that:
--
--   1. app-flow.docx §1 puts the fee at step 6, BEFORE submission. The database
--      was permitting an ordering the product does not have.
--   2. It wastes the scarcest resource in the whole system — human review time.
--      A reviewer would open the listing, work through it, and only discover at
--      the approve step that it cannot be published. The admin screen warns
--      about this, but a warning is a patch over a rule the database should
--      simply enforce.
--
-- The application already refuses to submit an unpaid listing (readyToSubmit).
-- This puts the same rule where it cannot be bypassed — money rules belong in
-- the database, per CLAUDE.md, not only in the code path that happens to be
-- taken today.
--
-- Found by the Phase 2 end-to-end test asserting the database would refuse it.
-- It did not; the constraint was narrower than the product rule.
-- ============================================================================

alter table public.listings
  drop constraint if exists listings_live_requires_settled_fee;

alter table public.listings
  add constraint listings_review_requires_settled_fee
  check (
    status not in ('pending_review', 'live')
    or listing_fee_paid
    or fee_waived
  );

comment on constraint listings_review_requires_settled_fee on public.listings is
  'A listing may not enter review or go live until its fee is paid or waived.';
