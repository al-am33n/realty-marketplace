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
 *
 * ---------------------------------------------------------------------------
 * TWO KINDS OF LISTING-FEE PAYMENT ARRIVE HERE
 *
 *   FIRST PAYMENT   The landlord went to Paystack's checkout themselves. We did
 *                   not know the reference in advance, so the payment row is
 *                   created here, by record_listing_fee_payment.
 *
 *   RENEWAL         The daily billing run charged a saved card. The payment row
 *                   already exists — the run reserved the billing period before
 *                   any money moved — so this must SETTLE that reservation, not
 *                   create a second row. Creating one would violate the unique
 *                   index and, if it somehow did not, would double-count the
 *                   month's revenue.
 *
 * They are told apart by the reference prefix, which begin_listing_fee_charge
 * controls: `lfee_` means the database issued it, so a row is already waiting.
 * That is a stronger signal than the `renewal: true` metadata flag, because the
 * reference is what the payment row is keyed on either way.
 */

/** References minted by begin_listing_fee_charge, i.e. renewals. */
const RENEWAL_REF_PREFIX = "lfee_";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PaystackAuthorization = {
  authorization_code?: string;
  last4?: string;
  card_type?: string;
  exp_month?: string;
  exp_year?: string;
  bank?: string;
  reusable?: boolean;
  channel?: string;
};

/**
 * Saves the card token that makes next month's charge possible.
 *
 * WE NEVER SEE A CARD NUMBER. Paystack hands back an `authorization_code`: an
 * opaque token that only works when presented alongside our own secret key, and
 * only charges the same customer. Storing it is what lets a renewal happen with
 * nobody present, without the platform going anywhere near card data.
 *
 * Only `reusable` authorizations are kept. A bank transfer or a one-time USSD
 * payment produces an authorization that cannot be charged again; storing one
 * would mean the billing run believes it has a card on file, skips the "no
 * saved card" branch, and then fails every month against a token that was never
 * chargeable. Worse than having nothing.
 *
 * Failures here are logged and swallowed. The payment itself has already
 * succeeded, and losing a saved card costs a landlord an invoice they pay by
 * hand — while failing the webhook over it would make Paystack retry an event
 * whose payment half is already recorded.
 */
async function storeAuthorization(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  authorization: PaystackAuthorization | undefined
): Promise<void> {
  const code = authorization?.authorization_code;
  if (!code || authorization?.reusable !== true) return;

  const { error } = await admin
    .from("billing_authorizations")
    .upsert(
      {
        user_id: userId,
        authorization_code: code,
        last4: authorization.last4 ?? null,
        card_type: authorization.card_type ?? null,
        exp_month: authorization.exp_month ?? null,
        exp_year: authorization.exp_year ?? null,
        bank: authorization.bank ?? null,
        active: true,
      },
      // Paystack returns the SAME authorization_code every time the same card
      // is charged, so a landlord paying three months running would otherwise
      // insert three identical rows. Keyed on the code, which is unique in the
      // table, so a repeat is an update rather than a duplicate.
      { onConflict: "authorization_code" }
    );

  if (error) {
    console.error("[paystack webhook] could not save the card authorization", error.message);
  }
}

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
      authorization?: PaystackAuthorization;
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

  // Save the card FIRST, before either branch below. A renewal that the billing
  // run already settled returns early further down, and the card on a first
  // payment is the whole reason a renewal is ever possible — so this must not
  // sit behind a code path that can return before reaching it.
  await storeAuthorization(admin, userId, data.authorization);

  if (reference.startsWith(RENEWAL_REF_PREFIX)) {
    const { data: settleRows, error: settleError } = await admin.rpc(
      "settle_listing_fee_charge",
      { p_reference: reference, p_succeeded: true, p_payload: event as never }
    );

    if (settleError) {
      console.error("[paystack webhook] settling a renewal failed", settleError.message);
      // 500 so Paystack retries. settle_listing_fee_charge only acts on a
      // pending row, so a retry cannot move the paid-up date twice.
      return NextResponse.json({ error: "settle failed" }, { status: 500 });
    }

    const settled = Array.isArray(settleRows) ? settleRows[0] : undefined;

    if (settled?.reason === "already_settled") {
      // Entirely normal. The billing run settles the charge itself the moment
      // Paystack's API answers; this webhook is the belt to that braces, and
      // arrives moments later for the same reference.
      console.log("[paystack webhook] renewal already settled", { reference });
    } else if (settled?.reason === "unknown_reference") {
      // A reference shaped like ours that we never issued. Genuinely odd — but
      // the payload is signed, so it is a bug on our side rather than an
      // attack. 200: retrying will not conjure the row into existence.
      console.error("[paystack webhook] renewal reference not recognised", { reference });
    } else if (settled?.reason === "period_already_paid") {
      // MONEY WAS TAKEN FOR A MONTH SOMEBODY ALREADY PAID FOR. The database
      // refused to extend the listing twice, which is right, but the payment is
      // real and a refund is owed. Nothing in code can decide that, so it is
      // logged as loudly as a log line can be — and this is the first thing the
      // Phase 6 admin alerts should be wired to.
      console.error(
        "[paystack webhook] OVERPAYMENT — refund owed. A listing fee was paid for a "
          + "billing period that another payment had already settled.",
        { reference, listingId }
      );
    }

    return NextResponse.json({ received: true });
  }

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
