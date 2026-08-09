"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { signupAction } from "@/app/actions/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { AuthFormState } from "@/lib/validation/auth";

const INITIAL: AuthFormState = { ok: false };

/**
 * Role choice, presented as large tappable cards rather than a dropdown.
 *
 * app-flow.docx §6 asks the first-run experience to "over-explain rather than
 * assume familiarity", so each option says what it means in the user's own
 * terms instead of just naming a role. A native <select> would be smaller to
 * build but gives no room to explain, and dropdowns are fiddly on a phone.
 *
 * Built on real radio inputs, so keyboard navigation and screen readers work
 * exactly as users expect — the styling sits on top rather than replacing them.
 */
const ROLE_OPTIONS = [
  {
    value: "renter_buyer",
    icon: "🔍",
    title: "I'm looking for a property",
    description: "Search homes to rent or buy, and book viewings with an agent.",
  },
  {
    value: "landlord",
    icon: "🔑",
    title: "I have a property to list",
    description: "List your property for rent or sale and receive viewing requests.",
  },
  {
    value: "agent",
    icon: "🤝",
    title: "I'm an agent",
    description:
      "Show properties to clients and earn commission. Requires verification by our team.",
  },
] as const;

function SubmitButton() {
  // useFormStatus reads the pending state of the surrounding <form>. Disabling
  // the button while submitting is what stops an impatient double-tap creating
  // two accounts.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth disabled={pending}>
      {pending ? "Creating your account…" : "Create account"}
    </Button>
  );
}

export function SignupForm() {
  const [state, formAction] = useActionState(signupAction, INITIAL);
  const values = state.values ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium text-ink">
          How will you use Realty Marketplace?
        </legend>

        {ROLE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer gap-3 rounded-lg border-2 bg-surface-raised p-4 transition-colors",
              "border-line-strong hover:border-brand-300",
              // Tailwind's `has-[...]` selector styles this label when the
              // radio inside it is checked — no JavaScript state needed.
              "has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
            )}
          >
            <input
              type="radio"
              name="role"
              value={option.value}
              defaultChecked={values.role === option.value}
              className="mt-1 h-5 w-5 shrink-0 accent-brand-700"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-ink">
                <span aria-hidden="true" className="mr-1.5">
                  {option.icon}
                </span>
                {option.title}
              </span>
              <span className="text-sm text-ink-muted">{option.description}</span>
            </span>
          </label>
        ))}

        {state.fieldErrors?.role && (
          <p role="alert" className="text-sm font-medium text-danger">
            {state.fieldErrors.role.join(". ")}
          </p>
        )}
      </fieldset>

      <Field
        label="Full name"
        name="fullName"
        autoComplete="name"
        defaultValue={values.fullName}
        errors={state.fieldErrors?.fullName}
        required
      />

      <Field
        label="Email address"
        name="email"
        type="email"
        // inputMode gives phone keyboards the @ key without a mode switch.
        inputMode="email"
        autoComplete="email"
        defaultValue={values.email}
        errors={state.fieldErrors?.email}
        hint="We'll send a confirmation link here."
        required
      />

      <Field
        label="Phone number"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="0803 123 4567"
        defaultValue={values.phone}
        errors={state.fieldErrors?.phone}
        hint="Agents use this to reach you about viewings."
        required
      />

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.password}
        hint="At least 8 characters, including a letter and a number."
        required
      />

      <SubmitButton />

      <p className="text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-700 underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
