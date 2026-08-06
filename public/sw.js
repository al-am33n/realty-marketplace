/* =============================================================================
 * Realty Marketplace — service worker
 * Phase 1: basic. Offline-caching polish is Phase 7 per the build plan.
 *
 * A service worker is a script the browser runs in the background, separate
 * from any page. It can intercept network requests, which is what allows a web
 * app to respond when the connection drops.
 *
 * ---------------------------------------------------------------------------
 * SECURITY NOTE — read before extending this file.
 *
 * A service worker cache lives on the device and is NOT cleared when a user
 * logs out. Caching a page or API response that contained someone's private
 * data means the next person to use that phone could be served it from the
 * cache. On a platform holding phone numbers, booking details and payment
 * records, that is a serious leak.
 *
 * So this worker caches ONLY:
 *   - its own small precache list (the offline page and app icons)
 *   - same-origin static build assets under /_next/static/, which are
 *     content-hashed, public, and identical for every user
 *
 * It deliberately never caches:
 *   - HTML page responses (they may be personalised)
 *   - anything to Supabase, or any request carrying credentials
 *   - anything that is not a GET
 * ========================================================================== */

// Bump this string to force every client to discard old caches and re-fetch.
const VERSION = "v1";
const PRECACHE = `realty-precache-${VERSION}`;
const STATIC_CACHE = `realty-static-${VERSION}`;

const OFFLINE_URL = "/offline";

const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// --- install ---------------------------------------------------------------
// Fetch the offline fallback ahead of time, so it is already on the device by
// the time the network actually fails.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // `reload` bypasses the browser's own HTTP cache, so an update genuinely
      // fetches the new offline page rather than re-storing a stale copy.
      await cache.addAll(
        PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" }))
      );
      // Activate this new worker immediately instead of waiting for every tab
      // using the old one to close.
      await self.skipWaiting();
    })()
  );
});

// --- activate --------------------------------------------------------------
// Delete caches belonging to previous versions, then take control of pages that
// are already open.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== PRECACHE && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

// --- fetch -----------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never touch anything but plain GETs. A cached POST could replay a booking
  // or a payment action, which must always reach the server for real.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Leave other origins alone entirely — Supabase, Paystack, Cloudinary.
  // Their responses are either private, authenticated, or already CDN-cached.
  if (url.origin !== self.location.origin) return;

  // Skip our own API and auth routes: those responses are per-user.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    return;
  }

  // Page navigations: always go to the network so the user sees live data
  // (a listing's status can change at any moment, and showing a stale "live"
  // listing would undercut the booking-lock guarantee). Only if the network
  // fails do we show the offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(PRECACHE);
          const cached = await cache.match(OFFLINE_URL);
          return (
            cached ??
            new Response("You are offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        }
      })()
    );
    return;
  }

  // Build assets under /_next/static/ carry a content hash in their filename,
  // so a given URL's contents can never change. They are safe to serve from
  // cache first, which is what makes repeat visits fast on a slow connection.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        // Only store genuinely successful, non-opaque responses.
        if (response.ok && response.type === "basic") {
          cache.put(request, response.clone());
        }
        return response;
      })()
    );
  }
});
