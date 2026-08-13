-- ============================================================================
-- Stop listing owners writing platform-controlled fields
-- Phase 2 (feature/listings-core)
--
-- THE HOLE
--
-- RLS restricts which ROWS a user may touch and, through WITH CHECK, which
-- STATUS values they may set. It does not restrict which COLUMNS they may
-- write. The "listings: owner updates own" policy therefore allowed a landlord
-- to send, against their own listing:
--
--   PATCH /rest/v1/listings?id=eq.<theirs>
--   { "fee_waived": true, "listing_fee_paid": true, "view_count": 99999 }
--
-- ...and it succeeded. A landlord could grant themselves a free listing,
-- mark a fee paid that was never paid, and inflate their view count. Confirmed
-- against the live API as a genuine signed-in landlord before writing this.
--
-- This is exactly the hole closed for profiles.verified in Phase 1 by
-- guard_profile_privileged_fields. The same reasoning was never applied to
-- listings, which is the table where the money actually lives.
--
-- THE FIX
--
-- A column-level guard, mirroring the profiles and agents triggers. RLS
-- controls rows; triggers control columns; both are needed.
--
-- Protected here:
--   listing_fee_paid, fee_waived   money — the whole revenue model
--   view_count                     a public trust signal; self-inflation makes
--                                  it worthless
--   published_at                   set when an admin approves, nowhere else
--   booking_locked_at/by           the booking lock is the defence against the
--                                  documented double-rental scam. An owner who
--                                  could clear it could re-market a property
--                                  already promised to someone.
--
-- Deliberately NOT protected: status (RLS WITH CHECK already stops an owner
-- setting live/rejected), and rejection_reason (an owner clearing their own
-- feedback on resubmit is harmless and is what submitForReviewAction does).
-- ============================================================================

create or replace function public.guard_listing_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
begin
  -- Trusted server-side code: no logged-in user. Same signal the profiles and
  -- agents guards use — see the note in the Phase 1 schema migration.
  if auth.uid() is null then
    return new;
  end if;

  -- The fee-waiver function is SECURITY DEFINER, but that does NOT change
  -- auth.uid() — it is a request setting, not a database role — so without this
  -- escape hatch the trigger would block the platform's own waiver grant.
  -- The flag is transaction-local (the `true` argument), so it cannot leak into
  -- a later statement, and only that function ever sets it.
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

  return new;
end;
$$;

create trigger listings_guard_privileged_fields
  before update on public.listings
  for each row execute function public.guard_listing_privileged_fields();


-- ---------------------------------------------------------------------------
-- Teach the waiver function to announce itself, so the guard above lets its
-- one legitimate write through.
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
  v_already       boolean;
  v_used          integer;
  v_open_waived   integer;
begin
  perform pg_advisory_xact_lock(hashtext('realty:listing_fee_waiver'));

  select l.owner_id, l.status, l.fee_waived
    into v_owner_id, v_status, v_already
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

  -- Transaction-local, so it is gone the moment this statement's transaction
  -- ends and cannot authorise anything else the caller does afterwards.
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
