import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  /** Messages from server-side validation, shown beneath the input. */
  errors?: string[];
  /** Guidance shown before the user types — format hints, why we need it. */
  hint?: ReactNode;
};

/**
 * A labelled text input with inline error and hint text.
 *
 * The accessibility wiring here is the point of having a shared component:
 *
 *   - the <label> is tied to the input by `htmlFor`/`id`, so tapping the label
 *     focuses the field and screen readers announce them together
 *   - `aria-describedby` links the hint and error text to the input, so the
 *     error is read out rather than being a visual-only cue
 *   - `aria-invalid` marks the field as failing, which assistive technology
 *     announces
 *
 * Getting this right once, here, means every form in the app inherits it —
 * rather than each screen reinventing it and quietly dropping half of it.
 */
export function Field({
  label,
  name,
  errors,
  hint,
  className,
  id,
  ...props
}: FieldProps) {
  const fieldId = id ?? name;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const hasError = Boolean(errors?.length);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-ink">
        {label}
      </label>

      {hint && !hasError && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}

      <input
        id={fieldId}
        name={name}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : hint ? hintId : undefined}
        className={cn(
          "min-h-touch w-full rounded-lg border bg-surface-raised px-3.5 text-base text-ink",
          "placeholder:text-ink-subtle",
          hasError ? "border-danger" : "border-line-strong",
          className
        )}
        {...props}
      />

      {hasError && (
        // `role="alert"` makes screen readers announce the message as soon as
        // it appears, rather than only when the user navigates onto the field.
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {errors!.join(". ")}
        </p>
      )}
    </div>
  );
}
