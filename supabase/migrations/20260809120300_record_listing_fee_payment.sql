-- ============================================================================
-- Idempotent recording of a listing fee payment
-- Phase 2 (feature/listings-core)
--
-- CLAUDE.md: "Paystack webhooks handled idempotently (check if a payment
-- reference was already processed before acting on it)."
--
-- WHY A DATABASE FUNCTION RATHER THAN APPLICATION CODE
--
-- Paystack delivers the same webhook more than once. That is normal and
-- expected: they retry on timeout, on a non-2xx response, and sometimes simply
-- because a delivery was not acknowledged in time. A handler that reads
-- "has this reference been processed?" and then writes is two steps, and two
-- simultaneous deliveries of the SAME event can both read "no" before either
-- writes — producing two payment rows for one payment.
--
-- Doing it in one statement makes that impossible. `on conflict (paystack_ref)
-- do nothing` either inserts or does not, decided by the database's unique
-- index, with no window in between. If nothing was inserted, this delivery is a
-- duplicate and the function stops without touching the listing.
--
-- The unique constraint on payments.paystack_ref (Phase 1) is what this relies
-- on — that column was designed as the idempotency key from the start.
-- ============================================================================

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

  -- Nothing inserted means this reference was already recorded: a duplicate
  -- delivery. Report it and change nothing else.
  if v_payment_id is null then
    select id into v_payment_id from public.payments where paystack_ref = p_paystack_ref;
    return query select false, v_payment_id;
    return;
  end if;

  -- listing_fee_paid is protected by guard_listing_privileged_fields, so this
  -- write announces itself the same way the fee waiver does. Transaction-local,
  -- so it cannot authorise anything beyond this statement.
  perform set_config('realty.privileged_listing_write', 'on', true);

  update public.listings
     set listing_fee_paid = true
   where id = p_listing_id;

  perform set_config('realty.privileged_listing_write', 'off', true);

  return query select true, v_payment_id;
end;
$$;

-- Webhook handlers only. A user must never be able to mark their own fee paid —
-- that is the entire point of routing this through Paystack.
revoke execute on function public.record_listing_fee_payment(text, uuid, uuid, bigint, jsonb) from public;
grant execute on function public.record_listing_fee_payment(text, uuid, uuid, bigint, jsonb) to service_role;
