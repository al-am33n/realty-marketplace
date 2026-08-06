# Realty Marketplace — Project Brief

Read this in full before doing any work. This is the accumulated plan from prior planning sessions — treat every decision below as settled unless the user says otherwise.

## What we're building
A two-sided real estate marketplace for Nigeria (PadMapper-style: map + list browsing). Landlords/agents list properties for sale or standard rental; renters/buyers search and request agent-assisted viewings; the platform provides a vetted agent for every viewing and earns a commission on closed deals. Short-let (nightly/weekly stays) is explicitly Phase 2, held back from v1.

## Stack (fully free tier — hard constraint)
- Frontend: Next.js (App Router)
- Backend/DB/Auth: Supabase (Postgres, RLS, built-in auth)
- Payments: Paystack (listing fees + commission invoicing; Split Payments/Subaccounts reserved for future short-let phase)
- Maps: Leaflet + OpenStreetMap (not Mapbox — chosen specifically for uncapped free usage)
- Images: Cloudinary free tier (compress before upload, cap photos per listing)
- Notifications: **Resend (email) is the primary outbound notification channel** — booking confirmations, order updates, listing status. WhatsApp Business Cloud API is NOT free for this use case (it's only free for replies to inbound customer messages, not business-initiated notifications, and requires a paid BSP subscription of $49–200/month to access at all) — deferred as an optional add-on once revenue justifies the BSP cost, not part of the free-tier v1 build.
- Email: Resend free tier (3,000/mo)
- PWA: next-pwa plugin for manifest + service worker (manifest/basic service worker in Phase 1, offline-caching polish in Phase 7). Native app (React Native/Expo, EAS Build for cloud iOS builds without a Mac) is a deferred, separately-funded track — not part of the 7-phase sequence — because Apple charges $99/year and Google $25 one-time, the one cost free tooling can't eliminate.
- Hosting: Vercel (flag: free Hobby tier is licensed non-commercial; upgrade to Pro from first commission revenue once real payments flow)
- Error monitoring: Sentry free Developer tier (5,000 errors/month)
- Domain: deferred — launch on free Vercel subdomain, buy real domain once ready to market publicly

## Launch scope (v1)
Sale + standard rental only. Abuja only. Short-let is Phase 2.

## Revenue model
- **Listing fee**: waived for the first 50 listings (cold-start subsidy), then a flat fee thereafter.
- **Sale commission**: 5–10% of sale price, invoice model — platform never holds sale proceeds, only invoices its commission slice via Paystack after close.
- **Rental commission**: positioned as a share of the customary ~10% agency fee Nigerian tenants already pay, split between platform and the agent who did the viewing. Invoice model, same as sale.
- **No booking deposit.** Commission is protected by (1) a signed procuring-cause commission clause at listing creation — commission owed if a deal closes with a platform-introduced party, regardless of whether paperwork ran through the platform, (2) the agent's own financial stake in the deal, (3) access consequences — dodging costs future listing/agent access.
- **Short-let (Phase 2 only)**: 15% commission, host-only, no guest fee. Paystack Split Payments/Subaccounts so the platform never custodies guest/host funds.

## Trust & fraud prevention (non-negotiable, build these in from day one)
- No payment ever collected before a confirmed viewing.
- Every listing manually reviewed before going live.
- Every agent has a public profile: verified, completion rate, rating.
- Booking-lock mechanic: once a viewing is scheduled, the listing flags to other interested parties; auto-delists on close. Prevents the double-rental scam pattern documented in the Nigerian market.
- Platform is legally a facilitator/marketplace, not a party to any lease or sale — same posture as Airbnb/Zillow.

## Data model (core tables)
- `profiles` — user_id, role (renter_buyer/landlord/agent/admin), full_name, phone, verified, created_at
- `listings` — id, owner_id, title, type (rent/sale), property_type, price, location_text, lat, lng, bedrooms, bathrooms, description, images[], status (draft/pending_review/live/closed), listing_fee_paid, created_at
- `bookings` — id, listing_id, requester_id, agent_id, scheduled_at, status (requested/confirmed/completed/cancelled), notes
- `agents` — id, profile_id, coverage_area, active, rating
- `deals` — id, listing_id, buyer_renter_id, agent_id, deal_type (sale/rental), agreed_price, commission_pct, commission_amount, status (open/closed_won/closed_lost), closed_at
- `payments` — id, user_id, purpose (listing_fee/commission), amount, paystack_ref, status
- RLS policies enforced at the database level from the start (landlords only see their own listings, agents only see assigned bookings) — not just app-level checks.

## Build phases (this is also the branch plan — one feature branch per phase)
1. `feature/foundation` — auth, roles, schema, RLS policies, PWA manifest + basic service worker
2. `feature/listings-core` — create listing, pay listing fee (Paystack), manual review workflow, publish
3. `feature/search-map` — Leaflet map + list view, filters, Postgres full-text + geo search
4. `feature/bookings-agents` — booking request flow, agent assignment, agent/renter/landlord dashboards
5. `feature/deals-commissions` — deal pipeline, invoice-based commission collection, commission clause
6. `feature/admin-trust` — admin panel, listing moderation, incident runbook (written here), backup script (written and restore-tested here — hard prerequisite before phase 7)
7. `feature/launch-prep` — Sentry integration, PWA offline-caching polish, seed 5–10 real listings first, then open to the full 50-listing waived-fee cohort, soft launch in Abuja

Merge each feature branch to `main` only after its own end-to-end test pass. Don't start a new feature branch until the current one is merged — keeps debugging isolated to one feature at a time, which was the whole point of this branching approach.

## Technical practices (from prior planning — apply throughout, not just at the end)
- Validate all input server-side (never trust client-side validation alone), using a schema library (Zod).
- Money- and booking-critical operations (booking-lock, payment status updates) run as atomic Postgres transactions, not multiple separate steps — this is what actually prevents race conditions like double-booking.
- Paystack webhooks handled idempotently (check if a payment reference was already processed before acting on it).
- User-facing errors are always plain-language; raw errors/stack traces are never shown to users, only logged (Sentry).
- Self-review checklist required before merging any change touching payments, bookings, or commission logic (stand-in for code review on a solo build) — from Phase 2 onward.
- Rate-limit login and OTP-request endpoints.
- Secrets only in environment variables, never committed.

## Growth mechanics (zero cash cost, build when there's time)
- Public agent leaderboard by response time / completion rate / rating.
- Commission-funded referral incentives (landlord-refers-landlord, agent-refers-landlord).
- Diaspora-focused positioning in marketing copy where relevant ("verified for Nigerians abroad").

## Still open (ask the user, don't assume)
- Exact enforceability window for the commission clause after a viewing (6 vs 12 months).
- Whether to revisit a deposit model later if commission-dodging proves to be a frequent real problem.
- Exact trigger for the Supabase Pro upgrade (listing-count/revenue threshold vs. calendar date).

## Companion documents
A `docs/` folder sits alongside this file with the full business and design documentation. Two are directly relevant to implementation and worth reading when working on the corresponding phase:
- `docs/app-flow.docx` — screen-by-screen user journey for every role (landlord, agent, renter/buyer, admin). Read this before building any screen/page.
- `docs/ui-ux-specification.docx` — design direction, color/typography reasoning, core screen list, component patterns, mobile-first constraints. Read this before styling anything.
The rest (`business-build-plan.docx`, `business-plan-no-costs.docx`, `investor-prospectus.docx`, `development-flow-tools-guide.docx`, `total-cost-summary.docx`) are business/strategy reference, not needed for day-to-day coding.

## Working style
- The founder (Amin) is new to hands-on development — explain every step, not just what to do but why, in plain language. Don't assume familiarity with terminal commands, git operations, framework conventions, or jargon (e.g. don't just say "run the migration," say what a migration is, what command runs it, and what should happen when it works).
- Before running anything non-trivial, briefly state what the command/action does and what success looks like, so mistakes are caught immediately rather than discovered later.
- When something breaks, explain what likely went wrong in plain terms before fixing it, not just the fix — the goal is that Amin is learning the stack as we build, not just watching it get built.
- Go step by step rather than batching many changes at once, especially early on — smaller, explained steps beat large unexplained ones for someone building their first real project.
- Everything ships on free tiers until real revenue exists — always flag if a suggested approach would break that constraint.
- Fraud-prevention mechanics are the product's actual differentiator versus PropertyPro.ng/Nigeria Property Centre — don't quietly simplify them away for convenience during implementation.
