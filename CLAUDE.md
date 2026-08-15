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
- Notifications: **Resend (email) is the primary channel for v1** — booking confirmations, order updates, listing status. **Decided: dual-channel (Resend + WhatsApp) is the target, not WhatsApp-instead-of-Resend.** WhatsApp Business Cloud API requires a paid BSP subscription ($49–200/month, a flat cost regardless of how many notification types use it, since it's the cost of having WhatsApp access at all, not per-feature) plus a small per-message fee (~$0.01–0.016/message) — it is NOT free for business-initiated messages, only for replies to inbound customer messages. Because the BSP fee is flat, WhatsApp is deferred as a whole (not partially) until commission revenue funds it — at that point, add it specifically for **booking confirmations and deal-closed notifications** (the highest-stakes moments, where WhatsApp's better read-rate in Nigeria matters most), while lower-stakes notifications (listing under review, minor admin notices) stay email-only to keep message volume proportional to what needs urgency. Resend remains the channel for everything, always — WhatsApp is additive, never a replacement.
- Email: Resend free tier (3,000/mo)
- PWA: **native Next.js 16 manifest support** (not the next-pwa package originally planned — checked during Phase 1 and found abandoned since 2022, predating the App Router, with its maintained fork requiring webpack, which Next.js is moving off; native support achieves the same result at no cost). Manifest/basic service worker built in Phase 1, offline-caching polish in Phase 7. Native app (React Native/Expo, EAS Build for cloud iOS builds without a Mac) is a deferred, separately-funded track — not part of the 7-phase sequence — because Apple charges $99/year and Google $25 one-time, the one cost free tooling can't eliminate.
- Hosting: Vercel (flag: free Hobby tier is licensed non-commercial; upgrade to Pro from first commission revenue once real payments flow)
- Error monitoring: Sentry free Developer tier (5,000 errors/month)
- Domain: deferred — launch on free Vercel subdomain, buy real domain once ready to market publicly
- Backup storage: Cloudflare R2 free tier (10GB storage, 1M writes/10M reads per month, zero egress) — destination for the Phase 6 DIY database backup script
- Staging: a second Supabase project (free tier allows 2 projects) — separate from production, set up in Phase 6/7 rather than earlier since Phase 1–5 development ran directly against the live project
- Uptime monitoring: a free tier checker (e.g. UptimeRobot, Better Uptime) — confirms the site itself is reachable, distinct from Sentry which only catches application errors, not full outages
- Admin alerts: Telegram Bot API (genuinely free forever — no BSP fee, no per-message cost, unlike WhatsApp) — pings the founder's own phone for events like "new listing submitted for review" or "payment received." Not a user-facing notification channel (Telegram has low everyday usage in Nigeria vs WhatsApp) — internal/admin use only.
- Fraud-prevention APIs (free tier): AbuseIPDB (flags signups/listing submissions from known-abusive IP addresses) and HaveIBeenPwned (warns a user at signup if their email has appeared in a known data breach, encouraging a stronger password) — both align directly with the platform's trust-first differentiator.

## Launch scope (v1)
Sale + standard rental only. Short-let is Phase 2. **Geographic scope: Abuja, Lagos, and Kaduna** (expanded from the original Abuja-only plan — a deliberate departure from the earlier "soft launch narrow, one city" reasoning, made consciously, not by accident). Given the regulatory findings above, Abuja and Kaduna carry less immediate legal weight than Lagos — worth considering launching Abuja/Kaduna first and sequencing Lagos in once the LASRERA consultation is done, rather than treating all three as simultaneous from day one, though this sequencing is not yet a confirmed decision.

## Revenue model
- **Listing fee**: ₦5,000/month, recurring — applies only to **independent-agent listings**. **Platform-Direct listings (see below) pay no listing fee at all**, since the platform earns its full commission on close instead. First 50 listings get their first month free (cold-start subsidy), then billed ₦5,000/month from month 2 onward.
- **Platform-Direct closing (new, active decision):** at listing creation, a landlord chooses between (a) independent agent — existing 70/30 agent-favorable commission split, ₦5,000/month listing fee — or (b) Platform-Direct — the platform's own in-house team conducts the viewing and closes the deal directly, keeping 100% of the commission, no listing fee charged. The choice must be presented **neutrally in the UI** — not pre-selected or worded to nudge toward whichever option is more profitable for the platform. Every Platform-Direct listing is visibly, unambiguously labeled as such to all users. Scope to start: **sales only, not rentals** — larger commission per deal, more sustainable per-person workload for a small team. Contingent on real in-house team capacity (assumed available: 2–3 people). **Before this ships:** one targeted legal consultation on (a) current Abuja requirements for this model, (b) exposure if the draft federal escrow-account policy (see Regulatory notes below) becomes law. Recommended: at least one team member pursues NIESV student/graduate membership — both a hedge against incoming federal licensing and a genuine trust signal.
- **Agent payment model (recommended, not yet confirmed by Amin — do not treat as settled):** pure commission only, no flat per-viewing fee. Starting split 70% agent / 30% platform for independent-agent listings, weighted toward the agent for the first cohort specifically (same cold-start logic as the listing-fee waiver). Reliability enforced via the existing leaderboard/lead-assignment mechanic (better performance → more assigned leads), not cash bonuses — deliberately avoids owing money the platform hasn't already collected.
- **Sale commission**: 5–10% of sale price, invoice model — platform never holds sale proceeds, only invoices its commission slice via Paystack after close.
- **Rental commission**: positioned as a share of the customary ~10% agency fee Nigerian tenants already pay, split between platform and the agent who did the viewing. Invoice model, same as sale.
- **No booking deposit.** Commission is protected by (1) a signed procuring-cause commission clause at listing creation — commission owed if a deal closes with a platform-introduced party, regardless of whether paperwork ran through the platform, (2) the agent's own financial stake in the deal, (3) access consequences — dodging costs future listing/agent access.
- **Short-let (Phase 2 only)**: 15% commission, host-only, no guest fee. Paystack Split Payments/Subaccounts so the platform never custodies guest/host funds.

## Trust & fraud prevention (non-negotiable, build these in from day one)
- No payment ever collected before a confirmed viewing.
- Every listing manually reviewed before going live.
- Every agent has a public profile: verified, completion rate, rating.
- **Verification approach (as built in Phase 1, and confirmed as the approach for now): email verification for every role, including agents** — no Nigerian SMS provider has a genuine free tier, which collided with the free-build constraint. Requiring phone verification specifically for agents was considered and explicitly declined for now, to keep Phase 2 focused on listings rather than adding auth complexity. Phone number is still collected and stored; `profiles.verified` is channel-agnostic, so swapping in real SMS OTP later (for agents specifically or everyone) only changes which code sets that flag, not any policy or screen. Every listing still gets manual human review regardless, which remains the primary fraud control independent of verification channel.
- Booking-lock mechanic: once a viewing is scheduled, the listing flags to other interested parties; auto-delists on close. Prevents the double-rental scam pattern documented in the Nigerian market.
- Platform is legally a facilitator/marketplace, not a party to any lease or sale — same posture as Airbnb/Zillow. **Exception: Platform-Direct listings (see Revenue model) — the platform itself is a party to those deals, a deliberate, scoped, visibly-labeled departure from the facilitator posture, not a blanket change.**

## Regulatory notes (researched, not legal advice — get a real consultation before Platform-Direct ships)
- **LASRERA (Lagos State Real Estate Regulatory Authority)** mandates agent/agency registration with real penalties (₦250,000 individuals, ₦1,000,000 companies for operating unregistered) — but this is **Lagos-State-specific law**. Does not apply to an Abuja launch.
- **ESVARBON/NIESV** regulate formally trained **Estate Surveyors and Valuers** specifically (a distinct, examined profession) — their own stated mandate excludes pure sales/rental facilitation agents who aren't doing formal valuation work.
- **No FCT/Abuja equivalent to LASRERA found.** Abuja-specific regulation located in research (AGIS, Department of Lands) governs land *title* registration, not agency *licensing*. The regulatory landscape for pure agency work in Abuja is currently lighter than Lagos.
- **No Kaduna State equivalent to LASRERA found either.** General investment-promotion and environmental bodies exist, but nothing resembling Lagos's mandatory agent-licensing regime turned up. Nigeria Property Centre already lists active agents operating in Kaduna, consistent with a lighter regulatory environment. Treat as "nothing found," not "confirmed clear" — worth a real consultation before Platform-Direct goes live there, same caveat as Abuja.
- **Practical read across the 3-city launch:** Lagos is the one state with confirmed, actively-enforced, mandatory licensing (LASRERA) — Abuja and Kaduna both currently appear lighter. If sequencing the three rather than launching simultaneously, Lagos is the one that specifically warrants the legal consultation before going live there, given the real registered penalties (₦250,000 individuals, ₦1,000,000 companies) and active 2025–2026 enforcement.
- **Live risk to monitor, not yet law:** the federal Ministry of Housing and Urban Development announced a draft policy (~July 2026) proposing mandatory licensing for developers *and* agents nationwide, including a possible **escrow account requirement**. This would directly collide with the platform's invoice-only, non-custodial commission model if it passes. Check on this periodically — draft policies in Nigeria often take years to become enforced law, but this is a real, current signal, not hypothetical.

## Data model (core tables)
- `profiles` — user_id, role (renter_buyer/landlord/agent/admin), full_name, phone, verified, created_at
- `listings` — id, owner_id, title, type (rent/sale), property_type, price, location_text, lat, lng, bedrooms, bathrooms, description, images[], status (draft/pending_review/live/closed), listing_fee_paid, **listing_mode (independent/platform_direct — new field, needed for the Platform-Direct decision; drives which commission split and fee logic applies)**, created_at
- `bookings` — id, listing_id, requester_id, agent_id, scheduled_at, status (requested/confirmed/completed/cancelled), notes
- `agents` — id, profile_id, coverage_area, active, rating
- `deals` — id, listing_id, buyer_renter_id, agent_id, deal_type (sale/rental), agreed_price, commission_pct, commission_amount, status (**negotiating/agreed/payment/closed_won/closed_lost** — per app-flow.docx §4; supersedes the simpler open/closed_won/closed_lost sketch, "negotiating" through "payment" map onto what was originally called "open"), closed_at
- `payments` — id, user_id, purpose (listing_fee/commission), amount, paystack_ref, status
- RLS policies enforced at the database level from the start (landlords only see their own listings, agents only see assigned bookings) — not just app-level checks.

## Build phases (this is also the branch plan — one feature branch per phase)
1. `feature/foundation` — auth, roles, schema, RLS policies, PWA manifest + basic service worker
2. `feature/listings-core` — create listing, **independent vs Platform-Direct mode toggle (presented neutrally, see Revenue model)**, pay listing fee (Paystack, independent-mode only), manual review workflow, publish
3. `feature/search-map` — Leaflet map + list view, filters, Postgres full-text + geo search
4. `feature/bookings-agents` — booking request flow, agent assignment, agent/renter/landlord dashboards
5. `feature/deals-commissions` — deal pipeline, invoice-based commission collection, commission clause
6. `feature/admin-trust` — admin panel, listing moderation, incident runbook (written here), backup script (written and restore-tested here, targeting Cloudflare R2 for storage — hard prerequisite before phase 7), set up the staging Supabase project (second free-tier project) so phase 7 testing doesn't run against production, wire up Telegram bot admin alerts (new listing/payment events), integrate AbuseIPDB and HaveIBeenPwned checks into the trust/moderation tooling
7. `feature/launch-prep` — Sentry integration, uptime monitoring (separate free tool — Sentry catches errors, not full outages), PWA offline-caching polish, seed 5–10 real listings first, then open to the full 50-listing first-month-free cohort, soft launch across Abuja, Lagos, and Kaduna (consider sequencing Abuja/Kaduna first, Lagos once the LASRERA consultation is done — see Regulatory notes)

Merge each feature branch to `main` only after its own end-to-end test pass. Don't start a new feature branch until the current one is merged — keeps debugging isolated to one feature at a time, which was the whole point of this branching approach.

## Technical practices (from prior planning — apply throughout, not just at the end)
- Validate all input server-side (never trust client-side validation alone), using a schema library (Zod).
- Money- and booking-critical operations (booking-lock, payment status updates) run as atomic Postgres transactions, not multiple separate steps — this is what actually prevents race conditions like double-booking.
- Paystack webhooks handled idempotently (check if a payment reference was already processed before acting on it).
- User-facing errors are always plain-language; raw errors/stack traces are never shown to users, only logged (Sentry).
- Self-review checklist required before merging any change touching payments, bookings, or commission logic (stand-in for code review on a solo build) — from Phase 2 onward.
- Rate-limit login and OTP-request endpoints.
- Secrets only in environment variables, never committed.
- **Push to GitHub after every commit, not just commit locally.** A commit alone only saves history on this machine — GitHub stays out of date until an explicit `git push` runs. Treat "commit and push" as one combined step, not two separate ones to be asked about separately.
- **Run `npm run verify` (schema + RLS + end-to-end) after any migration, before merging any phase branch** — a schema catalog can look entirely correct (RLS enabled, grants present, constraints defined) while still failing in practice. Phase 1 caught three real bugs this way that were invisible on paper: missing service_role grants, RLS policy recursion across tables, and a NULL-handling trap in a CHECK constraint. Only acting as a real signed-in user surfaced any of them. Cross-table policy checks always go through a SECURITY DEFINER helper function, never an inline subquery — the recursion pattern that caused the second bug.

## Growth mechanics (zero cash cost, build when there's time)
- Public agent leaderboard by response time / completion rate / rating.
- Commission-funded referral incentives (landlord-refers-landlord, agent-refers-landlord).
- Diaspora-focused positioning in marketing copy where relevant ("verified for Nigerians abroad").

## Settled during the build
- **Commission clause enforceability window: 6 months** (decided in Phase 2, was open between 6 and 12; re-confirmed as settled on 2026-08-15 after a doc edit briefly reopened it). Runs from the date of introduction — normally the viewing — and each introduced person has their own separate window. The reason to state a window at all is that an unbounded claim is the *weakest* version of the term, not the strongest: an indefinite hold over someone's property reads as unreasonable and is what a court is most willing to read down. Lives in `src/lib/listings/commission-clause.ts` as `COMMISSION_WINDOW_MONTHS`; changing it means a new clause version, since `listings.commission_clause_version` binds each listing to the wording its owner actually read. **Still needs review by a Nigerian lawyer before real money depends on it.**

## Still open (ask the user, don't assume)
- Whether to revisit a deposit model later if commission-dodging proves to be a frequent real problem.
- Exact trigger for the Supabase Pro upgrade (listing-count/revenue threshold vs. calendar date).
- Confirm the agent payment model (recommended: pure commission, 70/30 agent-favorable split, no per-viewing fee) — Amin said "hold onto that," not yet confirmed as settled.

## Companion documents
A `docs/` folder sits alongside this file with the full business and design documentation. Two are directly relevant to implementation and worth reading when working on the corresponding phase:
- `docs/app-flow.docx` — screen-by-screen user journey for every role (landlord, agent, renter/buyer, admin). Read this before building any screen/page.
- `docs/ui-ux-specification.docx` — design direction, color/typography reasoning, core screen list, component patterns, mobile-first constraints. Read this before styling anything.
The rest (`business-build-plan.docx`, `business-plan-no-costs.docx`, `investor-prospectus.docx`, `development-flow-tools-guide.docx`, `total-cost-summary.docx`) are business/strategy reference, not needed for day-to-day coding.

## Working style
- The founder (Amin) is new to hands-on development — explain every step, not just what to do but why, in plain language. Don't assume familiarity with terminal commands, git operations, framework conventions, or jargon (e.g. don't just say "run the migration," say what a migration is, what command runs it, and what should happen when it works).
- Amin has confirmed he can dedicate real, sustained focus/time to this project — a prior concern about limited solo/part-time bandwidth being the biggest risk to the build was raised and explicitly corrected. Don't assume time-constrained pacing without reason to.
- Before running anything non-trivial, briefly state what the command/action does and what success looks like, so mistakes are caught immediately rather than discovered later.
- When something breaks, explain what likely went wrong in plain terms before fixing it, not just the fix — the goal is that Amin is learning the stack as we build, not just watching it get built.
- Go step by step rather than batching many changes at once, especially early on — smaller, explained steps beat large unexplained ones for someone building their first real project.
- Everything ships on free tiers until real revenue exists — always flag if a suggested approach would break that constraint.
- Fraud-prevention mechanics are the product's actual differentiator versus PropertyPro.ng/Nigeria Property Centre — don't quietly simplify them away for convenience during implementation.
