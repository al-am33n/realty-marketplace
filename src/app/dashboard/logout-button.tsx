"use client";

import { useFormStatus } from "react-dom";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending} className="px-4 text-sm">
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}

/**
 * Sign-out is a <form> rather than a link on purpose. It changes state, so it
 * must be a POST: a plain GET link could be triggered by anything that
 * pre-fetches URLs — a browser, a chat app unfurling a preview — and log the
 * user out without them touching it.
 */
export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <SubmitButton />
    </form>
  );
}
