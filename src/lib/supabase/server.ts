import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Supabase client for SERVER-SIDE code: Server Components, Server Actions and
 * Route Handlers.
 *
 * Still the anon key, so RLS still applies — this is not an escape hatch. The
 * difference from the browser client is where the session lives. On the server
 * there is no localStorage, so the session travels in cookies, and this client
 * reads and writes them through Next.js's cookie API.
 *
 * Must be created fresh per request. Never store the result in a module-level
 * variable: a shared instance would leak one user's session into another user's
 * request, since the server handles many people at once.
 */
export async function createClient() {
  // In Next.js 15+ `cookies()` is async and must be awaited.
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components are not allowed to set cookies — only Server
            // Actions and Route Handlers are. This throw is expected and safe
            // to swallow HERE, because proxy.ts refreshes the session on every
            // request, so the refreshed cookie still reaches the browser.
          }
        },
      },
    }
  );
}

/**
 * Returns the signed-in user, or null.
 *
 * Always uses `getUser()`, never `getSession()`. `getSession()` reads the
 * session straight out of the cookie, and a cookie is just data the browser
 * sent us — it can be forged. `getUser()` verifies the token with Supabase's
 * auth server before trusting it. On a platform where a forged session means
 * access to someone else's bookings and phone number, that round trip is worth
 * paying for.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user;
}

/**
 * Returns the signed-in user together with their profile row (role, verified
 * status, name). Most pages need both, and fetching them together avoids
 * every screen repeating the same join.
 */
export async function getCurrentProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return { user, profile: profile ?? null };
}
