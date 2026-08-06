import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/**
 * Runs before every matching request.
 *
 * ⚠️  FILE NAME: this must be `proxy.ts`. Next.js 16 renamed the old
 * `middleware.ts` convention to `proxy.ts` — the behaviour is identical, but a
 * file still called `middleware.ts` is simply never run, with no warning. Every
 * Supabase guide written before Next 16 says `middleware.ts`; if sessions ever
 * start mysteriously expiring, check this file is still named correctly.
 *
 * WHY THIS EXISTS
 * A Supabase session is a short-lived token stored in a cookie. It expires
 * after about an hour and must be exchanged for a fresh one. Server Components
 * are not permitted to write cookies, so they cannot do that refresh
 * themselves. This proxy can, so it refreshes on every request and passes the
 * updated cookie along in both directions — to the app for this render, and
 * back to the browser for next time. Without it, users are logged out roughly
 * every hour mid-task.
 */
export async function proxy(request: NextRequest) {
  // Start from a response that carries the incoming request through unchanged.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write refreshed cookies onto the request, so anything rendering
          // later in THIS request already sees the new session...
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          // ...and onto the response, so the browser stores them for next time.
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not remove this call, and do not put code between creating
  // the client and running it. `getUser()` is what actually triggers the token
  // refresh. It also validates the token against Supabase's auth server rather
  // than trusting the cookie's contents.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // --- Optimistic route protection -----------------------------------------
  // A cheap redirect so signed-out users don't watch a dashboard skeleton load
  // before being bounced. This is a CONVENIENCE, not the security boundary.
  //
  // The Next.js docs are explicit that proxy should not be used as a full
  // authorisation solution, and this project doesn't rely on it as one: the
  // real enforcement is the RLS policies in the database, backed by per-page
  // checks. If this block were deleted entirely, no data would leak — a
  // signed-out user's queries would simply return nothing.
  const { pathname } = request.nextUrl;

  const requiresAuth =
    pathname.startsWith("/dashboard")
    || pathname.startsWith("/listings/new")
    || pathname.startsWith("/bookings")
    || pathname.startsWith("/admin")
    || pathname.startsWith("/verify");

  if (!user && requiresAuth) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    // Remember where they were headed so login can return them there.
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Someone already signed in has no use for the login or sign-up screens.
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/dashboard";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  /**
   * Which requests this runs on.
   *
   * Skipping static files matters for cost as much as speed: on Vercel's free
   * tier, proxy invocations are metered, and running an auth check for every
   * image and font on a photo-heavy property listing would burn through the
   * allowance for no benefit.
   *
   * The pattern below means: everything EXCEPT Next's build output, the PWA
   * files, and image requests.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
