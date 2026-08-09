-- ============================================================================
-- Realty Marketplace — Initial schema
-- Phase 1 (feature/foundation)
--
-- Creates the six core tables from CLAUDE.md, plus the enums, constraints,
-- indexes and triggers they need. Row Level Security policies live in the
-- NEXT migration file, so this one is purely "what data exists".
--
-- MONEY NOTE: every money column is a BIGINT holding KOBO (1 naira = 100 kobo),
-- never a decimal/float. Floats cannot represent money exactly (0.1 + 0.2 is
-- famously not 0.3 in binary floating point), and rounding drift on a
-- commission calculation is a real financial bug. Paystack's API also works in
-- kobo, so storing kobo means no conversion at the payment boundary.
-- BIGINT because a ₦500,000,000 property is 50,000,000,000 kobo — far past the
-- 2.1 billion ceiling of a normal INTEGER.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Enums
--
-- An enum is a custom type with a fixed list of allowed values. Using one means
-- the DATABASE rejects a typo like 'landlrd' — the bad value can never be
-- stored, no matter which piece of code tried to write it.
-- ---------------------------------------------------------------------------

create type public.user_role as enum (
  'renter_buyer',
  'landlord',
  'agent',
  'admin'
);

create type public.listing_type as enum (
  'rent',
  'sale'
  -- 'short_let' is deliberately absent: Phase 2 per the launch scope.
);

create type public.property_type as enum (
  'apartment',
  'house',
  'duplex',
  'bungalow',
  'self_contain',
  'room_and_parlour',
  'land',
  'commercial'
);

create type public.listing_status as enum (
  'draft',           -- being written, never publicly visible
  'pending_review',  -- submitted; waiting on manual admin review
  'live',            -- approved and publicly searchable
  'rejected',        -- admin rejected it; reason sent to owner
  'closed'           -- deal done or withdrawn; auto-delisted
);

create type public.booking_status as enum (
  'requested',
  'confirmed',
  'completed',
  'cancelled'
);

-- Reconciled from app-flow.docx §4, which is more granular than the sketch in
-- CLAUDE.md ('open' there covers negotiating/agreed/payment here).
create type public.deal_status as enum (
  'negotiating',
  'agreed',
  'payment',
  'closed_won',
  'closed_lost'
);

create type public.deal_type as enum (
  'sale',
  'rental'
);

create type public.payment_purpose as enum (
  'listing_fee',
  'commission'
);

create type public.payment_status as enum (
  'pending',
  'success',
  'failed',
  'abandoned'
);


-- ---------------------------------------------------------------------------
-- 2. profiles
--
-- Supabase already stores login credentials in its own `auth.users` table,
-- which we don't own and shouldn't modify. `profiles` is our companion table
-- holding the application-level facts about a person: their role, name, phone,
-- and whether they've passed phone verification.
--
-- The primary key IS the auth user id, so there is exactly one profile per
-- login account, permanently linked. `on delete cascade` means deleting the
-- auth account cleans up the profile automatically.
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  role        public.user_role not null default 'renter_buyer',
  full_name   text not null default '',
  phone       text,

  -- TRUST GATE: set true only after successful phone OTP confirmation.
  -- app-flow.docx §1 requires this before any listing can be created, and the
  -- RLS policies in the next migration enforce it at the database level.
  verified    boolean not null default false,
  verified_at timestamptz,

  banned      boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_phone_format check (
    phone is null or phone ~ '^\+?[0-9]{10,15}$'
  )
);

comment on table public.profiles is
  'Application profile for each auth.users account. One row per login.';


-- ---------------------------------------------------------------------------
-- 3. agents
--
-- An agent is a profile with extra public-facing trust data. Kept in its own
-- table (rather than more columns on profiles) because this data is PUBLIC —
-- anyone browsing a listing can see the agent's rating and coverage area —
-- while profiles holds private data like phone numbers. Separate tables let us
-- write a simple "public can read agents, public cannot read profiles" rule.
-- ---------------------------------------------------------------------------

create table public.agents (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null unique
                       references public.profiles (user_id) on delete cascade,
  coverage_area      text not null default 'Abuja',
  active             boolean not null default false,  -- admin activates after vetting
  rating             numeric(2,1) check (rating is null or rating between 0 and 5),

  -- Cached counters behind the public "completion rate" figure in the UI spec.
  -- Maintained when bookings change (Phase 4) so listing pages don't have to
  -- run a COUNT over the whole bookings table on every page view.
  viewings_assigned  integer not null default 0 check (viewings_assigned >= 0),
  viewings_completed integer not null default 0 check (viewings_completed >= 0),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint agents_completed_lte_assigned
    check (viewings_completed <= viewings_assigned)
);

comment on table public.agents is
  'Public trust profile for vetted agents: coverage, rating, completion rate.';


-- ---------------------------------------------------------------------------
-- 4. listings
-- ---------------------------------------------------------------------------

create table public.listings (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.profiles (user_id) on delete cascade,

  title            text not null check (length(trim(title)) between 8 and 120),
  type             public.listing_type not null,
  property_type    public.property_type not null,

  price_kobo       bigint not null check (price_kobo > 0),

  location_text    text not null check (length(trim(location_text)) > 0),
  lat              double precision check (lat between -90 and 90),
  lng              double precision check (lng between -180 and 180),

  bedrooms         smallint check (bedrooms >= 0),
  bathrooms        smallint check (bathrooms >= 0),
  description      text not null default '',

  -- Cloudinary URLs. app-flow.docx §1 step 2 requires a minimum of 3 photos,
  -- but only once the listing is actually submitted — a half-finished draft is
  -- allowed to have none. That conditional rule is enforced further down.
  images           text[] not null default '{}',

  status           public.listing_status not null default 'draft',
  rejection_reason text,

  listing_fee_paid boolean not null default false,
  fee_waived       boolean not null default false,  -- first-50 cold-start subsidy

  -- Signed at listing creation (app-flow.docx §1 step 5). Commission is owed if
  -- a deal closes with a platform-introduced party, so we record WHEN the owner
  -- agreed and to WHICH version of the wording — if the clause text is ever
  -- revised, existing listings stay bound to the text they actually saw.
  commission_clause_agreed_at      timestamptz,
  commission_clause_version        text,

  -- BOOKING LOCK (fraud prevention, CLAUDE.md "Trust & fraud prevention").
  -- Set when a viewing is scheduled so other interested parties see the listing
  -- is spoken for. This is the defence against the documented Nigerian
  -- double-rental scam. Phase 4 sets these inside an atomic transaction.
  -- The foreign key to bookings is added by ALTER TABLE below, because the
  -- bookings table does not exist yet at this point in the file.
  booking_locked_at    timestamptz,
  booking_locked_by    uuid,

  published_at     timestamptz,
  closed_at        timestamptz,
  view_count       integer not null default 0 check (view_count >= 0),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- A listing may only leave draft once it is actually complete. Enforced here
  -- rather than only in the form, because "never trust the client" applies to
  -- our own future code too — a bug in an API route can't bypass this.
  -- coalesce is essential here. array_length('{}', 1) returns NULL, not 0, and
  -- a CHECK constraint only rejects FALSE — NULL passes. Without the coalesce
  -- a listing with NO photos would be allowed out of draft, while one with 1 or
  -- 2 photos was correctly blocked.
  constraint listings_submittable_requires_photos check (
    status = 'draft' or coalesce(array_length(images, 1), 0) >= 3
  ),
  constraint listings_submittable_requires_pin check (
    status = 'draft' or (lat is not null and lng is not null)
  ),
  constraint listings_submittable_requires_clause check (
    status = 'draft' or commission_clause_agreed_at is not null
  ),
  constraint listings_rejected_requires_reason check (
    status <> 'rejected' or length(trim(coalesce(rejection_reason, ''))) > 0
  ),
  constraint listings_live_requires_settled_fee check (
    status <> 'live' or listing_fee_paid or fee_waived
  )
);

comment on table public.listings is
  'Property listings. Nothing is publicly visible until status = live, which '
  'only an admin can set (see RLS migration).';


-- ---------------------------------------------------------------------------
-- 5. bookings
--
-- app-flow.docx §2 has the renter proposing 2–3 preferred slots, and §3 has the
-- agent picking one. So we store the proposed slots as an array and record the
-- single agreed time separately in scheduled_at once confirmed.
-- ---------------------------------------------------------------------------

create table public.bookings (
  id             uuid primary key default gen_random_uuid(),
  listing_id     uuid not null references public.listings (id) on delete cascade,
  requester_id   uuid not null references public.profiles (user_id) on delete cascade,
  agent_id       uuid references public.agents (id) on delete set null,

  -- Same NULL trap as listings.images: an empty array yields NULL from
  -- array_length, which a CHECK treats as passing. Without the coalesce a
  -- viewing could be requested proposing no times at all.
  proposed_slots timestamptz[] not null
                   check (coalesce(array_length(proposed_slots, 1), 0) between 1 and 3),
  scheduled_at   timestamptz,

  status         public.booking_status not null default 'requested',

  notes          text,
  outcome_note   text,   -- agent's post-viewing note: interested / no-show / not interested
  cancel_reason  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A confirmed or completed viewing must have an actual time and an actual
  -- agent. Without this, a booking could be "confirmed" with nobody assigned.
  constraint bookings_confirmed_requires_time check (
    status in ('requested', 'cancelled') or scheduled_at is not null
  ),
  constraint bookings_confirmed_requires_agent check (
    status in ('requested', 'cancelled') or agent_id is not null
  )
);

comment on table public.bookings is
  'Viewing requests. Renter proposes up to 3 slots; agent confirms one.';

-- listings.booking_locked_by points at bookings, and bookings points back at
-- listings. One of the two references has to be added after both tables exist,
-- which is what this does.
alter table public.listings
  add constraint listings_booking_locked_by_fkey
  foreign key (booking_locked_by) references public.bookings (id) on delete set null;


-- ---------------------------------------------------------------------------
-- 6. deals
-- ---------------------------------------------------------------------------

create table public.deals (
  id                 uuid primary key default gen_random_uuid(),
  listing_id         uuid not null references public.listings (id) on delete cascade,
  booking_id         uuid references public.bookings (id) on delete set null,
  buyer_renter_id    uuid not null references public.profiles (user_id) on delete cascade,
  agent_id           uuid references public.agents (id) on delete set null,

  deal_type          public.deal_type not null,

  agreed_price_kobo  bigint check (agreed_price_kobo > 0),
  commission_pct     numeric(5,2) check (commission_pct between 0 and 100),
  commission_kobo    bigint check (commission_kobo >= 0),

  status             public.deal_status not null default 'negotiating',
  closed_lost_reason text,
  closed_at          timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Once a price is agreed, the commission numbers must exist — a deal cannot
  -- drift into "closed won" with a blank commission figure.
  constraint deals_agreed_requires_numbers check (
    status = 'negotiating' or status = 'closed_lost'
    or (agreed_price_kobo is not null
        and commission_pct is not null
        and commission_kobo is not null)
  ),
  constraint deals_lost_requires_reason check (
    status <> 'closed_lost' or length(trim(coalesce(closed_lost_reason, ''))) > 0
  ),
  constraint deals_closed_requires_timestamp check (
    status not in ('closed_won', 'closed_lost') or closed_at is not null
  )
);

comment on table public.deals is
  'Deal pipeline. Invoice model: the platform never holds sale proceeds, it '
  'only invoices its commission slice after close.';


-- ---------------------------------------------------------------------------
-- 7. payments
-- ---------------------------------------------------------------------------

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (user_id) on delete cascade,

  purpose      public.payment_purpose not null,
  listing_id   uuid references public.listings (id) on delete set null,
  deal_id      uuid references public.deals (id) on delete set null,

  amount_kobo  bigint not null check (amount_kobo > 0),
  currency     text not null default 'NGN',

  -- IDEMPOTENCY KEY. Paystack can deliver the same webhook more than once
  -- (network retries, their own redelivery). `unique` means a duplicate insert
  -- is rejected by the database itself, so a repeated webhook can never mark a
  -- listing fee paid twice or double-count revenue. This is the enforcement
  -- behind "handle webhooks idempotently" in CLAUDE.md — a code-level check
  -- alone loses to two requests arriving at the same instant.
  paystack_ref text not null unique,

  status       public.payment_status not null default 'pending',
  paid_at      timestamptz,

  -- Full webhook body, kept for dispute resolution and debugging.
  raw_payload  jsonb,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint payments_purpose_has_target check (
    (purpose = 'listing_fee' and listing_id is not null)
    or (purpose = 'commission' and deal_id is not null)
  ),
  constraint payments_success_requires_paid_at check (
    status <> 'success' or paid_at is not null
  )
);

comment on table public.payments is
  'Paystack payment records. paystack_ref is unique and acts as the webhook '
  'idempotency key.';


-- ---------------------------------------------------------------------------
-- 8. Indexes
--
-- An index is a lookup structure the database keeps alongside a table, like the
-- index at the back of a book. Without one, finding "all live listings" means
-- reading every row. With one, Postgres jumps straight to the matches. We add
-- them for the columns we know we will filter and join on constantly.
-- ---------------------------------------------------------------------------

create index listings_status_idx        on public.listings (status);
create index listings_owner_idx         on public.listings (owner_id);
create index listings_type_idx          on public.listings (type);
-- Partial index: only live listings, because that is the only status public
-- search ever queries. A smaller index is a faster index.
create index listings_live_geo_idx      on public.listings (lat, lng)
  where status = 'live';
create index listings_live_price_idx    on public.listings (price_kobo)
  where status = 'live';

create index bookings_listing_idx       on public.bookings (listing_id);
create index bookings_requester_idx     on public.bookings (requester_id);
create index bookings_agent_idx         on public.bookings (agent_id);
create index bookings_scheduled_idx     on public.bookings (scheduled_at)
  where status in ('requested', 'confirmed');

create index deals_listing_idx          on public.deals (listing_id);
create index deals_agent_idx            on public.deals (agent_id);
create index deals_status_idx           on public.deals (status);

create index payments_user_idx          on public.payments (user_id);
create index payments_status_idx        on public.payments (status);

create index agents_active_idx          on public.agents (active) where active;


-- ---------------------------------------------------------------------------
-- 9. updated_at trigger
--
-- A trigger is a function the database runs automatically when something
-- happens to a row. This one stamps updated_at on every UPDATE, so the value is
-- always correct even if some future bit of code forgets to set it.
--
-- `security definer set search_path = ''` is a hardening convention: it stops
-- the function resolving names via whatever schema search path the caller
-- happens to have, which is a known privilege-escalation route in Postgres.
-- That's also why every name below is fully qualified.
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger agents_set_updated_at   before update on public.agents
  for each row execute function public.set_updated_at();
create trigger listings_set_updated_at before update on public.listings
  for each row execute function public.set_updated_at();
create trigger bookings_set_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();
create trigger deals_set_updated_at    before update on public.deals
  for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 10. Auto-create a profile when someone signs up
--
-- Supabase writes to auth.users when a user registers. This trigger fires on
-- that insert and creates the matching profiles row in the same transaction, so
-- a login account without a profile is impossible.
--
-- The role and name come from the sign-up metadata the app sends. Note that
-- metadata is CLIENT-SUPPLIED, so 'admin' is explicitly filtered out — otherwise
-- anyone could sign up as an administrator just by editing the request.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role public.user_role;
begin
  begin
    requested_role := (new.raw_user_meta_data ->> 'role')::public.user_role;
  exception when others then
    requested_role := 'renter_buyer';
  end;

  -- Never honour a client-supplied 'admin'. Admins are promoted manually.
  if requested_role is null or requested_role = 'admin' then
    requested_role := 'renter_buyer';
  end if;

  insert into public.profiles (user_id, role, full_name, phone)
  values (
    new.id,
    requested_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 11. Privilege-escalation guard on profiles
--
-- The RLS policies in the next migration let a user update their own profile
-- row — they need to, to fix their name or phone. But `verified`, `role` and
-- `banned` are TRUST fields. If a user could set verified = true on themselves
-- they would walk straight past the phone-OTP gate that protects listing
-- creation; if they could set role = 'admin' they would own the platform.
--
-- RLS can restrict which ROWS you may touch but not which COLUMNS, so this
-- trigger does the column-level part: any change to a protected field is
-- rejected unless it came from an admin or from server-side code using the
-- service role key.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
begin
  -- Trusted server-side code (the auth callback, Paystack webhooks, admin
  -- scripts) is identified by the ABSENCE of a logged-in user, rather than by
  -- auth.role() = 'service_role'. Two reasons:
  --   * auth.role() is deprecated in Supabase and its result depends on the
  --     key format in use (legacy anon/service JWTs vs the newer sb_secret_*
  --     keys). If it ever returned something unexpected, this trigger would
  --     block the auth callback from setting verified = true — meaning nobody
  --     could ever verify, and no listing could ever be created.
  --   * auth.uid() is the same function the RLS policies already depend on, so
  --     there is one less mechanism that has to keep working.
  --
  -- This cannot be abused by an anonymous caller. Reaching this trigger at all
  -- requires an UPDATE on profiles to match a row, and every UPDATE policy on
  -- the table resolves through auth.uid() — with no user, no row matches and
  -- the update affects nothing.
  if auth.uid() is null then
    return new;
  end if;

  select p.role into actor_role
  from public.profiles p
  where p.user_id = auth.uid();

  if actor_role = 'admin' then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'You cannot change your own role.';
  end if;
  if new.verified is distinct from old.verified
     or new.verified_at is distinct from old.verified_at then
    raise exception 'Verification status is set by the system, not by the user.';
  end if;
  if new.banned is distinct from old.banned then
    raise exception 'You cannot change your own account status.';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_privileged_fields
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_fields();


-- Same idea for agents: an agent may edit their own coverage area, but rating,
-- active status and the completion counters are platform-controlled. If agents
-- could set their own rating, the public trust signals become worthless.
create or replace function public.guard_agent_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
begin
  -- Same reasoning as the profiles guard above: no logged-in user means
  -- trusted server-side code.
  if auth.uid() is null then
    return new;
  end if;

  select p.role into actor_role
  from public.profiles p
  where p.user_id = auth.uid();

  if actor_role = 'admin' then
    return new;
  end if;

  if new.active is distinct from old.active
     or new.rating is distinct from old.rating
     or new.viewings_assigned is distinct from old.viewings_assigned
     or new.viewings_completed is distinct from old.viewings_completed
     or new.profile_id is distinct from old.profile_id then
    raise exception 'Agent rating, status and viewing counts are set by the platform.';
  end if;

  return new;
end;
$$;

create trigger agents_guard_privileged_fields
  before update on public.agents
  for each row execute function public.guard_agent_privileged_fields();
