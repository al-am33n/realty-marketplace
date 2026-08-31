import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runListingFeeBilling } from "@/lib/billing";

/**
 * The daily listing-fee billing run.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS AN HTTP ENDPOINT AND NOT A BACKGROUND WORKER
 *
 * A recurring charge needs something that runs on its own, on a schedule. The
 * usual answer is a long-running worker process — but the whole stack here is
 * free-tier, and free tiers have no always-on process to put one in. What they
 * do have is a scheduler that can call a URL. So the run is a URL.
 *
 * Vercel Cron calls this once a day (see vercel.json). Nothing else about the
 * design depends on that: any scheduler that can make an authenticated HTTPS
 * request works, which matters because free Vercel Cron is limited to one run a
 * day and a paid plan is not on the table until commission revenue exists.
 *
 * The schedule is `0 6 * * *` — 06:00 UTC, which is 07:00 in Lagos, Abuja and
 * Kaduna. Cron schedules on Vercel are always UTC, and Nigeria does not observe
 * daylight saving, so that offset never drifts. Charging in the morning means a
 * landlord reads "we couldn't take your fee" at a point in the day when they
 * can actually do something about it, and it puts a whole working day between
 * the run and anyone having to look at what it did.
 *
 * ---------------------------------------------------------------------------
 * WHY MISSING A DAY IS HARMLESS
 *
 * The run does not ask "whose anniversary is today?". It asks "who is past
 * their paid-up date?" — a question whose answer only grows while nobody is
 * asking it. A missed day, a failed deploy, a scheduler outage: the next run
 * picks up everything that accumulated. Nothing is skipped, and nothing is
 * charged twice, because the period reservation in the database is what decides
 * that, not this endpoint.
 *
 * ---------------------------------------------------------------------------
 * WHY IT NEEDS A SECRET
 *
 * This URL charges people's cards. It is on the public internet. Without a
 * shared secret, anyone who guessed the path could trigger a billing run at
 * will — they could not double-charge anyone (the database prevents that), but
 * they could hammer Paystack with declined-card attempts against real
 * customers, which is exactly how a merchant account gets suspended.
 */

// Node, not Edge: the billing run uses the service-role Supabase client and
// node:crypto, and it is long-running by nature.
export const runtime = "nodejs";

// Never cached, never statically analysed at build time. A cached billing run
// would be the strangest bug in this codebase.
export const dynamic = "force-dynamic";

/**
 * How long the platform will let one run take.
 *
 * Vercel's free tier caps this, and the cap is why `limit` below is modest
 * rather than the 200 the billing function would accept: each listing costs one
 * Paystack round trip plus a couple of database calls, and a run that is killed
 * halfway leaves reservations to be reaped rather than charges to be sorted
 * out. A smaller batch that finishes beats a larger one that does not.
 */
export const maxDuration = 60;

/** Listings per run. At one run a day this comfortably covers the launch scale. */
const BATCH_LIMIT = 40;

/**
 * Constant-time secret comparison.
 *
 * The same reasoning as the Paystack webhook signature: `===` on strings stops
 * at the first differing character, so the time it takes leaks how much of the
 * secret was right.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;

  // No secret configured means no authenticated caller is possible, so refuse
  // everything. Failing CLOSED is right here and wrong in the rate limiter:
  // there, a refusal locks users out of logging in; here, the only cost of a
  // refusal is that a billing run is skipped, and the next one catches up.
  if (!expected) return false;

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically once
  // CRON_SECRET is set as an environment variable on the project.
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";

  return bearer.length > 0 && secretMatches(bearer, expected);
}

async function handle(request: NextRequest) {
  if (!authorised(request)) {
    console.error("[billing run] unauthorised call");
    // Terse. Someone probing this path learns nothing about why it failed.
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const startedAt = Date.now();
  const result = await runListingFeeBilling({ limit: BATCH_LIMIT });

  console.log("[billing run]", {
    ...result,
    // The per-listing detail is useful in logs but noisy in the summary line.
    details: undefined,
    ms: Date.now() - startedAt,
  });

  if (result.halted) {
    // 200, not 500. The run reached a considered stop — most often "Paystack is
    // not configured yet" — and a 500 would make the scheduler retry a decision
    // that will not change until someone edits an environment variable.
    return NextResponse.json({ ok: false, ...result });
  }

  return NextResponse.json({ ok: true, ...result });
}

/** Vercel Cron issues a GET. */
export async function GET(request: NextRequest) {
  return handle(request);
}

/** POST is accepted too, so the run can be triggered by hand with curl. */
export async function POST(request: NextRequest) {
  return handle(request);
}
