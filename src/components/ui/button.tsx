import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "money" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  fullWidth?: boolean;
};

/**
 * The app's button.
 *
 * `min-h-touch` (44px) comes from the UI spec's mobile-first rule that touch
 * targets are sized generously — small tap zones are the single most common
 * frustration on a phone.
 *
 * The `money` variant uses the reserved financial accent colour. Use it ONLY
 * for actions that move money (pay listing fee, settle commission). If it
 * starts appearing on ordinary buttons it stops carrying any meaning.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 disabled:bg-brand-300",
  secondary:
    "bg-surface-raised text-brand-800 border border-line-strong hover:bg-surface-sunken disabled:text-ink-subtle",
  money:
    "bg-money text-white hover:brightness-110 active:brightness-95 disabled:opacity-50",
  danger:
    "bg-danger text-white hover:brightness-110 active:brightness-95 disabled:opacity-50",
};

export function Button({
  variant = "primary",
  fullWidth = false,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      // Defaulting to "button" avoids a classic bug: an unlabelled <button>
      // inside a <form> defaults to type="submit" and silently submits it.
      type={type}
      className={cn(
        "inline-flex min-h-touch items-center justify-center rounded-lg px-5 text-base font-medium transition-colors",
        "disabled:cursor-not-allowed",
        VARIANTS[variant],
        fullWidth && "w-full",
        className
      )}
      {...props}
    />
  );
}
