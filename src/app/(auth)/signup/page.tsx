import type { Metadata } from "next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create your account",
};

/**
 * This page is a Server Component — the default in the App Router. It renders
 * on the server and ships no JavaScript of its own. Only the form is a Client
 * Component, because it needs interactivity, which keeps the amount of
 * JavaScript downloaded on a slow connection to the minimum the screen
 * actually needs.
 */
export default function SignupPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-900">
          Create your account
        </h1>
        <p className="mt-2 text-base text-ink-muted">
          Every listing is reviewed by our team, and every viewing is
          accompanied by a vetted agent.
        </p>
      </div>

      <SignupForm />
    </div>
  );
}
