import { cn } from "@/lib/utils";
import type {
  BookingStatus,
  DealStatus,
  ListingStatus,
  PaymentStatus,
} from "@/lib/supabase/database.types";

/**
 * The status pill from the UI spec §3.
 *
 * "Small rounded label (pending / live / closed / confirmed / etc.) using the
 * status colors from Section 1.1, used consistently across listings, bookings,
 * and deals."
 *
 * Every status in the system maps to exactly one of three tones — green, amber,
 * red — and that mapping lives here alone. A user learns the colours once on
 * the listings screen and they mean the same thing on bookings and deals. If
 * each screen picked its own colours, that learning would not transfer, which
 * is precisely the confusion a trust-led product cannot afford.
 *
 * The label is also always written out in words, never colour alone — colour is
 * not perceivable by every user, and is not information on its own.
 */

type Tone = "success" | "pending" | "danger" | "neutral";

const TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success border-success-line",
  pending: "bg-pending-soft text-pending border-pending-line",
  danger: "bg-danger-soft text-danger border-danger-line",
  neutral: "bg-surface-sunken text-ink-muted border-line-strong",
};

type AnyStatus = ListingStatus | BookingStatus | DealStatus | PaymentStatus;

const STATUS_MAP: Record<AnyStatus, { label: string; tone: Tone }> = {
  // listings
  draft: { label: "Draft", tone: "neutral" },
  pending_review: { label: "Under review", tone: "pending" },
  live: { label: "Live", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  closed: { label: "Closed", tone: "neutral" },

  // bookings
  requested: { label: "Requested", tone: "pending" },
  confirmed: { label: "Confirmed", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },

  // deals
  negotiating: { label: "Negotiating", tone: "pending" },
  agreed: { label: "Agreed", tone: "pending" },
  payment: { label: "Payment", tone: "pending" },
  closed_won: { label: "Closed — won", tone: "success" },
  closed_lost: { label: "Closed — lost", tone: "danger" },

  // payments
  pending: { label: "Payment pending", tone: "pending" },
  success: { label: "Paid", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  abandoned: { label: "Abandoned", tone: "neutral" },
};
// One flat map works because no two tables currently use the same status string
// for different things. `Record<AnyStatus, ...>` is what enforces that: add a
// value to any enum in the database types and this file stops compiling until
// the new status has a label and a tone. That is deliberate — a status with no
// pill is a status that renders as blank space in the UI.

export function StatusPill({
  status,
  className,
}: {
  status: AnyStatus;
  className?: string;
}) {
  const { label, tone } = STATUS_MAP[status];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className
      )}
    >
      {label}
    </span>
  );
}
