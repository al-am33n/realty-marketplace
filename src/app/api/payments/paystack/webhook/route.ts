import { NextResponse, type NextRequest } from "next/server";
import { LISTING_FEE_KOBO, paystackConfigured, verifyWebhookSignature } from "@/lib/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Paystack webhook.
 *
 * This is the only place in the application where a payment is recognised as
 * real. It is a public URL that anyone on the internet can POST to, so the
 * order of operations matters:
 *
 *   1. Read the RAW body — the signature is computed over exact bytes.
 *   2. Verify the signature BEFORE parsing or trusting anything in it.
 *   3. Ignore events we do not care about.
 *   4. Record the payment idempotently, in one atomic database statement.
 *
 * Everything after step 2 assumes the payload is genuine. Nothing before it
 * does.
 */

export async function POST(request: NextRequest) {
  if (!paystackConfigured()) {
    console.error("[paystack webhook] PAYSTACK_SECRET_KEY is not set");
    // 500 rather than 200: Paystack should retry once we are configured
    // properly, rather than treating a dropped payment as delivered.
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  // Raw text, NOT request.json(). Parsing and re-stringifying changes
  // whitespace and key order, and the signature would never match again.
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    // Deliberately terse. An attacker probing this endpoint learns nothing
    // about why their forgery failed.
    console.error("[paystack webhook] signature verification failed");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: {
    event?: string;
    data?: {
      reference?: string;
      amount?: number;
      status?: string;
      metadata?: { listing_id?: string; user_id?: string; purpose?: string };
    };
  };

  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  // Anything other than a successful charge is acknowledged and ignored.
  // Returning 200 stops Paystack retrying an event we will never act on.
  if (event.event !== "charge.success") {
    return NextResponse.json({ received: true });
  }

  const data = event.data ?? {};
  const reference = data.reference;
  const listingId = data.metadata?.listing_id;
  const userId = data.metadata?.user_id;
  const amountKobo = data.amount;

  if (!reference || !listingId || !userId || typeof amountKobo !== "number") {
    console.error("[paystack webhook] charge.success missing required fields", { reference });
    // 200: the payload is genuinely from Paystack but not one we can act on,
    // so retrying will not help.
    return NextResponse.json({ received: true });
  }

  if (data.metadata?.purpose !== "listing_fee") {
    // Commission payments arrive in Phase 5 and will be handled separately.
    return NextResponse.json({ received: true });
  }

  // Confirm the amount matches what we actually charge. Paystack signs the
  // payload, so this is not about forgery — it catches a mismatched or stale
  // payment link, e.g. one created before a price change.
  if (amountKobo < LISTING_FEE_KOBO) {
    console.error("[paystack webhook] underpayment", { reference, amountKobo });
    return NextResponse.json({ received: true });
  }

  // Service role: `payments` has no INSERT policy for anybody, by design, so
  // only trusted server-side code can write here. Paystack is not a logged-in
  // user and has no session.
  const admin = createAdminClient();

  const { data: result, error } = await admin.rpc("record_listing_fee_payment", {
    p_paystack_ref: reference,
    p_user_id: userId,
    p_listing_id: listingId,
    p_amount_kobo: amountKobo,
    p_payload: event as never,
  });

  if (error) {
    console.error("[paystack webhook] recording failed", error.message);
    // 500 so Paystack retries. Idempotency means a retry is safe.
    return NextResponse.json({ error: "recording failed" }, { status: 500 });
  }

  const row = Array.isArray(result) ? result[0] : undefined;
  if (row && !row.newly_processed) {
    // A duplicate delivery, which is normal — Paystack retries. Logged at info
    // level because seeing these is reassuring, not alarming.
    console.log("[paystack webhook] duplicate delivery ignored", { reference });
  }

  return NextResponse.json({ received: true });
}
