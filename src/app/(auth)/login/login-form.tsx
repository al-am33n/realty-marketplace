"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { loginAction } from "@/app/actions/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { AuthFormState } from "@/lib/validation/auth";

const INITIAL: AuthFormState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(loginAction, INITIAL);
  const values = state.values ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}

      {/* Carries the page the user was originally trying to reach, so they land
          there rather than on a generic dashboard. The server action only
          honours paths inside this app — see the open-redirect check there. */}
      {next && <input type="hidden" name="next" value={next} />}

      <Field
        label="Email address"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        defaultValue={values.email}
        errors={state.fieldErrors?.email}
        required
      />

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        errors={state.fieldErrors?.password}
        required
      />

      <SubmitButton />

      <p className="text-center text-sm text-ink-muted">
        Don&rsquo;t have an account?{" "}
        <Link href="/signup" className="font-medium text-brand-700 underline">
          Create one
        </Link>
      </p>
    </form>
  );
}
