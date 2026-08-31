-- ============================================================================
-- begin_listing_fee_charge could not claim a period at all
-- Phase 2 (feature/listings-core)
--
-- Found by `npm run verify` immediately after 20260830120000 was applied, which
-- is the entire reason that rule exists. The function is unchanged in intent —
-- what follows is the same body with two column references qualified.
--
-- ---------------------------------------------------------------------------
-- WHAT WENT WRONG
--
-- The function is declared:
--
--   returns table (claimed boolean, reference text, period_end timestamptz, ...)
--
-- In PL/pgSQL a RETURNS TABLE column is also an output VARIABLE in scope for
-- the whole body. Two statements then referred to `period_end` without saying
-- which one they meant:
--
--   update public.payments set status = 'abandoned'
--    where ... and period_end = v_period_end        -- variable, or column?
--
-- Postgres refuses to guess: 42702, `column reference "period_end" is
-- ambiguous`. Not a wrong answer — no answer. The function raised on every call
-- that reached those lines.
--
-- ---------------------------------------------------------------------------
-- WHY IT SURVIVED REVIEW AND THE SCHEMA CATALOG
--
-- The error is raised when a statement RUNS, not when the function is created,
-- so `create or replace` accepted it happily and the catalog showed a function
-- present and correctly granted.
--
-- And every guard clause — not_found, no_fee_for_mode, not_live,
-- renewal_cancelled, not_due — returns before those two statements. So the
-- whole refusal half of the function worked perfectly, and only a call that got
-- as far as actually claiming a period ever touched the broken lines. The
-- billing e2e section passed eight checks in a row and failed on the ninth: the
-- first one that claims.
--
-- The same shape as the three bugs Phase 1 caught this way. A test that only
-- exercises the paths where a function says no will not notice that it can
-- never say yes.
--
-- ---------------------------------------------------------------------------
-- THE FIX
--
-- Alias the table (`public.payments p`) and qualify the column (`p.period_end`)
-- in both statements. Qualifying rather than renaming the output column keeps
-- the function's return shape identical, so no caller changes: src/lib/billing.ts
-- and src/app/actions/billing.ts both read `period_end` off the result.
--
-- The SET target stays unqualified because SQL does not allow a qualified
-- column there — and it is not ambiguous anyway, since `status` is not one of
-- this function's output variables.
-- ============================================================================


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
  update public.payments p
     set status = 'abandoned'
   where p.purpose = 'listing_fee'
     and p.listing_id = p_listing_id
     and p.period_end = v_period_end
     and p.status = 'pending'
     and p.created_at < now() - interval '30 minutes';

  select count(*)::integer + 1
    into v_attempt
    from public.payments p
   where p.purpose = 'listing_fee'
     and p.listing_id = p_listing_id
     and p.period_end = v_period_end;

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
