"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * How long something has been waiting, updating itself over time.
 *
 * Computed in the browser rather than during render, for two reasons:
 *
 *   1. Calling Date.now() while rendering makes the render non-idempotent —
 *      the same inputs stop producing the same output. React's purity rule
 *      flags it, and the lint error is pointing at a real problem.
 *   2. A relative time rendered on the server is wrong the instant the page is
 *      cached or simply left open. "Waiting 3h" that never advances is worse
 *      than no figure at all, especially when a reviewer is using it to honour
 *      a 24-hour promise.
 *
 * Before hydration it shows the absolute submission date, which is stable and
 * therefore safe to server-render — so there is no hydration mismatch and no
 * blank space for users without JavaScript.
 */
export function WaitingTime({
  since,
  overdueHours = 24,
  className,
}: {
  since: string;
  overdueHours?: number;
  className?: string;
}) {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    const submitted = new Date(since).getTime();
    const update = () => setElapsed(Date.now() - submitted);

    update();
    // A minute is frequent enough for an hours-scale figure, and cheap.
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [since]);

  if (elapsed === null) {
    // Server render and first paint: an absolute date, which cannot go stale.
    return (
      <span className={cn("text-sm text-ink-subtle", className)}>
        Submitted{" "}
        {new Date(since).toLocaleDateString("en-NG", {
          day: "numeric",
          month: "short",
        })}
      </span>
    );
  }

  const hours = Math.floor(elapsed / 3_600_000);
  const overdue = hours >= overdueHours;

  let label: string;
  if (hours < 1) {
    const minutes = Math.max(0, Math.floor(elapsed / 60_000));
    label = minutes < 2 ? "just now" : `${minutes} minutes`;
  } else if (hours < 48) {
    label = `${hours}h`;
  } else {
    label = `${Math.floor(hours / 24)} days`;
  }

  return (
    <span
      className={cn(
        "tabular text-sm",
        overdue ? "font-medium text-danger" : "text-ink-subtle",
        className
      )}
    >
      Waiting {label}
      {overdue && " — over our 24h target"}
    </span>
  );
}
