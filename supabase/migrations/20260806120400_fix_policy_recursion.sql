-- ============================================================================
-- Fix infinite recursion between RLS policies
-- Phase 1 (feature/foundation)
--
-- THE BUG
--
-- Five policies contained an inline EXISTS subquery against a DIFFERENT table:
--
--   listings  "assigned agent reads"        -> queries bookings
--   bookings  "listing owner reads"         -> queries listings
--   bookings  "verified user requests..."   -> queries listings
--   profiles  "assigned agent reads..."     -> queries bookings
--   deals     "participant reads"           -> queries listings
--
-- A policy expression is evaluated with the privileges of the querying user, so
-- those subqueries are themselves subject to RLS. Reading `listings` ran the
-- listings policies, which queried `bookings`, which ran the bookings policies,
-- which queried `listings`... Postgres detects the cycle and aborts the entire
-- statement:
--
--   42P17: infinite recursion detected in policy for relation "..."
--
-- The effect was total, not partial: every read and write on profiles,
-- listings, bookings and deals failed with HTTP 500 for signed-in users. It did
-- NOT show up in the schema catalog — every table, policy and grant looked
-- exactly right — and anonymous access worked fine, because the public policies
-- are plain column comparisons that touch no other table. Only acting as a real
-- signed-in user surfaced it.
--
-- THE FIX
--
-- Move every cross-table check into a SECURITY DEFINER function. Those run as
-- the function owner, which owns the tables and therefore bypasses RLS, so the
-- inner lookup does not re-enter the policy system and the cycle is broken.
-- This is the same reason the existing is_admin()/my_agent_id() helpers are
-- SECURITY DEFINER; these five checks simply needed the same treatment.
--
-- Each function is deliberately narrow — it answers one yes/no question about
-- the CURRENT user and leaks nothing else, so bypassing RLS inside it does not
-- widen what anybody can see.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- Does the current user own this listing?
create or replace function public.is_listing_owner(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.listings l
    where l.id = p_listing_id
      and l.owner_id = (select auth.uid())
  );
$$;

-- Is this listing publicly live? Used by the booking INSERT check so nobody can
-- request a viewing on a draft, rejected or closed property.
create or replace function public.is_listing_live(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.listings l
    where l.id = p_listing_id
      and l.status = 'live'
  );
$$;

-- Is the current user an agent with any booking against this listing?
create or replace function public.agent_has_booking_on_listing(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.listing_id = p_listing_id
      and b.agent_id = public.my_agent_id()
  );
$$;

-- Is this person the requester on one of the current agent's viewings?
-- Backs the narrow exception that lets an agent see the contact details of
-- someone they are actually meeting.
create or replace function public.agent_serves_requester(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.requester_id = p_user_id
      and b.agent_id = public.my_agent_id()
      and b.status in ('requested', 'confirmed', 'completed')
  );
$$;

revoke execute on function public.is_listing_owner(uuid)              from public;
revoke execute on function public.is_listing_live(uuid)               from public;
revoke execute on function public.agent_has_booking_on_listing(uuid)  from public;
revoke execute on function public.agent_serves_requester(uuid)        from public;

-- As with the other helpers: policy expressions are evaluated as the querying
-- role, so `authenticated` must be able to call these or every policy using
-- them fails with "permission denied for function".
grant execute on function public.is_listing_owner(uuid)             to authenticated;
grant execute on function public.is_listing_live(uuid)              to authenticated;
grant execute on function public.agent_has_booking_on_listing(uuid) to authenticated;
grant execute on function public.agent_serves_requester(uuid)       to authenticated;


-- ---------------------------------------------------------------------------
-- Replace the five recursive policies
-- ---------------------------------------------------------------------------

drop policy if exists "profiles: assigned agent reads their viewer" on public.profiles;
create policy "profiles: assigned agent reads their viewer"
  on public.profiles for select
  to authenticated
  using (public.agent_serves_requester(user_id));

drop policy if exists "listings: assigned agent reads" on public.listings;
create policy "listings: assigned agent reads"
  on public.listings for select
  to authenticated
  using (public.agent_has_booking_on_listing(id));

drop policy if exists "bookings: listing owner reads" on public.bookings;
create policy "bookings: listing owner reads"
  on public.bookings for select
  to authenticated
  using (public.is_listing_owner(listing_id));

drop policy if exists "bookings: verified user requests viewing" on public.bookings;
create policy "bookings: verified user requests viewing"
  on public.bookings for insert
  to authenticated
  with check (
    requester_id = (select auth.uid())
    and public.is_verified_active()
    and status = 'requested'
    and agent_id is null
    and public.is_listing_live(listing_id)
  );

drop policy if exists "deals: participant reads" on public.deals;
create policy "deals: participant reads"
  on public.deals for select
  to authenticated
  using (
    buyer_renter_id = (select auth.uid())
    or agent_id = public.my_agent_id()
    or public.is_listing_owner(listing_id)
  );
