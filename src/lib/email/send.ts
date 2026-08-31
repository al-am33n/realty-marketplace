import "server-only";

import { env } from "@/lib/env";

/**
 * Transactional email, through Resend.
 *
 * CLAUDE.md makes Resend the primary notification channel for v1: WhatsApp is
 * the eventual second channel for the highest-stakes moments, but it costs a
 * flat BSP subscription regardless of volume, so it waits for commission
 * revenue. Everything below is email, always — WhatsApp will be additive.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FAILS SOFT
 *
 * Every call returns a result instead of throwing, and every caller ignores a
 * failure. That is deliberate and worth stating plainly, because "swallow the
 * error" is usually a mistake.
 *
 * The alternative is worse. An admin approves a listing; the listing goes live
 * in the database; then Resend is briefly down. If that threw, the approval
 * request would fail AFTER the listing was already live — the admin would see
 * an error, click approve again, and get "that listing is no longer awaiting
 * review". The email is a notification ABOUT work that has already happened,
 * so it must never be able to undo or obscure that work.
 *
 * The failure is not silent: it is logged, and every message this app sends
 * duplicates information the recipient can also see on a page they can reach.
 * A landlord whose approval email is lost still sees "live" on their dashboard.
 * ---------------------------------------------------------------------------
 *
 * No `resend` npm package. This is one HTTP POST, and a dependency for one
 * fetch call is a dependency to keep updated, audit and ship for no benefit.
 */

const RESEND_API = "https://api.resend.com/emails";

/**
 * Who mail comes from.
 *
 * Resend will only deliver from a domain you have verified with it. Until a
 * real domain exists (CLAUDE.md defers buying one until launch), their sandbox
 * sender works — but ONLY to the address that owns the Resend account. That is
 * a genuine trap: sending to a landlord's address appears to succeed in code
 * and never arrives. Hence the warning logged below.
 */
const SANDBOX_FROM = "Realty Marketplace <onboarding@resend.dev>";

function fromAddress(): string {
  return process.env.EMAIL_FROM || SANDBOX_FROM;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export type EmailResult = { ok: boolean; id?: string; skipped?: boolean; error?: string };

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Some clients show it, and spam filters expect it. */
  text: string;
}): Promise<EmailResult> {
  if (!to) {
    console.error("[email] no recipient", { subject });
    return { ok: false, error: "no recipient" };
  }

  if (!emailConfigured()) {
    // Development, or before the key is set. Log what WOULD have been sent so
    // the flow is still testable without an account.
    console.log("[email skipped — RESEND_API_KEY not set]", { to, subject });
    return { ok: false, skipped: true };
  }

  const from = fromAddress();
  if (from === SANDBOX_FROM) {
    console.warn(
      "[email] sending from Resend's sandbox address. It only delivers to the "
        + "address that owns the Resend account — set EMAIL_FROM to a verified "
        + "domain before real landlords need to receive these."
    );
  }

  try {
    const response = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      cache: "no-store",
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("[email] send failed", response.status, body?.message ?? body?.name);
      return { ok: false, error: `HTTP ${response.status}` };
    }

    return { ok: true, id: body?.id };
  } catch (error) {
    console.error("[email] could not reach Resend", error instanceof Error ? error.message : error);
    return { ok: false, error: "unreachable" };
  }
}

/** Absolute link into the app. Email clients cannot resolve a relative path. */
export function appUrl(path: string): string {
  return `${env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}${path}`;
}
