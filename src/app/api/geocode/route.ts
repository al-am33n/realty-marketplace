import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getCurrentProfile } from "@/lib/supabase/server";

/**
 * Address lookup for the listing form's location step.
 *
 * Proxies OpenStreetMap's Nominatim service rather than calling it from the
 * browser, for three reasons:
 *
 *   1. Nominatim's usage policy requires a User-Agent identifying the
 *      application. Browsers do not allow scripts to set that header.
 *   2. The same policy caps request rate. Funnelling through one endpoint lets
 *      us actually enforce a limit instead of hoping.
 *   3. A direct browser call would hand a third party the IP address of every
 *      person who types an address into our form.
 *
 * Nominatim is free and has no key, which is why it fits the free-tier
 * constraint where Google's geocoder would not.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

// Nominatim asks for a way to contact the operator, so they can get in touch
// about heavy use rather than simply blocking. A URL satisfies that, and is
// preferable to a personal email address — this string is committed to the
// repo and sent to a third party on every request.
// Override with NOMINATIM_CONTACT once a real domain exists.
const CONTACT = process.env.NOMINATIM_CONTACT || env.NEXT_PUBLIC_SITE_URL;
const USER_AGENT = `RealtyMarketplace/0.1 (Abuja property listings; ${CONTACT})`;

type GeocodeResult = {
  label: string;
  lat: number;
  lng: number;
};

export async function GET(request: NextRequest) {
  // Signed-in users only. Without this the endpoint is a free, anonymous
  // geocoding proxy for anyone who finds it, and the rate limiting we do on
  // our side would be spent on strangers.
  const { user } = await getCurrentProfile();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 3) {
    return NextResponse.json({ results: [] });
  }

  const ip = await getClientIp();
  const allowed = await checkRateLimit({
    key: `geocode:${user.id}:${ip}`,
    maxAttempts: 60,
    windowMinutes: 10,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many address searches. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  const url = new URL(NOMINATIM);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  // v1 is Abuja-only, but restricting to Nigeria rather than to a bounding box
  // keeps the door open for other cities without another code change.
  url.searchParams.set("countrycodes", "ng");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "1");

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
      // Nominatim's policy permits caching, and identical searches are common
      // ("Wuse 2", "Maitama"). A day's cache cuts load on a free service we do
      // not pay for and makes repeat lookups instant.
      next: { revalidate: 86_400 },
    });

    if (!response.ok) {
      console.error("[geocode] nominatim", response.status);
      return NextResponse.json(
        { error: "Address lookup is unavailable right now." },
        { status: 502 }
      );
    }

    const raw: unknown = await response.json();
    const results: GeocodeResult[] = Array.isArray(raw)
      ? raw
          .map((item: Record<string, unknown>) => ({
            label: String(item.display_name ?? ""),
            lat: Number.parseFloat(String(item.lat)),
            lng: Number.parseFloat(String(item.lon)),
          }))
          .filter(
            (r) => r.label !== "" && Number.isFinite(r.lat) && Number.isFinite(r.lng)
          )
      : [];

    return NextResponse.json({ results });
  } catch (error) {
    console.error("[geocode]", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Address lookup is unavailable right now." },
      { status: 502 }
    );
  }
}
