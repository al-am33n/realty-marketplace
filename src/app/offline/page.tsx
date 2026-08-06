import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "You're offline",
};

/**
 * Shown by the service worker when a page navigation fails because the device
 * has no connection. Kept deliberately self-contained: it must render from
 * cache with no data fetching of any kind.
 */
export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div
        aria-hidden="true"
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-3xl"
      >
        📡
      </div>

      <h1 className="text-2xl font-semibold text-brand-900">
        You&rsquo;re offline
      </h1>

      {/* Plain language, no error codes — per the project's rule that
          user-facing errors never expose raw technical detail. */}
      <p className="mt-3 max-w-sm text-base text-ink-muted">
        We couldn&rsquo;t reach Realty Marketplace. Check your mobile data or
        Wi-Fi connection, then try again.
      </p>

      <p className="mt-2 max-w-sm text-sm text-ink-subtle">
        Your saved searches and bookings are safe — nothing has been lost.
      </p>

      {/* A plain <a> rather than next/link: client-side navigation needs the
          app's JavaScript, which is exactly what may not be available here. */}
      <a
        href="/"
        className="mt-8 inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-700 px-6 text-base font-medium text-white transition-colors hover:bg-brand-800"
      >
        Try again
      </a>
    </main>
  );
}
