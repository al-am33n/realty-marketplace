-- ============================================================================
-- Grants for the service role
-- Phase 1 (feature/foundation)
--
-- WHY THIS MIGRATION EXISTS
--
-- `service_role` has the BYPASSRLS attribute, so Row Level Security policies do
-- not apply to it. That is often described as "the service role can do
-- anything", which is not quite true and the difference bit us:
--
--   BYPASSRLS skips the POLICY check. It does not skip the GRANT check.
--
-- Postgres still requires the ordinary SQL privilege on the table. Supabase
-- normally grants that automatically to anon, authenticated AND service_role
-- for every new table in `public` — but this project has "expose new tables
-- automatically" turned off, so none of the three got anything. The RLS
-- migration wrote explicit grants for anon and authenticated and overlooked
-- service_role, which left every admin-client query failing with HTTP 403.
--
-- That silently broke the core of Phase 1: /auth/callback marks
-- profiles.verified using the admin client, because the
-- profiles_guard_privileged_fields trigger deliberately stops users verifying
-- themselves. With no grant, that update failed, no account could ever become
-- verified, and therefore no listing could ever be created. The Paystack
-- webhook in Phase 2 would have failed identically.
--
-- Caught by a functional test against the live API rather than by the schema
-- catalog, which looked perfectly correct.
-- ============================================================================

grant usage on schema public to service_role;

-- Full access is appropriate here, unlike for anon/authenticated. This role is
-- only ever used by trusted server-side code — the auth callback, payment
-- webhooks, agent assignment, admin moderation — all of which legitimately need
-- to read and write across users. The protection against misuse is that the key
-- never leaves the server (enforced by `import "server-only"` in
-- src/lib/supabase/admin.ts), not a narrow grant here.
grant all privileges on public.profiles      to service_role;
grant all privileges on public.agents        to service_role;
grant all privileges on public.listings      to service_role;
grant all privileges on public.bookings      to service_role;
grant all privileges on public.deals         to service_role;
grant all privileges on public.payments      to service_role;
grant all privileges on public.auth_throttle to service_role;

-- So a table added in a later phase does not repeat this bug. Note the contrast
-- with the RLS migration, which REVOKES default privileges from anon and
-- authenticated: new tables should stay invisible to the browser until somebody
-- deliberately exposes them, but should always be reachable by trusted
-- server-side code.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
