import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Supabase client for CLIENT COMPONENTS (anything with "use client").
 *
 * Uses the anon/publishable key, so every query it makes is filtered by the
 * Row Level Security policies. This is the client that runs in the user's
 * browser — it is assumed to be fully visible to them, and the security model
 * accounts for that.
 *
 * Safe to call repeatedly: @supabase/ssr returns the same underlying instance
 * for the same arguments, so components don't each create their own connection.
 */
export function createClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
