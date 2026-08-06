import { cn } from "@/lib/utils";

/**
 * The verification badge from the UI spec §1 and §3.
 *
 * "Verification is visual, not just textual: a consistent badge/checkmark
 * treatment used everywhere a listing or agent is shown — search results,
 * listing detail, agent profile — so 'verified' becomes instantly recognisable
 * rather than a word buried in a description."
 *
 * It uses the BRAND colour rather than the success green, because the spec puts
 * the verification badge alongside headers and primary buttons as a brand
 * signal. That also keeps it distinct from the green status pill, so "verified
 * agent" never reads as "confirmed booking".
 *
 * This is the product's core trust signal, so there is exactly one
 * implementation and no per-screen variations.
 */
export function VerifiedBadge({
  label = "Verified",
  size = "md",
  className,
}: {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-200",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        className
      )}
    >
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        // The icon is decorative: the word "Verified" sits right beside it, so
        // announcing it again would just be noise for screen reader users.
        aria-hidden="true"
        className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"}
      >
        <path
          fillRule="evenodd"
          d="M10 1.5l2.1 1.6 2.6-.2.9 2.5 2.2 1.4-1 2.4 1 2.4-2.2 1.4-.9 2.5-2.6-.2L10 18.5l-2.1-1.6-2.6.2-.9-2.5L2.2 13l1-2.4-1-2.4 2.2-1.4.9-2.5 2.6.2L10 1.5zm3.6 6.3a.9.9 0 00-1.3-1.2L9 9.9 7.7 8.6a.9.9 0 10-1.3 1.2l1.9 1.9c.36.35.94.35 1.3 0l4-3.9z"
          clipRule="evenodd"
        />
      </svg>
      {label}
    </span>
  );
}
