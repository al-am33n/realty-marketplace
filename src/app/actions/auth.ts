"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import {
  loginSchema,
  signupSchema,
  toFieldErrors,
  type AuthFormState,
} from "@/lib/validation/auth";

/**
 * Server Actions for authentication.
 *
 * "use server" at the top of the file means every exported function here runs
 * ON THE SERVER, even though forms in the browser call them directly. Next.js
 * handles the network round trip. Two consequences worth internalising:
 *
 *   1. Passwords and validation logic never reach the browser.
 *   2. These are effectively public HTTP endpoints. Anyone can call them with
 *      any arguments they like, so every one re-validates its input and
 *      re-checks permissions. The form's own validation counts for nothing
 *      here.
 */

// -----------------------------------------------------------------------------
// Sign up
// -----------------------------------------------------------------------------

export async function signupAction(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const raw = {
    fullName: String(formData.get("fullName") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    password: String(formData.get("password") ?? ""),
    role: String(formData.get("role") ?? ""),
  };

  // Keep what the user typed so a rejected submit doesn't clear the form —
  // never the password, which should not travel back to the browser.
  const values = {
    fullName: raw.fullName,
    email: raw.email,
    phone: raw.phone,
    role: raw.role,
  };

  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: toFieldErrors(parsed.error),
      values,
    };
  }

  // Throttle by origin: signup is where automated account creation would start.
  const ip = await getClientIp();
  const allowed = await checkRateLimit({
    key: `signup:ip:${ip}`,
    maxAttempts: 5,
    windowMinutes: 60,
  });
  if (!allowed) {
    return {
      ok: false,
      message:
        "Too many accounts have been created from this connection. Please try again in an hour.",
      values,
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // This metadata is read by the handle_new_user database trigger, which
      // creates the matching profiles row. The trigger refuses a role of
      // 'admin' regardless of what is sent here.
      data: {
        full_name: parsed.data.fullName,
        phone: parsed.data.phone,
        role: parsed.data.role,
      },
      emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (error) {
    // Log the real error for us; show the user something they can act on.
    console.error("[signup]", error.message);
    return {
      ok: false,
      message:
        "We couldn't create your account just now. Please check your details and try again.",
      values,
    };
  }

  // Note we do NOT reveal whether the address was already registered. Supabase
  // returns success either way by design: a different response for "already
  // taken" would let anyone test which email addresses have accounts here.
  redirect(`/verify?email=${encodeURIComponent(parsed.data.email)}`);
}

// -----------------------------------------------------------------------------
// Log in
// -----------------------------------------------------------------------------

export async function loginAction(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const raw = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    next: String(formData.get("next") ?? ""),
  };
  const values = { email: raw.email };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error), values };
  }

  // Two limits working together. The per-account one stops an attacker
  // hammering a single password box; the per-IP one stops them spreading a few
  // attempts each across a long list of addresses to stay under it.
  const ip = await getClientIp();
  const [accountOk, ipOk] = await Promise.all([
    checkRateLimit({
      key: `login:email:${parsed.data.email}`,
      maxAttempts: 10,
      windowMinutes: 15,
    }),
    checkRateLimit({ key: `login:ip:${ip}`, maxAttempts: 30, windowMinutes: 15 }),
  ]);

  if (!accountOk || !ipOk) {
    return {
      ok: false,
      message:
        "Too many sign-in attempts. Please wait about 15 minutes and try again.",
      values,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    console.error("[login]", error.message);

    // One message for every failure mode — wrong password, no such account,
    // unconfirmed email. Saying "no account with that email" would confirm to
    // an attacker which addresses are registered, which is the first step in
    // targeting them.
    return {
      ok: false,
      message: "That email and password don't match. Please try again.",
      values,
    };
  }

  // Only allow returning to a path inside this app. Without this check,
  // /login?next=https://evil.example could bounce a freshly-logged-in user
  // straight to an attacker's page — an open redirect, and a convincing one
  // because it happens right after a genuine sign-in.
  const next = parsed.data.next;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//")
    ? next
    : "/dashboard";

  redirect(safeNext);
}

// -----------------------------------------------------------------------------
// Log out
// -----------------------------------------------------------------------------

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// -----------------------------------------------------------------------------
// Resend the verification email
// -----------------------------------------------------------------------------

export async function resendVerificationAction(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    return { ok: false, message: "We don't have an email address to send to." };
  }

  // Tighter than login: each send costs a message from the free Resend
  // allowance, and an unthrottled resend button is a way to use someone's
  // inbox as a nuisance.
  const allowed = await checkRateLimit({
    key: `verify_resend:${email}`,
    maxAttempts: 3,
    windowMinutes: 60,
  });
  if (!allowed) {
    return {
      ok: false,
      message:
        "We've already sent several emails to this address. Please check your inbox and spam folder, then try again later.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback` },
  });

  if (error) {
    console.error("[resend verification]", error.message);
  }

  // Always report success, whether or not that address exists — same
  // account-enumeration reasoning as sign-up.
  return {
    ok: true,
    message: "We've sent the email. Please check your inbox and spam folder.",
  };
}
