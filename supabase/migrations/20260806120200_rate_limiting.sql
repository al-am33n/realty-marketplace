-- ============================================================================
-- Rate limiting for auth endpoints
-- Phase 1 (feature/foundation)
--
-- CLAUDE.md: "Rate-limit login and OTP-request endpoints."
--
-- WHY IT LIVES IN THE DATABASE
-- The obvious way to count attempts is a counter in the application's memory.
-- That does not work here. On Vercel the app runs as serverless functions:
-- consecutive requests may be handled by different instances, each with its own
-- empty counter, and instances are discarded when idle. An attacker would
-- simply never hit the limit.
--
-- Postgres is the one place every instance genuinely shares, so the counter
-- goes here. It also costs nothing extra on the free tier.
-- ============================================================================

create table public.auth_throttle (
  -- Identifies what is being limited, e.g. 'login:someone@example.com'
  -- or 'otp:+2348031234567'.
  key          text primary key,
  attempts     integer not null default 0,
  window_start timestamptz not null default now()
);

comment on table public.auth_throttle is
  'Counters for auth rate limiting. Written only via check_rate_limit().';

-- Locked down completely. RLS is on with NO policies at all, which means deny
-- everything: users must never read or edit their own attempt counters.
-- Access is exclusively through the SECURITY DEFINER function below.
alter table public.auth_throttle enable row level security;
revoke all on public.auth_throttle from anon, authenticated;

create index auth_throttle_window_idx on public.auth_throttle (window_start);

-- ---------------------------------------------------------------------------
-- check_rate_limit(key, max_attempts, window) -> allowed?
--
-- Records one attempt and reports whether the caller is still under the limit.
--
-- The counting is a single INSERT ... ON CONFLICT statement on purpose. Reading
-- the count and then writing it back would be two separate steps, and two
-- simultaneous login attempts could both read "4 attempts", both decide they
-- were under the limit of 5, and both proceed. One atomic statement cannot be
-- interleaved that way — the same reasoning CLAUDE.md applies to booking and
-- payment operations.
-- ---------------------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_key           text,
  p_max_attempts  integer,
  p_window        interval
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  insert into public.auth_throttle as t (key, attempts, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set
      -- If the previous window has expired, this attempt starts a new one.
      attempts = case
        when t.window_start < now() - p_window then 1
        else t.attempts + 1
      end,
      window_start = case
        when t.window_start < now() - p_window then now()
        else t.window_start
      end
  returning t.attempts into v_attempts;

  return v_attempts <= p_max_attempts;
end;
$$;

-- ---------------------------------------------------------------------------
-- Housekeeping. Rows for people who logged in once and never came back would
-- otherwise sit here forever. Call occasionally from an admin task; there is no
-- scheduler on the free tier, and the table is tiny, so this is not urgent.
-- ---------------------------------------------------------------------------
create or replace function public.prune_auth_throttle()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.auth_throttle
  where window_start < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Callable only by trusted server-side code. A user who could call
-- check_rate_limit() directly could burn through their own allowance to lock
-- themselves out, or spam the table — and one who could call
-- prune_auth_throttle() could erase the evidence of a brute-force attempt.
revoke execute on function public.check_rate_limit(text, integer, interval) from public;
revoke execute on function public.prune_auth_throttle() from public;
grant execute on function public.check_rate_limit(text, integer, interval) to service_role;
grant execute on function public.prune_auth_throttle() to service_role;
