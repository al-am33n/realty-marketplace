"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { resendVerificationAction } from "@/app/actions/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { AuthFormState } from "@/lib/validation/auth";

const INITIAL: AuthFormState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? "Sending…" : "Resend confirmation email"}
    </Button>
  );
}

export function ResendForm({ email }: { email: string }) {
  const [state, formAction] = useActionState(resendVerificationAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col items-start gap-3">
      <input type="hidden" name="email" value={email} />
      <SubmitButton />
      {state.message && (
        <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>
      )}
    </form>
  );
}
