import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paystack integration for the listing fee.
 *
 * `import "server-only"` fails the build if a client component ever imports
 * this, so the secret key cannot reach a browser.
 *
 * The platform uses the INVOICE model throughout (CLAUDE.md): it never holds
 * anyone's sale proceeds or rent. This file only handles the listing fee, which
 * is money genuinely owed to the platform for its own service. Commission
 * invoicing follows the same shape in Phase 5. Split Payments / Subaccounts are
 * reserved for the short-let phase, where guest money would otherwise pass
 * through the platform.
 */

const PAYSTACK_API = "https://api.paystack.co";

/**
 * The listing fee, in kobo like every other money value in this codebase.
 *
 * Settled in CLAUDE.md: ₦5,000 per month, on independent-agent listings only.
 * Platform-Direct listings pay nothing — the platform is paid out of the whole
 * commission on close instead — and never reach this code path at all.
 *
 * The fee genuinely recurs. It is not a Paystack Plan or Subscription: those
 * bill on Paystack's own schedule, which would put the decision of whether a
 * listing still owes anything on their side rather than ours. Instead each
 * month is a separate charge against a saved card, driven by the daily billing
 * run in src/lib/billing.ts, so the database stays the single authority on what
 * has been paid for and what has not — and cancelling is a row we own rather
 * than an API call that might not land.
 */
export const LISTING_FEE_KOBO = 500_000; // ₦5,000 per month

export function paystackConfigured(): boolean {
  return Boolean(process.env.PAYSTACK_SECRET_KEY);
}

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");
  return key;
}

/** Guards against a live key being used by accident during development. */
export function isLiveKey(): boolean {
  return (process.env.PAYSTACK_SECRET_KEY ?? "").startsWith("sk_live_");
}

export type InitialiseResult =
  | { ok: true; authorizationUrl: string; reference: string }
  | { ok: false; error: string };

/**
 * Starts a payment and returns the URL to send the user to.
 *
 * `metadata` travels with the transaction and comes back on the webhook, which
 * is how the webhook knows which listing was paid for without trusting anything
 * the browser sends us.
 */
export async function initialiseListingFee({
  email,
  listingId,
  userId,
  callbackUrl,
  reference: suppliedReference,
}: {
  email: string;
  listingId: string;
  userId: string;
  callbackUrl: string;
  /**
   * For a renewal paid by hand, the reference already reserved by
   * begin_listing_fee_charge. Passing it is what ties the checkout to the
   * billing period the database has set aside: the webhook recognises the
   * `lfee_` prefix and settles that reservation instead of writing a second
   * payment row for a month already accounted for.
   *
   * Omitted for a first payment, where no period exists to reserve yet.
   */
  reference?: string;
}): Promise<InitialiseResult> {
  // Our own reference, not Paystack's. Prefixing with the listing id makes a
  // payment traceable to a listing from the Paystack dashboard alone, which
  // matters when reconciling a dispute months later.
  const reference = suppliedReference ?? `listing_${listingId}_${Date.now()}`;

  try {
    const response = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: LISTING_FEE_KOBO, // Paystack works in kobo, as does our schema
        currency: "NGN",
        reference,
        callback_url: callbackUrl,
        metadata: {
          listing_id: listingId,
          user_id: userId,
          purpose: "listing_fee",
          renewal: Boolean(suppliedReference),
        },
      }),
      // Never cache a payment initialisation.
      cache: "no-store",
    });

    const body = await response.json();

    if (!response.ok || !body?.status || !body?.data?.authorization_url) {
      console.error("[paystack initialise]", response.status, body?.message);
      return { ok: false, error: "We couldn't start the payment. Please try again." };
    }

    return {
      ok: true,
      authorizationUrl: body.data.authorization_url,
      reference: body.data.reference ?? reference,
    };
  } catch (error) {
    console.error("[paystack initialise]", error instanceof Error ? error.message : error);
    return { ok: false, error: "We couldn't reach the payment provider. Please try again." };
  }
}

/**
 * Charges a card we already have permission to charge.
 *
 * This is how a monthly renewal happens with nobody present. The
 * `authorization_code` came back from the landlord's first successful card
 * payment; it is opaque, only works alongside our secret key, and only charges
 * that same customer. We never see or store the card itself.
 *
 * `reference` MUST be the one handed out by begin_listing_fee_charge. That
 * function has already reserved the billing period in the database, so a
 * duplicate run cannot reach this call for the same month.
 *
 * A "success" here is immediate — unlike a checkout, there is no redirect and
 * no waiting. The webhook will also arrive for the same reference, which is
 * why settling is idempotent on both sides.
 */
export async function chargeAuthorization({
  authorizationCode,
  email,
  reference,
  amountKobo,
  listingId,
  userId,
}: {
  authorizationCode: string;
  email: string;
  reference: string;
  amountKobo: number;
  listingId: string;
  userId: string;
}): Promise<{ ok: boolean; status?: string; message?: string; raw?: unknown }> {
  try {
    const response = await fetch(`${PAYSTACK_API}/transaction/charge_authorization`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authorization_code: authorizationCode,
        email,
        amount: amountKobo,
        currency: "NGN",
        reference,
        metadata: {
          listing_id: listingId,
          user_id: userId,
          purpose: "listing_fee",
          renewal: true,
        },
      }),
      cache: "no-store",
    });

    const body = await response.json();

    if (!response.ok || !body?.status) {
      return { ok: false, message: body?.message ?? `HTTP ${response.status}`, raw: body };
    }

    // Paystack returns 200 with data.status = "failed" for a declined card.
    // A declined card is not an error in our code — it is an ordinary outcome
    // that has to be reported to the landlord — so it is not thrown.
    return {
      ok: body.data?.status === "success",
      status: body.data?.status,
      message: body.data?.gateway_response,
      raw: body,
    };
  } catch (error) {
    console.error("[paystack charge]", error instanceof Error ? error.message : error);
    return { ok: false, message: "Could not reach the payment provider" };
  }
}

/**
 * Verifies that a webhook really came from Paystack.
 *
 * Paystack signs the RAW request body with HMAC-SHA512 using the secret key.
 * Two things matter here:
 *
 *   1. The signature must be computed over the raw body text, byte for byte.
 *      Parsing to JSON and re-stringifying changes whitespace and key order and
 *      the signature will never match.
 *   2. The comparison uses timingSafeEqual rather than `===`. A plain string
 *      comparison exits early on the first differing character, so how long it
 *      takes leaks how much of the signature was correct — enough, over many
 *      attempts, to forge one.
 *
 * Without this check the endpoint is an open invitation: anyone who knows the
 * URL could POST a fake "payment successful" event and get a free listing.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;

  const expected = createHmac("sha512", secretKey()).update(rawBody, "utf8").digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(signature, "utf8");

  // timingSafeEqual throws on length mismatch, so check that first — the length
  // itself is not a secret.
  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/** Confirms a transaction directly with Paystack, rather than trusting a redirect. */
export async function verifyTransaction(reference: string): Promise<{
  ok: boolean;
  status?: string;
  amountKobo?: number;
  metadata?: Record<string, unknown>;
}> {
  try {
    const response = await fetch(
      `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${secretKey()}` },
        cache: "no-store",
      }
    );
    const body = await response.json();

    if (!response.ok || !body?.status) return { ok: false };

    return {
      ok: true,
      status: body.data?.status,
      amountKobo: body.data?.amount,
      metadata: body.data?.metadata,
    };
  } catch (error) {
    console.error("[paystack verify]", error instanceof Error ? error.message : error);
    return { ok: false };
  }
}
