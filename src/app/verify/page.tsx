import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { getCurrentProfile } from "@/lib/supabase/server";
import { ResendForm } from "./resend-form";

export const metadata: Metadata = {
  title: "Confirm your email",
};

/**
 * The verification gate.
 *
 * app-flow.docx §1 puts a verification step before any listing can be created.
 * The check is not merely a screen: `profiles.verified` is what the RLS policy
 * on `listings` INSERT requires, so an unverified account is refused by the
 * database itself even if it bypasses this page entirely.
 *
 * ---------------------------------------------------------------------------
 * WHY EMAIL AND NOT SMS — see the Phase 1 notes.
 *
 * The app flow specifies a phone OTP. Sending an SMS requires a paid provider
 * (Twilio, Termii and the like); there is no free tier for Nigerian numbers,
 * which collides with the project's hard free-tier constraint. So verification
 * currently proves control of the EMAIL address, while the phone number is
 * still collected and stored.
 *
 * Everything downstream is unaffected: the gate is the `verified` boolean, and
 * nothing else reads how it came to be true. Switching to SMS later means
 * changing which channel sets that flag — the policies, the trigger and every
 * screen stay exactly as they are.
 * ---------------------------------------------------------------------------
 */
export default async function VerifyPage({ searchParams }: PageProps<"/verify">) {
  const params = await searchParams;
  const { user, profile } = await getCurrentProfile();

  // Already done — no reason to sit on this screen.
  if (profile?.verified) {
    redirect("/dashboard");
  }

  const email =
    (typeof params.email === "string" ? params.email : undefined)
    ?? user?.email
    ?? "";

  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <div className="mx-auto w-full max-w-md px-5 py-12">
      <div className="flex flex-col gap-6">
        <div>
          <div aria-hidden="true" className="mb-4 text-4xl">
            ✉️
          </div>
          <h1 className="text-2xl font-semibold text-brand-900">
            Confirm your email
          </h1>
          <p className="mt-2 text-base text-ink-muted">
            {email ? (
              <>
                We&rsquo;ve sent a confirmation link to{" "}
                <strong className="text-ink">{email}</strong>. Open it to
                activate your account.
              </>
            ) : (
              <>
                We&rsquo;ve sent you a confirmation link. Open it to activate
                your account.
              </>
            )}
          </p>
        </div>

        {error === "link_invalid" && (
          <Alert tone="danger" title="That link didn't work">
            It may have expired or already been used. Request a new one below.
          </Alert>
        )}

        {error === "verify_failed" && (
          <Alert tone="pending" title="Something went wrong on our side">
            Your email was confirmed, but we couldn&rsquo;t finish setting up
            your account. Please try the link again, or contact us if it keeps
            happening.
          </Alert>
        )}

        <Alert tone="info" title="Why we ask">
          Confirming your details is what lets us keep every listing and every
          agent on the platform accountable. It&rsquo;s also required before you
          can create a listing or book a viewing.
        </Alert>

        <div className="rounded-lg border border-line bg-surface-raised p-4">
          <p className="text-sm text-ink-muted">
            Can&rsquo;t find it? Check your spam or promotions folder first —
            confirmation emails often land there.
          </p>
          <div className="mt-4">
            {email ? (
              <ResendForm email={email} />
            ) : (
              <Link href="/login" className="text-sm font-medium text-brand-700 underline">
                Sign in to resend the email
              </Link>
            )}
          </div>
        </div>

        <p className="text-center text-sm text-ink-muted">
          Wrong address?{" "}
          <Link href="/signup" className="font-medium text-brand-700 underline">
            Sign up again
          </Link>
        </p>
      </div>
    </div>
  );
}
