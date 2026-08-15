-- ============================================================================
-- Platform-Direct listings: listings.listing_mode
-- Phase 2 (feature/listings-core)
--
-- CLAUDE.md revenue model, added 2026-08-15:
--
--   "at listing creation, a landlord chooses between (a) independent agent —
--    existing 70/30 agent-favorable commission split, ₦5,000/month listing fee
--    — or (b) Platform-Direct — the platform's own in-house team conducts the
--    viewing and closes the deal directly, keeping 100% of the commission, no
--    listing fee charged."
--
-- This migration adds the field that decision hangs on, and the rules that keep
-- the two modes from bleeding into each other.
--
-- WHY SO MUCH OF THIS IS IN THE DATABASE
--
-- The mode decides whether money is owed at all. Anything that decides whether
-- money is owed belongs where it cannot be bypassed by a bug in a route handler
-- or a hand-crafted PATCH — the same reasoning that put the fee waiver and the
-- privileged-field guard down here rather than in the app.
--
-- Four rules are enforced below:
--
--   1. Platform-Direct is SALES ONLY to start (CLAUDE.md: "Scope to start:
--      sales only, not rentals"). A rental cannot be Platform-Direct.
--   2. A Platform-Direct listing owes no listing fee, so it may enter review
--      and go live without one — but it must also never CARRY one. Without that
--      second half, a Platform-Direct listing could quietly consume one of the
--      50 cold-start waivers it never needed, shrinking the subsidy pool for
--      the landlords it was meant for.
--   3. The mode is frozen once the listing leaves draft. Otherwise it is a
--      straightforward fee dodge: publish as Platform-Direct paying nothing,
--      then switch to independent and keep a live listing you never paid for.
--   4. Changing the mode un-signs the commission agreement, because the two
--      modes are not the same agreement — see the note on that trigger below.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The enum, and the column.
--
-- An enum rather than free text: Postgres then rejects a typo like
-- 'platform-direct' outright instead of storing it and quietly treating that
-- listing as neither mode.
--
-- Defaulting to 'independent' backfills every existing listing correctly —
-- they were all created under the independent-agent model, which was the only
-- one that existed when they were made.
-- ---------------------------------------------------------------------------
create type public.listing_mode as enum ('independent', 'platform_direct');

alter table public.listings
  add column listing_mode public.listing_mode not null default 'independent';

comment on column public.listings.listing_mode is
  'independent = outside agent, 70/30 split, monthly listing fee. '
  'platform_direct = in-house team closes it, 100% commission, no listing fee. '
  'Chosen by the owner at listing creation and frozen once submitted for review.';


-- Rule 1 — Platform-Direct is sales only for now.
alter table public.listings
  add constraint listings_platform_direct_is_sale_only
  check (listing_mode <> 'platform_direct' or type = 'sale');

comment on constraint listings_platform_direct_is_sale_only on public.listings is
  'Platform-Direct starts as sales only: larger commission per deal, and a '
  'workload a 2-3 person in-house team can actually carry.';


-- Rule 2a — Platform-Direct is exempt from the fee gate on review/publish.
--
-- Replaces the constraint added in 20260809120100. Without this a
-- Platform-Direct listing could never be submitted at all: it has no fee to
-- pay, so listing_fee_paid and fee_waived both stay false forever, and the old
-- constraint would block it at the review gate.
alter table public.listings
  drop constraint if exists listings_review_requires_settled_fee;

alter table public.listings
  add constraint listings_review_requires_settled_fee
  check (
    status not in ('pending_review', 'live')
    or listing_mode = 'platform_direct'
    or listing_fee_paid
    or fee_waived
  );

comment on constraint listings_review_requires_settled_fee on public.listings is
  'An independent-agent listing may not enter review or go live until its fee '
  'is paid or waived. Platform-Direct listings owe no listing fee.';


-- Rule 2b — and it must never carry a fee flag either.
--
-- This is the half that protects the cold-start pool: fee_waived is counted
-- against the 50-listing subsidy, so a Platform-Direct listing holding one
-- would take a free listing away from someone who actually needed it.
alter table public.listings
  add constraint listings_platform_direct_pays_no_fee
  check (
    listing_mode <> 'platform_direct'
    or (not listing_fee_paid and not fee_waived)
  );

comment on constraint listings_platform_direct_pays_no_fee on public.listings is
  'Platform-Direct listings pay no listing fee, so they must not hold one of '
  'the 50 cold-start waivers either.';


-- ---------------------------------------------------------------------------
-- Rule 3 — freeze the mode once the listing leaves draft.
--
-- Folded into the existing privileged-field guard rather than added as a
-- separate trigger, because it is the same kind of rule: a column an owner may
-- write at one moment and must not write at another. Keeping them together
-- means there is one place to look for "what can an owner not change?".
--
-- Everything else in this function is unchanged from 20260809120200.
-- ---------------------------------------------------------------------------
create or replace function public.guard_listing_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
begin
  if auth.uid() is null then
    return new;
  end if;

  if coalesce(current_setting('realty.privileged_listing_write', true), '') = 'on' then
    return new;
  end if;

  select p.role into actor_role
  from public.profiles p
  where p.user_id = auth.uid();

  if actor_role = 'admin' then
    return new;
  end if;

  if new.listing_fee_paid is distinct from old.listing_fee_paid
     or new.fee_waived is distinct from old.fee_waived then
    raise exception 'The listing fee is set by the platform, not by the listing owner.';
  end if;

  if new.view_count is distinct from old.view_count then
    raise exception 'View counts are recorded by the platform.';
  end if;

  if new.published_at is distinct from old.published_at then
    raise exception 'Publication time is set when a listing is approved.';
  end if;

  if new.booking_locked_at is distinct from old.booking_locked_at
     or new.booking_locked_by is distinct from old.booking_locked_by then
    raise exception 'Booking locks are managed by the platform.';
  end if;

  -- NEW: the mode is a commercial term. It may be changed freely while the
  -- listing is still being worked on, and not at all afterwards. Switching a
  -- live Platform-Direct listing to independent would leave a published
  -- listing that owes a fee nobody ever charged.
  if new.listing_mode is distinct from old.listing_mode
     and old.status not in ('draft', 'rejected') then
    raise exception 'How this listing is handled cannot be changed after it has been submitted for review.';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- Rule 4 — changing the mode un-signs the commission agreement.
--
-- The two modes are genuinely different agreements, not the same agreement at
-- two prices. Under independent mode the platform introduces people and is not
-- a party to the sale; under Platform-Direct its own team closes the deal, and
-- CLAUDE.md flags that as a deliberate, scoped departure from the facilitator
-- posture. The clause text says so, and says different things about the split.
--
-- listings.commission_clause_version exists precisely so nobody is held to
-- terms they never read. Carrying a signature across a mode change would break
-- that promise silently, which is the worst way to break it. So the signature
-- is cleared and the owner is sent back through the terms step.
--
-- This is a data-integrity rule, not a permission check, so unlike the guard
-- above it applies to admins and to server-side code as well. There is no
-- actor for whom a stale signature is correct.
--
-- ORDERING NOTE: Postgres fires BEFORE ROW triggers in trigger-NAME order.
-- This one is named to sort after listings_guard_privileged_fields on purpose —
-- the guard must get to reject an illegal mode change before this trigger
-- starts rewriting other columns in response to it.
-- ---------------------------------------------------------------------------
create or replace function public.apply_listing_mode_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.listing_mode is not distinct from old.listing_mode then
    return new;
  end if;

  -- Real money has already changed hands for this listing. Releasing a paid fee
  -- automatically would be quietly destroying a record of a payment that
  -- genuinely happened; refunding is a human decision, not a trigger's.
  if old.listing_fee_paid then
    raise exception 'This listing''s fee has already been paid, so how it is handled can no longer be changed here. Please get in touch and we will sort it out.';
  end if;

  new.commission_clause_agreed_at := null;
  new.commission_clause_version   := null;

  -- Switching to Platform-Direct returns any claimed waiver to the pool. It
  -- costs the owner nothing (their listing now has no fee at all) and puts a
  -- free listing back where another landlord can use it. This is also what
  -- keeps listings_platform_direct_pays_no_fee from rejecting the switch.
  if new.listing_mode = 'platform_direct' then
    new.fee_waived := false;
  end if;

  return new;
end;
$$;

create trigger listings_mode_change_effects
  before update on public.listings
  for each row execute function public.apply_listing_mode_change();


-- ---------------------------------------------------------------------------
-- The waiver function refuses Platform-Direct listings outright.
--
-- The constraint above would already reject the write, but a raw constraint
-- violation surfaces as a 500 and an unreadable Postgres error. A named reason
-- lets the app say something true and plain instead. Same rule, stated twice:
-- once so it cannot be broken, once so it can be explained.
--
-- Everything else is unchanged from 20260809120200.
-- ---------------------------------------------------------------------------
create or replace function public.claim_listing_fee_waiver(p_listing_id uuid)
returns table (granted boolean, waivers_used integer, waiver_cap integer, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap constant integer := 50;
  v_owner_id      uuid;
  v_status        public.listing_status;
  v_mode          public.listing_mode;
  v_already       boolean;
  v_used          integer;
  v_open_waived   integer;
begin
  perform pg_advisory_xact_lock(hashtext('realty:listing_fee_waiver'));

  select l.owner_id, l.status, l.listing_mode, l.fee_waived
    into v_owner_id, v_status, v_mode, v_already
    from public.listings l
   where l.id = p_listing_id;

  if v_owner_id is null then
    return query select false, 0, v_cap, 'not_found'::text;
    return;
  end if;

  if auth.uid() is not null and v_owner_id <> auth.uid() then
    return query select false, 0, v_cap, 'not_owner'::text;
    return;
  end if;

  -- Checked before the already-waived branch: a Platform-Direct listing has no
  -- fee to waive, so claiming one is meaningless rather than merely redundant.
  if v_mode = 'platform_direct' then
    select count(*)::integer into v_used from public.listings where fee_waived;
    return query select false, v_used, v_cap, 'platform_direct_no_fee'::text;
    return;
  end if;

  if v_already then
    select count(*)::integer into v_used from public.listings where fee_waived;
    return query select true, v_used, v_cap, 'already_waived'::text;
    return;
  end if;

  if v_status not in ('draft', 'rejected') then
    return query select false, 0, v_cap, 'not_editable'::text;
    return;
  end if;

  select count(*)::integer into v_used from public.listings where fee_waived;

  if v_used >= v_cap then
    return query select false, v_used, v_cap, 'pool_exhausted'::text;
    return;
  end if;

  select count(*)::integer
    into v_open_waived
    from public.listings l
   where l.owner_id = v_owner_id
     and l.fee_waived
     and l.status = 'draft'
     and l.id <> p_listing_id;

  if v_open_waived > 0 then
    return query select false, v_used, v_cap, 'owner_has_open_waiver'::text;
    return;
  end if;

  perform set_config('realty.privileged_listing_write', 'on', true);

  update public.listings
     set fee_waived = true
   where id = p_listing_id;

  perform set_config('realty.privileged_listing_write', 'off', true);

  return query select true, v_used + 1, v_cap, 'granted'::text;
end;
$$;

revoke execute on function public.claim_listing_fee_waiver(uuid) from public;
grant execute on function public.claim_listing_fee_waiver(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- The payment recorder refuses Platform-Direct listings too.
--
-- Belt and braces against a mistake that would be expensive to unpick: if a
-- Paystack webhook ever arrived carrying a Platform-Direct listing id, marking
-- it paid would violate listings_platform_direct_pays_no_fee and abort the
-- whole webhook transaction — including the payments row that records money we
-- have actually received. Recording the payment and leaving the listing alone
-- is far better: the money is not lost, and it surfaces as something a human
-- can look at rather than as a webhook that keeps failing and retrying.
--
-- Everything else is unchanged from 20260809120300.
-- ---------------------------------------------------------------------------
create or replace function public.record_listing_fee_payment(
  p_paystack_ref text,
  p_user_id      uuid,
  p_listing_id   uuid,
  p_amount_kobo  bigint,
  p_payload      jsonb
)
returns table (newly_processed boolean, payment_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_mode       public.listing_mode;
begin
  insert into public.payments (
    user_id, purpose, listing_id, amount_kobo, paystack_ref, status, paid_at, raw_payload
  )
  values (
    p_user_id, 'listing_fee', p_listing_id, p_amount_kobo, p_paystack_ref,
    'success', now(), p_payload
  )
  on conflict (paystack_ref) do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    select id into v_payment_id from public.payments where paystack_ref = p_paystack_ref;
    return query select false, v_payment_id;
    return;
  end if;

  select l.listing_mode into v_mode
    from public.listings l
   where l.id = p_listing_id;

  -- The payment is recorded either way. Only the listing flag is skipped.
  if v_mode is distinct from 'platform_direct' then
    perform set_config('realty.privileged_listing_write', 'on', true);

    update public.listings
       set listing_fee_paid = true
     where id = p_listing_id;

    perform set_config('realty.privileged_listing_write', 'off', true);
  end if;

  return query select true, v_payment_id;
end;
$$;

revoke execute on function public.record_listing_fee_payment(text, uuid, uuid, bigint, jsonb) from public;
grant execute on function public.record_listing_fee_payment(text, uuid, uuid, bigint, jsonb) to service_role;
