import { cn } from "@/lib/utils";

/**
 * Marks a listing the platform's own team is handling.
 *
 * CLAUDE.md: "Every Platform-Direct listing is visibly, unambiguously labeled
 * as such to all users." That is not decoration. On every other listing the
 * platform is a neutral introducer with no stake in which buyer wins; on this
 * one it is the agent, and it is paid only if this particular property sells.
 * A buyer weighing advice from us about this property is entitled to know that
 * before they act on it — the same reason an estate agent's own board goes on
 * the front of the house.
 *
 * So this appears everywhere a Platform-Direct listing appears, and it always
 * carries the explanation rather than only the label: "Platform-Direct" means
 * nothing to someone seeing it for the first time.
 */
export function PlatformDirectBadge({
  size = "md",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 font-medium text-brand-900",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        className
      )}
    >
      <span aria-hidden="true">●</span>
      Platform-Direct
    </span>
  );
}

/** The badge plus the sentence that makes it mean something. */
export function PlatformDirectNotice({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-brand-300 bg-brand-50 p-4",
        className
      )}
    >
      <PlatformDirectBadge />
      <p className="mt-2 text-sm text-ink">
        Our own team is handling this property directly, rather than an
        independent agent. We show it, we negotiate, and we are paid a
        commission if it sells.
      </p>
    </div>
  );
}
