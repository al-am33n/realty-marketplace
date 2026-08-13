-- ============================================================================
-- First-50 listing fee waiver
-- Phase 2 (feature/listings-core)
--
-- CLAUDE.md revenue model: "Listing fee: waived for the first 50 listings
-- (cold-start subsidy), then a flat fee thereafter."
--
-- WHY THIS IS A DATABASE FUNCTION AND NOT APPLICATION CODE
--
-- The obvious implementation is: count the waivers used, and if it is under 50,
-- set fee_waived on this listing. That is a read followed by a write, and two
-- requests can interleave between the two halves:
--
--   Landlord A: count -> 49 waivers used, decides "one left"
--   Landlord B: count -> 49 waivers used, decides "one left"   (A hasn't written yet)
--   Landlord A: writes waiver #50
--   Landlord B: writes waiver #51
--
-- Both believed they took the last one. The subsidy quietly overruns, and every
-- concurrent pair after that makes it worse. CLAUDE.md calls this out directly:
-- money-critical operations run as atomic transactions, not multiple steps.
--
-- The advisory lock below serialises waiver claims against each other, so the
-- count and the write cannot be split apart. It locks nothing else — ordinary
-- listing reads and writes are unaffected.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- claim_listing_fee_waiver(listing_id)
--
-- Attempts to claim a free-listing waiver for the given listing.
-- Returns whether it was granted, plus the pool state for display.
--
-- Idempotent: calling it for a listing that already has a waiver returns
-- success without consuming another, so a double-tap on the payment step
-- cannot burn two waivers.
-- ---------------------------------------------------------------------------
create or replace function public.claim_listing_fee_waiver(p_listing_id uuid)
returns table (granted boolean, waivers_used integer, waiver_cap integer, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The cold-start subsidy size. Changing this is a business decision, so it
  -- lives here in one place rather than being scattered through the app.
  v_cap constant integer := 50;

  v_owner_id      uuid;
  v_status        public.listing_status;
  v_already       boolean;
  v_used          integer;
  v_open_waived   integer;
begin
  -- Serialise all waiver claims. Transaction-scoped, so it releases
  -- automatically on commit or rollback — no way to leak a stuck lock.
  perform pg_advisory_xact_lock(hashtext('realty:listing_fee_waiver'));

  select l.owner_id, l.status, l.fee_waived
    into v_owner_id, v_status, v_already
    from public.listings l
   where l.id = p_listing_id;

  if v_owner_id is null then
    return query select false, 0, v_cap, 'not_found'::text;
    return;
  end if;

  -- Ownership check. This function is SECURITY DEFINER, so it runs with rights
  -- that bypass RLS — meaning the usual policy protection does NOT apply here
  -- and the check has to be explicit. A null auth.uid() means trusted
  -- server-side code (the same signal the profile guard triggers use).
  if auth.uid() is not null and v_owner_id <> auth.uid() then
    return query select false, 0, v_cap, 'not_owner'::text;
    return;
  end if;

  -- Already waived: succeed without consuming another. Makes a repeated call
  -- harmless rather than expensive.
  if v_already then
    select count(*)::integer into v_used from public.listings where fee_waived;
    return query select true, v_used, v_cap, 'already_waived'::text;
    return;
  end if;

  -- Only a listing still being worked on can claim a waiver. A live or closed
  -- listing has already settled its fee one way or another.
  if v_status not in ('draft', 'rejected') then
    return query select false, 0, v_cap, 'not_editable'::text;
    return;
  end if;

  select count(*)::integer into v_used from public.listings where fee_waived;

  if v_used >= v_cap then
    return query select false, v_used, v_cap, 'pool_exhausted'::text;
    return;
  end if;

  -- Anti-abuse: one unsubmitted waived listing per owner at a time.
  --
  -- Without this, someone could create draft after draft, claim a waiver on
  -- each, and drain the whole 50-listing subsidy without ever publishing
  -- anything. Deliberately NOT a cap on waivers per owner overall — a landlord
  -- with twelve genuine properties is exactly who this subsidy is for. They
  -- just have to submit one before starting the next.
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

  update public.listings
     set fee_waived = true
   where id = p_listing_id;

  return query select true, v_used + 1, v_cap, 'granted'::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- listing_fee_waiver_status() — read-only pool state, for display.
--
-- Separate from the claim so a page can show "12 of 50 free listings left"
-- without consuming one just by being viewed.
-- ---------------------------------------------------------------------------
create or replace function public.listing_fee_waiver_status()
returns table (waivers_used integer, waiver_cap integer, waivers_left integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*)::integer as waivers_used,
    50 as waiver_cap,
    greatest(0, 50 - count(*))::integer as waivers_left
  from public.listings
  where fee_waived;
$$;

revoke execute on function public.claim_listing_fee_waiver(uuid) from public;
revoke execute on function public.listing_fee_waiver_status()   from public;

grant execute on function public.claim_listing_fee_waiver(uuid) to authenticated, service_role;
-- The pool figure is shown on the public-facing "list your property" pitch, so
-- logged-out visitors can see it too. It exposes only a count, never a listing.
grant execute on function public.listing_fee_waiver_status() to anon, authenticated, service_role;
