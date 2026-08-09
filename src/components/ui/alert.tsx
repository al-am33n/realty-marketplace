import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AlertTone = "success" | "pending" | "danger" | "info";

const TONES: Record<AlertTone, string> = {
  success: "bg-success-soft border-success-line text-success",
  pending: "bg-pending-soft border-pending-line text-pending",
  danger: "bg-danger-soft border-danger-line text-danger",
  info: "bg-brand-50 border-brand-200 text-brand-900",
};

/**
 * A page-level message: "check your email", "those details didn't match".
 *
 * Errors shown here are always plain language. CLAUDE.md: raw errors and stack
 * traces are never shown to users, only logged — a message like
 * "AuthApiError: invalid_grant" tells the user nothing and tells an attacker
 * something.
 */
export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      // "assertive" for problems the user must act on; "polite" for the rest,
      // so a success note doesn't interrupt whatever is being read out.
      role={tone === "danger" ? "alert" : "status"}
      aria-live={tone === "danger" ? "assertive" : "polite"}
      className={cn("rounded-lg border px-4 py-3 text-sm", TONES[tone])}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className={cn(title && "mt-1")}>{children}</div>
    </div>
  );
}
