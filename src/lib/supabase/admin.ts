import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env, serverEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Supabase client using the SERVICE ROLE key.
 *
 * ⚠️  THIS CLIENT BYPASSES EVERY ROW LEVEL SECURITY POLICY.
 *
 * It can read every user's phone number, alter any listing's status, and write
 * payment records. It exists because some operations legitimately cannot be
 * performed as a logged-in user:
 *
 *   - Paystack webhooks (Phase 2/5): Paystack is not a logged-in user, and the
 *     payments table intentionally has no INSERT policy for anybody else.
 *   - Marking a profile verified after phone OTP (Phase 1): the trigger in the
 *     schema migration blocks users from self-verifying, by design.
 *   - Agent assignment and the booking lock (Phase 4): must be atomic and must
 *     not be something an agent can do to themselves.
 *   - Admin moderation actions (Phase 6).
 *
 * RULES FOR USING IT
 *   1. Only ever inside a Route Handler or Server Action — never a component.
 *   2. Do your OWN authorisation check first. RLS is not protecting you here,
 *      so the code must confirm the caller is allowed to do the thing.
 *   3. Scope every query tightly. Prefer `.eq('id', x)` over broad reads.
 *
 * The `import "server-only"` line at the top is a build-time guard: if any
 * client component ever imports this file, even indirectly, the build FAILS
 * rather than shipping the key to browsers.
 */
export function createAdminClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        // No session handling at all: this client acts as the system, not as a
        // person, and must never pick up or persist a user's session.
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  );
}
