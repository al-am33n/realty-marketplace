import "server-only";

import { appUrl } from "./send";

/**
 * The email templates.
 *
 * Hand-written HTML rather than a rendering library, because email HTML is not
 * web HTML: many clients strip <style> blocks, ignore flexbox and grid, and
 * discard external stylesheets entirely. Inline styles on tables are the only
 * thing that renders the same everywhere, and a React email renderer would only
 * be producing that same markup for us.
 *
 * Every message follows the UI spec's tone: say what happened, then say what to
 * do next. A notification with no next step leaves someone stuck in their inbox.
 */

/**
 * Escapes text before it goes into HTML.
 *
 * MANDATORY for anything a person typed. A rejection reason is written by an
 * admin and a listing title by a landlord, and either could contain `<` or `&`.
 * Unescaped, a title like `<b>Luxury` would break the layout of the email — and
 * worse, an anchor tag typed into a rejection reason would become a real,
 * clickable link inside a message that appears to come from us.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BRAND = "#1f4b3f";
const INK = "#1c2321";
const MUTED = "#5c6b66";

function layout({
  heading,
  body,
  action,
}: {
  heading: string;
  /** Already-escaped HTML paragraphs. */
  body: string;
  action?: { label: string; href: string };
}): string {
  const button = action
    ? `<tr><td style="padding:8px 0 4px 0;">
         <a href="${action.href}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:600;font-size:16px;">${esc(action.label)}</a>
       </td></tr>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px 12px;background:#f4f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e3e8e6;">
<tr><td style="padding:28px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding-bottom:16px;font-size:16px;font-weight:600;color:${BRAND};">Realty Marketplace</td></tr>
<tr><td style="padding-bottom:12px;font-size:20px;font-weight:600;color:${INK};line-height:1.35;">${esc(heading)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:${INK};">${body}</td></tr>
${button}
</table>
</td></tr>
<tr><td style="padding:0 24px 24px 24px;font-size:12px;line-height:1.6;color:${MUTED};border-top:1px solid #e3e8e6;padding-top:16px;">
We never ask for payment before a viewing is confirmed, and we never hold your
sale proceeds or rent. If an email ever asks you to do either, it did not come
from us.
</td></tr>
</table>
</body></html>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 12px 0;">${esc(text)}</p>`;
}

export type EmailContent = { subject: string; html: string; text: string };

/** Sent when an admin approves a listing (app-flow.docx §5). */
export function listingApprovedEmail({
  listingTitle,
  listingId,
}: {
  listingTitle: string;
  listingId: string;
}): EmailContent {
  const href = appUrl(`/listings/${listingId}/status`);
  const title = listingTitle || "Your listing";

  return {
    subject: `Your listing is live — ${title}`,
    html: layout({
      heading: "Your listing is live",
      body:
        p(`"${title}" has passed review and is now visible to renters and buyers.`)
        + p(
          "When someone asks to view it, we assign a vetted agent from our team, "
            + "confirm a time with you, and let you know. You never have to meet a "
            + "stranger at the property alone."
        ),
      action: { label: "View your listing", href },
    }),
    text:
      `Your listing is live\n\n"${title}" has passed review and is now visible to `
      + `renters and buyers.\n\nWhen someone asks to view it, we assign a vetted `
      + `agent from our team, confirm a time with you, and let you know.\n\n${href}\n`,
  };
}

/**
 * Sent when an admin rejects a listing.
 *
 * The reason is the entire point of the message. app-flow.docx §5 requires it,
 * and a rejection without one is a dead end for someone who cannot see the
 * review queue and has no way to guess what was wrong.
 */
export function listingRejectedEmail({
  listingTitle,
  listingId,
  reason,
}: {
  listingTitle: string;
  listingId: string;
  reason: string;
}): EmailContent {
  const href = appUrl(`/listings/${listingId}/edit/details`);
  const title = listingTitle || "Your listing";

  return {
    subject: `A few changes needed — ${title}`,
    html: layout({
      heading: "Your listing needs a few changes",
      body:
        p(`We reviewed "${title}" and it isn't ready to go live yet.`)
        + `<div style="margin:0 0 12px 0;padding:12px 14px;background:#f7f9f8;border-left:3px solid ${BRAND};border-radius:4px;">
             <div style="font-weight:600;margin-bottom:4px;">What needs changing</div>
             <div style="white-space:pre-line;">${esc(reason)}</div>
           </div>`
        + p(
          "Once you've made those changes you can send it straight back for review. "
            + "This is the same check every listing goes through — it is what keeps "
            + "fake listings off the platform."
        ),
      action: { label: "Edit and resubmit", href },
    }),
    text:
      `Your listing needs a few changes\n\nWe reviewed "${title}" and it isn't ready `
      + `to go live yet.\n\nWhat needs changing:\n${reason}\n\nOnce you've made those `
      + `changes you can send it straight back for review.\n\n${href}\n`,
  };
}

/** Confirms a submission reached the review queue. */
export function listingSubmittedEmail({
  listingTitle,
  listingId,
}: {
  listingTitle: string;
  listingId: string;
}): EmailContent {
  const href = appUrl(`/listings/${listingId}/status`);
  const title = listingTitle || "Your listing";

  return {
    subject: `We're reviewing your listing — ${title}`,
    html: layout({
      heading: "We're reviewing your listing",
      body:
        p(`"${title}" is with our review team — usually within 24 hours.`)
        + p(
          "We check the photos, price and location on every listing before it goes "
            + "live. We'll email you as soon as it's published, or explain what needs "
            + "changing if it isn't."
        )
        + p("There's nothing for you to do in the meantime."),
      action: { label: "Check the status", href },
    }),
    text:
      `We're reviewing your listing\n\n"${title}" is with our review team — usually `
      + `within 24 hours. We'll email you as soon as it's published, or explain what `
      + `needs changing if it isn't.\n\n${href}\n`,
  };
}

/**
 * Sent when a monthly renewal charge is declined.
 *
 * Tone matters more here than anywhere else in the app. A failed card is
 * usually a bank's daily limit or an expired date, not someone refusing to pay,
 * and a first message that reads like a demand loses a paying landlord over an
 * administrative hiccup. So: what happened, how long they have, one link.
 */
export function feeChargeFailedEmail({
  listingTitle,
  listingId,
  graceDays,
  feeLabel,
}: {
  listingTitle: string;
  listingId: string;
  graceDays: number;
  feeLabel: string;
}): EmailContent {
  const href = appUrl(`/listings/${listingId}/status`);
  const title = listingTitle || "your listing";

  return {
    subject: `We couldn't take this month's listing fee — ${title}`,
    html: layout({
      heading: "We couldn't take this month's listing fee",
      body:
        p(
          `This month's ${feeLabel} listing fee for "${title}" didn't go through. `
            + "That is usually an expired card or a daily limit at the bank rather than "
            + "anything wrong at your end."
        )
        + p(
          `Your listing stays visible for ${graceDays} more days. After that it is `
            + "hidden from search until the fee is settled — it isn't deleted, and it "
            + "doesn't need reviewing again. Paying brings it straight back."
        ),
      action: { label: "Settle the fee", href },
    }),
    text:
      `We couldn't take this month's listing fee\n\nThis month's ${feeLabel} listing `
      + `fee for "${title}" didn't go through — usually an expired card or a bank `
      + `limit.\n\nYour listing stays visible for ${graceDays} more days, then it is `
      + `hidden from search until the fee is settled. It isn't deleted, and paying `
      + `brings it straight back.\n\n${href}\n`,
  };
}

/** Confirms a successful renewal. Short by design — nothing is required. */
export function feeChargedEmail({
  listingTitle,
  listingId,
  feeLabel,
  paidThrough,
}: {
  listingTitle: string;
  listingId: string;
  feeLabel: string;
  paidThrough: string;
}): EmailContent {
  const href = appUrl(`/listings/${listingId}/status`);
  const title = listingTitle || "your listing";

  return {
    subject: `Listing fee received — ${title}`,
    html: layout({
      heading: "This month's listing fee is settled",
      body:
        p(`We've taken ${feeLabel} for "${title}". It stays live until ${paidThrough}.`)
        + p(
          "You can turn off renewal at any time from the listing's page — you keep the "
            + "month you have already paid for."
        ),
      action: { label: "See the listing", href },
    }),
    text:
      `This month's listing fee is settled\n\nWe've taken ${feeLabel} for "${title}". `
      + `It stays live until ${paidThrough}. You can turn off renewal at any time from `
      + `the listing's page.\n\n${href}\n`,
  };
}
