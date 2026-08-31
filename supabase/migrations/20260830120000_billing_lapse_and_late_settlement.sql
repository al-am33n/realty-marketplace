-- ============================================================================
-- Two money bugs in the recurring listing fee
-- Phase 2 (feature/listings-core)
--
-- Both were found by reading 20260816120000 back against the manual-payment
-- path that was built afterwards. Neither is visible in the schema catalog and
-- neither would fail a test that only ever charges once, which is exactly the
-- shape of the three bugs Phase 1 caught the same way.
--
-- ---------------------------------------------------------------------------
-- BUG 1 — MONEY THAT ARRIVES LATE IS TAKEN AND NEVER CREDITED
--
-- begin_listing_fee_charge reserves a period by inserting a `pending` payment
-- row, and reaps a reservation still pending after 30 minutes so one stuck
-- attempt cannot block a listing's billing forever. That reaper is right for
-- the unattended run, where 30 minutes is far longer than any API call.
--
-- It is wrong for a landlord paying by hand. A Paystack checkout page stays
-- valid far longer than half an hour. So:
--
--   1. Landlord presses "settle this month's fee". Period reserved, attempt a1.
--   2. They get distracted and leave the tab open.
--   3. 31 minutes later the reservation is reaped as abandoned.
--   4. They come back and complete the payment. Money moves.
--   5. The webhook settles reference a1 — and the old function refused to act
--      on anything that was not still `pending`, answering "already_settled".
--
-- The landlord is charged and the listing is not extended. Worse, the period is
-- now claimable again, so the daily run charges the same month a second time.
-- The one failure this whole design exists to prevent, reached through the door
-- that was added last.
--
-- The fix is to let a genuine success settle a reservation that was abandoned
-- or failed — while refusing, loudly, to extend a period that some other
-- payment already bought. Two people cannot pay for the same month and both get
-- it: the second one is money owed back, and saying so in the return value is
-- how anyone finds out.
--
-- ---------------------------------------------------------------------------
-- BUG 2 — A LAPSED LISTING IS BILLED FOR TIME IT SPENT HIDDEN
--
-- A period always ran from the end of the previous one. Follow that through a
-- listing that lapses: paid through 1 September, hidden from search on the 8th,
-- and the owner returns in November to put it right. The period on offer is the
-- one ending 1 October — already in the past. They pay ₦5,000, are overdue the
-- moment the payment lands, and have to pay twice more to catch up on two
-- months during which nobody could see the property.
--
-- That is charging for shelf space the platform withdrew. The same reasoning
-- the original migration used for starting the clock at approval rather than at
-- payment applies here in the other direction: bill for what was delivered.
--
-- So a listing that has lapsed past the grace period starts a fresh month from
-- today. A listing still inside its grace period does not — it was visible the
-- whole time, and the days it is late are days it was still being shown.
--
-- The restart date is truncated to the day rather than taken from now()
-- directly. period_end is half of the unique key that makes double-charging
-- impossible, and a value carrying the current millisecond would give two
-- concurrent claims two different keys — quietly turning the guarantee off in
-- precisely the situation it exists for.
--
-- ---------------------------------------------------------------------------
-- BUG 3 — A DECLINED CARD IS RETRIED EVERY DAY, FOREVER
--
-- listings_due_for_fee asked only whether a listing was past its paid-up date.
-- A card that has been cancelled outright is past that date today, tomorrow and
-- next year, so the run would present it to Paystack once a day indefinitely
-- against a listing nobody can even see any more.
--
-- Repeated failed authorisations against the same card is a pattern acquirers
-- treat as suspicious, and a suspended merchant account would take down the
-- platform's only way to collect anything from anyone. So attempts stop when
-- the grace period ends — the same moment the listing stops being visible, and
-- therefore the same moment the platform stops delivering anything to bill for.
-- At most seven attempts, then it waits for the owner.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- The work list: only bill a listing that is still being shown.
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
    -- Inside the grace period only. Identical to the visibility clause in the
    -- "listings: public reads live" policy, deliberately: the platform bills
    -- for exactly the window in which it is still showing the property.
    and l.fee_paid_through > now() - public.listing_fee_grace()
  order by l.fee_paid_through
  limit p_limit;
$$;

revoke execute on function public.listings_due_for_fee(integer) from public;
grant execute on function public.listings_due_for_fee(integer) to service_role;


-- ---------------------------------------------------------------------------
-- Claiming a period, with the lapse rule.
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
  v_owner_id     uuid;
  v_status       public.listing_status;
  v_mode         public.listing_mode;
  v_cancelled    timestamptz;
  v_paid_through timestamptz;
  v_period_start timestamptz;
  v_period_end   timestamptz;
  v_attempt      integer;
  v_reference    text;
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

  -- Normally the next period picks up where the last one ended. But once a
  -- listing has been hidden, the months in between bought nothing, so the clock
  -- restarts today rather than billing backwards through the dark. See BUG 2.
  v_period_start := v_paid_through;
  if v_period_start < date_trunc('day', now()) - public.listing_fee_grace() then
    v_period_start := date_trunc('day', now());
  end if;

  v_period_end := v_period_start + public.listing_fee_period();

  -- Reap attempts that were started and never settled — a process killed
  -- mid-charge, a deploy at the wrong moment. Without this, one stuck row would
  -- block that listing's billing permanently, which is a worse failure than the
  -- one it protects against. 30 minutes is far longer than any Paystack call.
  --
  -- Note this no longer loses the money if the abandoned attempt later turns
  -- out to have succeeded: settle_listing_fee_charge accepts a late success on
  -- an abandoned row. See BUG 1.
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
-- Settling, including money that arrives after the reservation was reaped.
--
-- The rules, in order:
--   unknown reference            -> nothing to settle
--   already successful           -> a duplicate webhook; change nothing
--   failure reported on a row
--     that is not pending        -> nothing left to record
--   failure on a pending row     -> mark it failed, release the period
--   success on pending/failed/
--     abandoned                  -> credit it, unless another payment already
--                                   bought that period, in which case say so
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
  v_rival      integer;
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

  -- Already credited. A duplicate webhook, or the webhook arriving just behind
  -- the billing run that settled the same charge. Never move the paid-up date
  -- a second time.
  if v_status = 'success' then
    return query select false, 'already_settled'::text;
    return;
  end if;

  if not p_succeeded then
    if v_status <> 'pending' then
      -- Already failed or abandoned. Nothing further to write down.
      return query select false, 'already_settled'::text;
      return;
    end if;

    update public.payments
       set status = 'failed', raw_payload = coalesce(p_payload, raw_payload)
     where id = v_payment_id;
    return query select true, 'failed'::text;
    return;
  end if;

  -- A success. The row may be pending (the ordinary case) or abandoned/failed
  -- (money that arrived after we stopped waiting for it — BUG 1).
  --
  -- Before crediting it, check nobody else already bought this period. If
  -- somebody did, this is a genuine overpayment: a human owes a refund, and the
  -- only useful thing the database can do is refuse to double-extend and say
  -- clearly what happened.
  select count(*)::integer
    into v_rival
    from public.payments p
   where p.purpose = 'listing_fee'
     and p.listing_id = v_listing_id
     and p.period_end = v_period_end
     and p.status = 'success'
     and p.id <> v_payment_id;

  if v_rival > 0 then
    update public.payments
       set raw_payload = coalesce(p_payload, raw_payload)
     where id = v_payment_id;
    return query select false, 'period_already_paid'::text;
    return;
  end if;

  -- The partial unique index covers (listing_id, period_end) for pending and
  -- successful rows, so moving an abandoned row INTO 'success' can still
  -- collide with a claim made in the meantime. Catching it here is what keeps
  -- the guarantee absolute rather than merely likely: the count above is a
  -- check-then-act, and the index is the thing that actually decides.
  begin
    update public.payments
       set status = 'success', paid_at = now(), raw_payload = coalesce(p_payload, raw_payload)
     where id = v_payment_id;
  exception
    when unique_violation then
      return query select false, 'period_already_paid'::text;
      return;
  end;

  perform set_config('realty.privileged_listing_write', 'on', true);

  -- greatest(), so a late settlement can never pull a listing's paid-up date
  -- BACKWARDS. If the owner sorted it out by paying a newer period in the
  -- meantime, this one is history and must not undo that.
  update public.listings
     set fee_paid_through = greatest(coalesce(fee_paid_through, v_period_end), v_period_end),
         listing_fee_paid = true
   where id = v_listing_id;

  perform set_config('realty.privileged_listing_write', 'off', true);

  return query select true, 'succeeded'::text;
end;
$$;

revoke execute on function public.settle_listing_fee_charge(text, boolean, jsonb) from public;
grant execute on function public.settle_listing_fee_charge(text, boolean, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- BUG 4 — A LISTING INSERTED STRAIGHT INTO 'live' IS NEVER BILLED
--
-- start_listing_billing_period is a BEFORE UPDATE trigger, so it only fires on
-- the transition an admin makes when approving. Nothing today inserts a listing
-- that is already live, so the hole is theoretical — but Phase 7 seeds "5-10
-- real listings" before opening the waiver cohort, and a seed script inserting
-- rows directly is the obvious way to do that.
--
-- Such a listing would have fee_paid_through NULL, which listings_due_for_fee
-- skips and the visibility policy deliberately lets through. It would sit live
-- and free forever, and nothing would ever look wrong.
--
-- A separate function rather than reusing start_listing_billing_period, which
-- reads `old.status`. On an INSERT there is no old row, and whether PL/pgSQL
-- reads that as NULL or raises "record old is not assigned yet" is a detail not
-- worth betting a trigger on — especially one whose failure mode is that no
-- listing can be created at all.
-- ---------------------------------------------------------------------------
create or replace function public.start_listing_billing_period_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'live'
     and new.listing_mode is distinct from 'platform_direct'
     and new.fee_paid_through is null
  then
    new.fee_paid_through := now() + public.listing_fee_period();
  end if;

  return new;
end;
$$;

create trigger listings_start_billing_period_on_insert
  before insert on public.listings
  for each row execute function public.start_listing_billing_period_on_insert();

-- Catch anything already in that state. Same reasoning as the backfill in
-- 20260816120000: a full month from today, not a backdated obligation.
update public.listings
   set fee_paid_through = now() + public.listing_fee_period()
 where status = 'live'
   and listing_mode is distinct from 'platform_direct'
   and fee_paid_through is null;
