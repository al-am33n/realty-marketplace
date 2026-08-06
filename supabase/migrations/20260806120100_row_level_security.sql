-- ============================================================================
-- Realty Marketplace — Row Level Security (RLS)
-- Phase 1 (feature/foundation)
--
-- WHAT RLS IS, AND WHY IT MATTERS HERE
--
-- Normally an app protects data in application code: "if the logged-in user
-- isn't the owner, don't show this." That works until one API route forgets the
-- check, or a query is written slightly wrong, and suddenly one landlord can
-- read another's listings. The check lives in a hundred places, so it only has
-- to be missed once.
--
-- Row Level Security moves the rule into the database itself. Postgres attaches
-- an invisible WHERE clause to every single query. A landlord asking for "all
-- listings" physically receives only their own rows — not because our code
-- filtered them, but because the database refused to return the others. Buggy
-- code, a leaked API key used from a browser, a hand-written query: all still
-- constrained.
--
-- CLAUDE.md: "RLS policies enforced at the database level from the start — not
-- just app-level checks." This file is that promise.
--
-- IMPORTANT: RLS applies to the `anon` and `authenticated` keys (anything the
-- browser uses). It is deliberately BYPASSED by the `service_role` key, which
-- is why that key must only ever live in server environment variables and must
-- never reach the browser.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Turn RLS on everywhere.
--
-- Until a table has at least one policy, RLS means "deny everything". Locking
-- first and granting deliberately afterwards is the safe order: a table we
-- forget to write policies for fails closed, not open.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.agents   enable row level security;
alter table public.listings enable row level security;
alter table public.bookings enable row level security;
alter table public.deals    enable row level security;
alter table public.payments enable row level security;


-- ---------------------------------------------------------------------------
-- Helper functions
--
-- These answer "who is asking?" for use inside policies.
--
-- They MUST be `security definer`. A policy on `profiles` that needs to look up
-- a role by reading `profiles` would trigger the same policy again, forever —
-- infinite recursion, and Postgres errors out. `security definer` runs the
-- function as its owner, which bypasses RLS and breaks the loop.
--
-- `stable` tells Postgres the answer won't change during a single query, so it
-- can call the function once instead of once per row — a large difference on a
-- search results page.
-- ---------------------------------------------------------------------------

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.user_id = (select auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'admin' from public.profiles p where p.user_id = (select auth.uid())),
    false
  );
$$;

-- "Has this user passed phone OTP verification, and are they in good standing?"
-- This is the gate app-flow.docx §1 requires before a listing can be created.
create or replace function public.is_verified_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.verified and not p.banned
     from public.profiles p where p.user_id = (select auth.uid())),
    false
  );
$$;

-- The agents.id belonging to the current user, or null if they aren't an agent.
create or replace function public.my_agent_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.agents a where a.profile_id = (select auth.uid());
$$;

-- Lock these down: they are internal plumbing for policies, not a public API.
revoke execute on function public.current_user_role()  from public, anon, authenticated;
revoke execute on function public.is_admin()           from public, anon, authenticated;
revoke execute on function public.is_verified_active() from public, anon, authenticated;
revoke execute on function public.my_agent_id()        from public, anon, authenticated;


-- ===========================================================================
-- profiles
--
-- Private data (phone numbers especially). Default posture: you see yourself,
-- and nobody else — with two narrow, justified exceptions.
-- ===========================================================================

create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "profiles: admin reads all"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

-- app-flow.docx §3: "Tapping a viewing — shows listing details, renter contact
-- info". An agent needs the phone number of the person they are meeting, but
-- ONLY for someone actually assigned to them, and only while that viewing is
-- live. Scoped as tightly as the feature allows.
create policy "profiles: assigned agent reads their viewer"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1
      from public.bookings b
      where b.requester_id = public.profiles.user_id
        and b.agent_id = public.my_agent_id()
        and b.status in ('requested', 'confirmed', 'completed')
    )
  );

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- Reminder: WHICH COLUMNS may change is enforced by the
-- profiles_guard_privileged_fields trigger in the previous migration. RLS
-- controls rows; the trigger controls columns. Both are needed — this policy
-- alone would let a user set their own verified = true.

create policy "profiles: admin updates any"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No INSERT policy on purpose: profiles are created solely by the
-- handle_new_user trigger at sign-up. No DELETE policy: profiles disappear via
-- cascade when the auth account is deleted.


-- ===========================================================================
-- agents
--
-- Public trust data. UI spec: the verified badge, rating and completion rate
-- are "visible to anyone browsing" — including logged-out visitors, so `anon`
-- is granted here too.
-- ===========================================================================

create policy "agents: public reads active agents"
  on public.agents for select
  to anon, authenticated
  using (active);

create policy "agents: read own record"
  on public.agents for select
  to authenticated
  using (profile_id = (select auth.uid()));

create policy "agents: admin reads all"
  on public.agents for select
  to authenticated
  using (public.is_admin());

-- An agent may register themselves, but `active` defaults to false, so they are
-- invisible and unassignable until an admin vets and activates them. Every
-- agent on the platform is therefore vetted by a human.
create policy "agents: self-register"
  on public.agents for insert
  to authenticated
  with check (
    profile_id = (select auth.uid())
    and public.current_user_role() = 'agent'
    and not active
  );

create policy "agents: admin creates"
  on public.agents for insert
  to authenticated
  with check (public.is_admin());

create policy "agents: update own"
  on public.agents for update
  to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
-- Column-level protection (rating, active, counters) is the
-- agents_guard_privileged_fields trigger.

create policy "agents: admin updates any"
  on public.agents for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "agents: admin deletes"
  on public.agents for delete
  to authenticated
  using (public.is_admin());


-- ===========================================================================
-- listings
-- ===========================================================================

-- The public search. Note it grants exactly one status: `live`. Drafts,
-- pending-review and rejected listings are invisible to the world, which is
-- what makes "every listing manually reviewed before going live" real rather
-- than aspirational — an unapproved listing is not merely hidden by the UI, it
-- cannot be fetched at all.
create policy "listings: public reads live"
  on public.listings for select
  to anon, authenticated
  using (status = 'live');

create policy "listings: owner reads own"
  on public.listings for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "listings: admin reads all"
  on public.listings for select
  to authenticated
  using (public.is_admin());

-- An agent needs to see a listing they've been assigned to show, even if it has
-- since been closed or locked.
create policy "listings: assigned agent reads"
  on public.listings for select
  to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.listing_id = public.listings.id
        and b.agent_id = public.my_agent_id()
    )
  );

-- Creation gate, all four conditions required:
--   * you may only create listings owned by yourself
--   * only landlords and agents may list at all
--   * you must be phone-verified and not banned  <- the OTP gate
--   * it must start as a draft, never straight to live
create policy "listings: verified owner creates draft"
  on public.listings for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.current_user_role() in ('landlord', 'agent')
    and public.is_verified_active()
    and status = 'draft'
  );

-- Owners edit their own listings, but CANNOT set status to 'live' or
-- 'rejected'. Those two transitions belong to admin review alone. This is the
-- database-level half of the manual-review guarantee: even a compromised
-- landlord account cannot publish itself.
create policy "listings: owner updates own"
  on public.listings for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and status in ('draft', 'pending_review', 'closed')
  );

create policy "listings: admin updates any"
  on public.listings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Only drafts can be deleted by their owner. Once a listing has entered review
-- or gone live it has an audit trail (bookings, possibly deals) attached to it,
-- so it gets closed rather than erased.
create policy "listings: owner deletes own draft"
  on public.listings for delete
  to authenticated
  using (owner_id = (select auth.uid()) and status = 'draft');

create policy "listings: admin deletes any"
  on public.listings for delete
  to authenticated
  using (public.is_admin());


-- ===========================================================================
-- bookings
-- ===========================================================================

create policy "bookings: requester reads own"
  on public.bookings for select
  to authenticated
  using (requester_id = (select auth.uid()));

create policy "bookings: assigned agent reads"
  on public.bookings for select
  to authenticated
  using (agent_id = public.my_agent_id());

-- The landlord can see viewing activity on their own property.
create policy "bookings: listing owner reads"
  on public.bookings for select
  to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = public.bookings.listing_id
        and l.owner_id = (select auth.uid())
    )
  );

create policy "bookings: admin reads all"
  on public.bookings for select
  to authenticated
  using (public.is_admin());

-- You can only request a viewing on a listing that is actually live, and only
-- as yourself. `status = 'requested'` prevents someone creating a booking
-- already marked confirmed, which would skip agent assignment entirely.
create policy "bookings: verified user requests viewing"
  on public.bookings for insert
  to authenticated
  with check (
    requester_id = (select auth.uid())
    and public.is_verified_active()
    and status = 'requested'
    and agent_id is null
    and exists (
      select 1 from public.listings l
      where l.id = listing_id and l.status = 'live'
    )
  );

-- The requester can cancel; that is the only change they may make.
create policy "bookings: requester cancels own"
  on public.bookings for update
  to authenticated
  using (requester_id = (select auth.uid()) and status in ('requested', 'confirmed'))
  with check (requester_id = (select auth.uid()) and status = 'cancelled');

-- The assigned agent confirms a slot and later marks it completed.
create policy "bookings: assigned agent manages"
  on public.bookings for update
  to authenticated
  using (agent_id = public.my_agent_id())
  with check (agent_id = public.my_agent_id());

create policy "bookings: admin updates any"
  on public.bookings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "bookings: admin deletes"
  on public.bookings for delete
  to authenticated
  using (public.is_admin());

-- NOTE for Phase 4: agent ASSIGNMENT is deliberately not grantable here — an
-- agent must not be able to assign themselves to any booking they like, which
-- would let them poach viewings. Assignment happens server-side (service role)
-- inside the same atomic transaction that sets the listing's booking lock.


-- ===========================================================================
-- deals
-- ===========================================================================

create policy "deals: participant reads"
  on public.deals for select
  to authenticated
  using (
    buyer_renter_id = (select auth.uid())
    or agent_id = public.my_agent_id()
    or exists (
      select 1 from public.listings l
      where l.id = public.deals.listing_id
        and l.owner_id = (select auth.uid())
    )
  );

create policy "deals: admin reads all"
  on public.deals for select
  to authenticated
  using (public.is_admin());

-- app-flow.docx §3: a deal is opened by the agent from a completed viewing.
create policy "deals: agent opens own"
  on public.deals for insert
  to authenticated
  with check (agent_id = public.my_agent_id() and status = 'negotiating');

create policy "deals: admin creates"
  on public.deals for insert
  to authenticated
  with check (public.is_admin());

create policy "deals: agent updates own"
  on public.deals for update
  to authenticated
  using (agent_id = public.my_agent_id())
  with check (agent_id = public.my_agent_id());

create policy "deals: admin updates any"
  on public.deals for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "deals: admin deletes"
  on public.deals for delete
  to authenticated
  using (public.is_admin());


-- ===========================================================================
-- payments
--
-- Read-only to users; nobody in a browser may write here at all.
--
-- There is intentionally no INSERT or UPDATE policy. Because RLS denies
-- anything not explicitly allowed, payment rows can only be created or changed
-- by the `service_role` key — i.e. by our server-side Paystack webhook handler.
-- A user cannot mark their own listing fee as paid, however creative they get
-- with the browser console. Money state changes on the word of Paystack, never
-- on the word of a client.
-- ===========================================================================

create policy "payments: read own"
  on public.payments for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "payments: admin reads all"
  on public.payments for select
  to authenticated
  using (public.is_admin());


-- ===========================================================================
-- Belt and braces
--
-- RLS decides which rows a role may touch, but a role must also hold the
-- ordinary SQL privilege on the table. Postgres checks BOTH. Revoking the
-- blunt privileges we never want means a mistake in a policy above still can't
-- turn into a public data leak.
-- ===========================================================================

revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

revoke all on public.profiles from anon;
