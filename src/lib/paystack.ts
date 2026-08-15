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
 * ⚠️  ONE MONTH IS ALL THIS CHARGES TODAY. The fee is recurring by policy, but
 * only the first month's charge is built: this initialises a single Paystack
 * transaction with no plan or subscription behind it, and nothing yet bills
 * month two. Recurring billing is the next piece of work — until it lands, a
 * listing that has paid once stays up indefinitely without further charge.
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
}: {
  email: string;
  listingId: string;
  userId: string;
  callbackUrl: string;
}): Promise<InitialiseResult> {
  // Our own reference, not Paystack's. Prefixing with the listing id makes a
  // payment traceable to a listing from the Paystack dashboard alone, which
  // matters when reconciling a dispute months later.
  const reference = `listing_${listingId}_${Date.now()}`;

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
