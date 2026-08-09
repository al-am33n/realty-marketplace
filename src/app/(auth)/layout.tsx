import Link from "next/link";

/**
 * Shared shell for the sign-up and log-in screens.
 *
 * The folder is named `(auth)` with brackets, which makes it a Next.js "route
 * group": it organises files and applies this shared layout WITHOUT becoming
 * part of the URL. So the page at (auth)/login/page.tsx is served at /login,
 * not /auth/login.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto flex h-16 max-w-lg items-center px-5">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-semibold text-brand-900"
          >
            <span aria-hidden="true">🏠</span>
            Realty Marketplace
          </Link>
        </div>
      </header>

      {/* max-w-md keeps the form a comfortable reading width on a laptop while
          filling the screen on a phone — the mobile-first, single-column rule
          from the UI spec §4. */}
      <main className="mx-auto w-full max-w-md flex-1 px-5 py-8">{children}</main>

      <footer className="px-5 py-6 text-center text-xs text-ink-subtle">
        Realty Marketplace connects renters and buyers with verified agents in
        Abuja. We are a marketplace, not a party to any lease or sale.
      </footer>
    </div>
  );
}
