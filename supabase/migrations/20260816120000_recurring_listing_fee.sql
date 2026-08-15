-- ============================================================================
-- Recurring monthly listing fee
-- Phase 2 (feature/listings-core)
--
-- CLAUDE.md revenue model: "₦5,000/month, recurring — applies only to
-- independent-agent listings... First 50 listings get their first month free,
-- then billed ₦5,000/month from month 2 onward."
--
-- Up to now the code charged once and stopped. This adds the machinery that
-- makes the fee genuinely recurring.
--
-- ---------------------------------------------------------------------------
-- THE ONE THING THAT MATTERS MOST: NEVER CHARGE THE SAME MONTH TWICE
--
-- A recurring charge runs unattended, on a schedule, against somebody's saved
-- card. Nobody is watching it. The failure that actually hurts a small platform
-- is not a missed charge — it is billing a landlord twice for August because a
-- cron run overlapped with a retry, and then having to explain it.
--
-- Application logic cannot prevent that. "Check whether we already charged, then
-- charge" is two steps, and two runs can both pass the check before either
-- writes. So the guarantee is a UNIQUE INDEX: at most one open (pending or
-- successful) listing-fee payment may exist per listing per billing period. A
-- second attempt does not get a second charge; it gets a unique violation and
-- stops, decided by the database with no window in between.
--
-- This is the same mechanism as payments.paystack_ref, which already makes
-- duplicate webhook deliveries harmless. It is proven here and reused.
--
-- ---------------------------------------------------------------------------
-- WHY THE CLOCK STARTS AT APPROVAL, NOT AT PAYMENT
--
-- fee_paid_through is set when a listing goes LIVE, not when its fee settles.
-- A landlord claims their free first month at step 6 and might then take three
-- weeks to finish the photos, or sit in the review queue for a day. Starting
-- the clock at payment would burn most of the free month before a single buyer
-- could see the listing — charging for shelf time the platform never delivered.
-- A trigger sets it on the transition into 'live', so no code path can forget.
--
-- ---------------------------------------------------------------------------
-- WHY OVERDUE LISTINGS ARE HIDDEN RATHER THAN DELISTED
--
-- An unpaid listing stops being publicly visible after a grace period, but
-- keeps its status, its review approval and its photos. Paying brings it
-- straight back. Delisting would mean re-reviewing it by hand later — spending
-- the scarcest resource in the system to punish a late payment.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Two policy constants, in one place each.
--
-- Functions rather than bare literals because both are used inside an RLS
-- policy, where a repeated magic number would be genuinely dangerous: change it
-- in one of two places and listings silently appear or vanish.
-- ---------------------------------------------------------------------------

-- How long an overdue listing stays publicly visible before it is hidden.
-- Long enough to cover a card that expired over a weekend; short enough that
-- the fee still means something.
create or replace function public.listing_fee_grace()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '7 days' $$;

-- The length of one billing period.
create or replace function public.listing_fee_period()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '1 month' $$;

-- Callable from RLS policies, which run as the querying role.
grant execute on function public.listing_fee_grace() to anon, authenticated, service_role;
grant execute on function public.listing_fee_period() to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Listing-level billing state.
-- ---------------------------------------------------------------------------
alter table public.listings
  add column fee_paid_through    timestamptz,
  add column renewal_cancelled_at timestamptz;

comment on column public.listings.fee_paid_through is
  'End of the month this listing is currently paid up to. Set when the listing '
  'first goes live and extended by each successful renewal. NULL means billing '
  'has not started (still in review) or does not apply (Platform-Direct).';

comment on column public.listings.renewal_cancelled_at is
  'Set when the owner turns off renewal. The listing stays live until '
  'fee_paid_through passes — they keep what they already paid for.';

-- Platform-Direct listings owe nothing, ever, so they must never carry a
-- billing period. Same shape as listings_platform_direct_pays_no_fee: the rule
-- is stated once so it cannot be broken, and again in the app so it can be
-- explained.
alter table public.listings
  add constraint listings_platform_direct_has_no_billing_period
  check (listing_mode <> 'platform_direct' or fee_paid_through is null);

-- Every listing that is already live predates this column. Give them a full
-- month from today rather than treating them as instantly overdue — they were
-- published under the old one-off terms and it would be dishonest to backdate a
-- monthly obligation onto them.
update public.listings
   set fee_paid_through = now() + public.listing_fee_period()
 where status = 'live'
   and listing_mode is distinct from 'platform_direct'
   and fee_paid_through is null;


-- ---------------------------------------------------------------------------
-- Which billing period a payment bought.
--
-- The payments row already records that money moved. This records what it
-- bought, which is what makes reconciling a dispute months later possible
-- ("you charged me in October" — for which period?) and is what the uniqueness
-- guarantee below keys on.
-- ---------------------------------------------------------------------------
alter table public.payments
  add column period_end timestamptz;

comment on column public.payments.period_end is
  'For a recurring listing fee, the end of the month this payment bought. NULL '
  'for one-off payments and for commission invoices.';

-- THE DOUBLE-CHARGE GUARANTEE.
--
-- Partial, so it constrains only what needs constraining: a period may be
-- attempted again after a genuine failure (a declined card that the landlord
-- then tops up), but never while an attempt is still open or has already
-- succeeded.
create unique index payments_one_open_charge_per_period
  on public.payments (listing_id, period_end)
  where purpose = 'listing_fee'
    and period_end is not null
    and status in ('pending', 'success');

comment on index public.payments_one_open_charge_per_period is
  'At most one pending-or-successful listing-fee charge per listing per billing '
  'period. This is what makes double-charging impossible rather than unlikely.';


-- ---------------------------------------------------------------------------
-- Saved card authorizations.
--
-- WE NEVER STORE A CARD. Paystack returns an "authorization code" after a
-- successful card payment: an opaque token that only works when presented
-- alongside our own secret key, and only to charge that same customer. That is
-- what makes unattended renewal possible without the platform going anywhere
-- near card data, which is a compliance burden a free-tier build cannot carry.
--
-- Only cards produce a REUSABLE authorization. A landlord who pays by bank
-- transfer or USSD has nothing to renew against, so they fall back to being
-- invoiced each month and paying by hand. That path has to work anyway — a card
-- expires eventually — so it is not a lesser case.
-- ---------------------------------------------------------------------------
create table public.billing_authorizations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (user_id) on delete cascade,

  authorization_code text not null unique,

  -- Display only, so a landlord can recognise which card is on file. Paystack
  -- returns exactly this much; the full number never reaches us.
  last4              text,
  card_type          text,
  exp_month          text,
  exp_year           text,
  bank               text,

  active             boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index billing_authorizations_user on public.billing_authorizations (user_id)
  where active;

create trigger billing_authorizations_set_updated_at
  before update on public.billing_authorizations
  for each row execute function public.set_updated_at();

alter table public.billing_authorizations enable row level security;

-- No policies and no grants for anon or authenticated, deliberately. Nothing in
-- the browser ever needs to read this table: the app shows "Visa ending 4242"
-- from a server component using the service role. An authorization code is not
-- usable without our secret key, but there is no reason for it to leave the
-- server, so it does not.
grant all privileges on public.billing_authorizations to service_role;


-- ---------------------------------------------------------------------------
-- Start the billing clock when a listing goes live.
-- ---------------------------------------------------------------------------
create or replace function public.start_listing_billing_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'live'
     and old.status is distinct from 'live'
     and new.listing_mode is distinct from 'platform_direct'
     and new.fee_paid_through is null
  then
    new.fee_paid_through := now() + public.listing_fee_period();
  end if;

  return new;
end;
$$;

-- Named to sort after listings_guard_privileged_fields so the guard gets to
-- reject a forbidden write before this rewrites anything in response to it.
create trigger listings_start_billing_period
  before update on public.listings
  for each row execute function public.start_listing_billing_period();


-- ---------------------------------------------------------------------------
-- fee_paid_through joins the fields an owner may not write.
--
-- It is the single most valuable field in the table to an owner who wanted a
-- free listing: setting it to next year is indistinguishable from paying for a
-- year. Everything else in this function is unchanged from 20260815120000.
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

  if new.fee_paid_through is distinct from old.fee_paid_through then
    raise exception 'How long a listing is paid up for is set by the platform.';
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

  if new.listing_mode is distinct from old.listing_mode
     and old.status not in ('draft', 'rejected') then
    raise exception 'How this listing is handled cannot be changed after it has been submitted for review.';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- Hide listings whose fee has lapsed.
--
-- NOTE ON FAILING OPEN: a live listing with fee_paid_through IS NULL stays
-- visible. That case should not arise — the trigger above sets it on the way
-- into 'live' — but if some future bug ever leaves it null, the consequence of
-- this clause is that we under-collect on one listing. Without it, the
-- consequence would be an empty marketplace. When a visibility rule can fail in
-- two directions, it should fail in the recoverable one.
-- ---------------------------------------------------------------------------
drop policy if exists "listings: public reads live" on public.listings;

create policy "listings: public reads live"
  on public.listings for select
  to anon, authenticated
  using (
    status = 'live'
    and (
      listing_mode = 'platform_direct'
      or fee_paid_through is null
      or fee_paid_through > now() - public.listing_fee_grace()
    )
  );


-- ---------------------------------------------------------------------------
-- listings_due_for_fee() — the billing run's work list.
--
-- A listing is due when it is live, independent, and its paid-up date has
-- passed. Cancelled renewals are excluded: the owner asked us to stop, and
-- charging them anyway is the single fastest way to lose someone's trust.
-- ---------------------------------------------------------------------------
create or replace function public.listings_due_for_fee(p_limit integer default 200)
returns table (
  listing_id     uuid,
  owner_id       uuid,
  title          text,
  fee_paid_through timestamptz,
  next_period_end  timestamptz,
  overdue_since    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.id,
    l.owner_id,
    l.title,
    l.fee_paid_through,
    l.fee_paid_through + public.listing_fee_period(),
    l.fee_paid_through
  from public.listings l
  where l.status = 'live'
    and l.listing_mode = 'independent'
    and l.renewal_cancelled_at is null
    and l.fee_paid_through is not null
    and l.fee_paid_through <= now()
  order by l.fee_paid_through
  limit p_limit;
$$;

revoke execute on function public.listings_due_for_fee(integer) from public;
grant execute on function public.listings_due_for_fee(integer) to service_role;


-- ---------------------------------------------------------------------------
-- begin_listing_fee_charge(listing_id, amount_kobo)
--
-- Claims the right to charge one listing for one period, and returns the
-- reference to use. Everything that makes a double charge impossible is here.
--
-- The claim IS the insert. There is no "check then act" — the unique index
-- decides, atomically, whether this caller may proceed. A second concurrent run
-- gets unique_violation and is told the period is already in flight.
-- ---------------------------------------------------------------------------
create or replace function public.begin_listing_fee_charge(
  p_listing_id  uuid,
  p_amount_kobo bigint
)
returns table (claimed boolean, reference text, period_end timestamptz, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id    uuid;
  v_status      public.listing_status;
  v_mode        public.listing_mode;
  v_cancelled   timestamptz;
  v_paid_through timestamptz;
  v_period_end  timestamptz;
  v_attempt     integer;
  v_reference   text;
begin
  select l.owner_id, l.status, l.listing_mode, l.renewal_cancelled_at, l.fee_paid_through
    into v_owner_id, v_status, v_mode, v_cancelled, v_paid_through
    from public.listings l
   where l.id = p_listing_id;

  if v_owner_id is null then
    return query select false, null::text, null::timestamptz, 'not_found'::text;
    return;
  end if;

  if v_mode is distinct from 'independent' then
    return query select false, null::text, null::timestamptz, 'no_fee_for_mode'::text;
    return;
  end if;

  if v_status <> 'live' then
    return query select false, null::text, null::timestamptz, 'not_live'::text;
    return;
  end if;

  if v_cancelled is not null then
    return query select false, null::text, null::timestamptz, 'renewal_cancelled'::text;
    return;
  end if;

  if v_paid_through is null or v_paid_through > now() then
    return query select false, null::text, null::timestamptz, 'not_due'::text;
    return;
  end if;

  v_period_end := v_paid_through + public.listing_fee_period();

  -- Reap attempts that were started and never settled — a process killed
  -- mid-charge, a deploy at the wrong moment. Without this, one stuck row would
  -- block that listing's billing permanently, which is a worse failure than the
  -- one it protects against. 30 minutes is far longer than any Paystack call.
  update public.payments
     set status = 'abandoned'
   where purpose = 'listing_fee'
     and listing_id = p_listing_id
     and period_end = v_period_end
     and status = 'pending'
     and created_at < now() - interval '30 minutes';

  select count(*)::integer + 1
    into v_attempt
    from public.payments
   where purpose = 'listing_fee'
     and listing_id = p_listing_id
     and period_end = v_period_end;

  -- The reference is deterministic in listing and period, and carries the
  -- attempt number so a retry after a genuine failure is a new reference rather
  -- than a collision. Readable from the Paystack dashboard alone, which is
  -- where a dispute gets settled.
  v_reference := 'lfee_' || p_listing_id::text
                 || '_' || extract(epoch from v_period_end)::bigint::text
                 || '_a' || v_attempt::text;

  begin
    insert into public.payments (
      user_id, purpose, listing_id, amount_kobo, paystack_ref, status, period_end
    )
    values (
      v_owner_id, 'listing_fee', p_listing_id, p_amount_kobo, v_reference, 'pending', v_period_end
    );
  exception
    when unique_violation then
      -- Either another run claimed this period a moment ago, or this exact
      -- reference already exists. Both mean: not ours to charge.
      return query select false, null::text, v_period_end, 'already_in_flight'::text;
      return;
  end;

  return query select true, v_reference, v_period_end, 'claimed'::text;
end;
$$;

revoke execute on function public.begin_listing_fee_charge(uuid, bigint) from public;
grant execute on function public.begin_listing_fee_charge(uuid, bigint) to service_role;


-- ---------------------------------------------------------------------------
-- settle_listing_fee_charge(reference, succeeded, payload)
--
-- Closes out a claimed attempt. On success the listing's paid-up date moves to
-- the period that was bought — NOT to "now + a month", which would quietly gift
-- free days every time a charge ran late.
-- ---------------------------------------------------------------------------
create or replace function public.settle_listing_fee_charge(
  p_reference text,
  p_succeeded boolean,
  p_payload   jsonb default null
)
returns table (settled boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_listing_id uuid;
  v_period_end timestamptz;
  v_status     public.payment_status;
begin
  select p.id, p.listing_id, p.period_end, p.status
    into v_payment_id, v_listing_id, v_period_end, v_status
    from public.payments p
   where p.paystack_ref = p_reference
   for update;

  if v_payment_id is null then
    return query select false, 'unknown_reference'::text;
    return;
  end if;

  -- Already settled. A duplicate webhook, or a settle racing the run that
  -- started it. Neither should move the paid-up date a second time.
  if v_status <> 'pending' then
    return query select false, 'already_settled'::text;
    return;
  end if;

  if not p_succeeded then
    update public.payments
       set status = 'failed', raw_payload = coalesce(p_payload, raw_payload)
     where id = v_payment_id;
    return query select true, 'failed'::text;
    return;
  end if;

  update public.payments
     set status = 'success', paid_at = now(), raw_payload = coalesce(p_payload, raw_payload)
   where id = v_payment_id;

  perform set_config('realty.privileged_listing_write', 'on', true);

  update public.listings
     set fee_paid_through = v_period_end,
         listing_fee_paid = true
   where id = v_listing_id;

  perform set_config('realty.privileged_listing_write', 'off', true);

  return query select true, 'succeeded'::text;
end;
$$;

revoke execute on function public.settle_listing_fee_charge(text, boolean, jsonb) from public;
grant execute on function public.settle_listing_fee_charge(text, boolean, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- cancel_listing_renewal / resume_listing_renewal
--
-- The owner's own switch. Cancelling does NOT take the listing down: they keep
-- the month they already paid for. A platform that pulls a listing the moment
-- someone opts out of renewal is charging for a service it then withdraws.
-- ---------------------------------------------------------------------------
create or replace function public.set_listing_renewal(p_listing_id uuid, p_renew boolean)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
begin
  select l.owner_id into v_owner_id
    from public.listings l
   where l.id = p_listing_id;

  if v_owner_id is null then
    return query select false, 'not_found'::text;
    return;
  end if;

  -- SECURITY DEFINER bypasses RLS, so ownership is checked explicitly. A null
  -- auth.uid() means trusted server-side code, as elsewhere.
  if auth.uid() is not null and v_owner_id <> auth.uid() then
    return query select false, 'not_owner'::text;
    return;
  end if;

  perform set_config('realty.privileged_listing_write', 'on', true);

  update public.listings
     set renewal_cancelled_at = case when p_renew then null else now() end
   where id = p_listing_id;

  perform set_config('realty.privileged_listing_write', 'off', true);

  return query select true, case when p_renew then 'resumed' else 'cancelled' end;
end;
$$;

revoke execute on function public.set_listing_renewal(uuid, boolean) from public;
grant execute on function public.set_listing_renewal(uuid, boolean) to authenticated, service_role;
