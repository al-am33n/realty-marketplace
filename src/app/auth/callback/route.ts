import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the link in the confirmation email lands.
 *
 * A Route Handler rather than a page, because it does work and then redirects —
 * it has nothing to render.
 *
 * Supabase sends one of two link shapes depending on the flow, so both are
 * handled here:
 *   ?code=...                 the PKCE flow
 *   ?token_hash=...&type=...  the older email-link flow
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  let userId: string | null = null;
  let failed = false;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth callback] exchangeCodeForSession", error.message);
      failed = true;
    } else {
      userId = data.user?.id ?? null;
    }
  } else if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) {
      console.error("[auth callback] verifyOtp", error.message);
      failed = true;
    } else {
      userId = data.user?.id ?? null;
    }
  } else {
    failed = true;
  }

  if (failed || !userId) {
    // A plain-language reason, no error codes. Expired links are by far the
    // most common cause, and "request a new one" is the useful instruction.
    const errorUrl = new URL("/verify", origin);
    errorUrl.searchParams.set("error", "link_invalid");
    return NextResponse.redirect(errorUrl);
  }

  /**
   * Mark the account verified.
   *
   * This uses the ADMIN client deliberately. The
   * profiles_guard_privileged_fields trigger blocks a user from setting their
   * own `verified` flag — that is the whole point of the trust gate, since
   * `verified` is what the RLS policies check before allowing a listing to be
   * created. So the flag can only be set by trusted server-side code, on
   * evidence the user actually controls the mailbox: the fact that they opened
   * a link only that inbox received.
   *
   * The `.eq("user_id", userId)` scope matters. The admin client bypasses RLS
   * entirely, so an unscoped update here would verify every account in the
   * database.
   */
  const admin = createAdminClient();
  const { error: verifyError } = await admin
    .from("profiles")
    .update({ verified: true, verified_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (verifyError) {
    // The session is valid, so let them in — but not as a verified user. They
    // simply cannot create a listing yet, and /verify explains why.
    console.error("[auth callback] marking verified", verifyError.message);
    return NextResponse.redirect(new URL("/verify?error=verify_failed", origin));
  }

  return NextResponse.redirect(new URL("/dashboard?welcome=1", origin));
}
