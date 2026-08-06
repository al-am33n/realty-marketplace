import "server-only";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Records an attempt and reports whether the caller is still within the limit.
 *
 * Uses the admin (service role) client because `check_rate_limit` is granted to
 * `service_role` only — a user must not be able to call it directly and burn
 * through their own allowance, or anyone else's.
 *
 * Fails OPEN: if the database call errors, the attempt is allowed. That is a
 * deliberate trade-off. Failing closed would mean a hiccup in this secondary
 * safeguard locks every user out of logging in, which is a worse and much more
 * likely outcome than the brief window of unthrottled attempts it prevents.
 */
export async function checkRateLimit({
  key,
  maxAttempts,
  windowMinutes,
}: {
  key: string;
  maxAttempts: number;
  windowMinutes: number;
}): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_max_attempts: maxAttempts,
      p_window: `${windowMinutes} minutes`,
    });

    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}

/**
 * Best-effort client IP, read from the proxy headers Vercel sets.
 *
 * Used to limit by origin as well as by account, so someone cannot work through
 * a list of email addresses one attempt at a time and stay under a per-account
 * limit the whole way.
 *
 * These headers are supplied by the hosting platform and can be spoofed if the
 * app is ever run without a trusted proxy in front of it — hence "best effort".
 * The per-account limit is the stronger of the two and does not depend on this.
 */
export async function getClientIp(): Promise<string> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    // May be a chain "client, proxy1, proxy2" — the first entry is the client.
    return forwardedFor.split(",")[0]!.trim();
  }
  return headerList.get("x-real-ip") ?? "unknown";
}
