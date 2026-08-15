-- ============================================================================
-- listing_mode: allow "not chosen yet"
-- Phase 2 (feature/listings-core)
--
-- A follow-up to 20260815120000 rather than an edit to it, because that
-- migration has already been applied to the remote database. Editing an applied
-- migration leaves the file and the database describing different things, and
-- the next `supabase db push` on a fresh machine would build a schema nobody
-- has ever run. Corrections go forward, never backward.
--
-- WHAT WAS WRONG
--
-- The column was added as `not null default 'independent'`. That backfills
-- existing listings correctly — they were all independent — but it also means a
-- brand-new draft already claims a mode its owner has never been asked about.
-- The screen would then render the independent option pre-ticked, and CLAUDE.md
-- is explicit that it must not be:
--
--   "The choice must be presented neutrally in the UI — not pre-selected or
--    worded to nudge toward whichever option is more profitable for the
--    platform."
--
-- A pre-ticked default is the strongest nudge an interface has: most people
-- never change it. Honouring that line means the database has to be able to say
-- "no answer yet", which is what NULL is for.
--
-- The rule that replaces NOT NULL is narrower and truer: a listing may sit in
-- draft without a mode, but it may not enter review or go live without one.
-- ============================================================================

alter table public.listings
  alter column listing_mode drop default;

-- Every listing that exists today predates this choice and was created under
-- the independent-agent model. Stating that explicitly, before dropping NOT
-- NULL, means the backfill is a deliberate statement about those rows rather
-- than a side effect of the column default.
update public.listings
   set listing_mode = 'independent'
 where listing_mode is null;

alter table public.listings
  alter column listing_mode drop not null;

comment on column public.listings.listing_mode is
  'independent = outside agent, 70/30 split, monthly listing fee. '
  'platform_direct = in-house team closes it, 100% commission, no listing fee. '
  'NULL means the owner has not been asked yet — the choice is presented '
  'neutrally, with neither option pre-selected. Required before review, and '
  'frozen once submitted.';


-- The choice must be made before a human ever looks at the listing: it decides
-- who runs the viewing, what the commission split is, and whether a fee is owed.
-- A reviewer cannot sensibly approve a listing whose commercial terms are blank.
alter table public.listings
  add constraint listings_mode_chosen_before_review
  check (status = 'draft' or listing_mode is not null);

comment on constraint listings_mode_chosen_before_review on public.listings is
  'A listing may be drafted without choosing how it is handled, but not '
  'submitted for review without it.';


-- ---------------------------------------------------------------------------
-- Re-state the fee constraint without relying on three-valued logic.
--
-- The version in 20260815120000 read:
--
--   status not in ('pending_review','live') or listing_mode = 'platform_direct'
--     or listing_fee_paid or fee_waived
--
-- With a NULL mode, `listing_mode = 'platform_direct'` is NULL rather than
-- false, so for a pending_review row with no fee the whole expression collapses
-- to NULL — and a CHECK constraint only rejects FALSE. NULL passes. That is the
-- exact trap that let a listing with zero photos out of draft in Phase 1
-- (array_length returning NULL), and it would have let an unpaid listing into
-- the review queue here.
--
-- The constraint added above makes a NULL mode at pending_review impossible in
-- the first place, so this is a second lock on the same door. Both are cheap;
-- money rules are worth locking twice.
-- ---------------------------------------------------------------------------
alter table public.listings
  drop constraint if exists listings_review_requires_settled_fee;

alter table public.listings
  add constraint listings_review_requires_settled_fee
  check (
    status not in ('pending_review', 'live')
    or coalesce(listing_mode = 'platform_direct', false)
    or listing_fee_paid
    or fee_waived
  );

comment on constraint listings_review_requires_settled_fee on public.listings is
  'An independent-agent listing may not enter review or go live until its fee '
  'is paid or waived. Platform-Direct listings owe no listing fee.';
