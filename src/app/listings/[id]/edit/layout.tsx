import Link from "next/link";

/**
 * Chrome shared by every step of the listing form.
 *
 * Note the progress indicator is NOT rendered here, even though it appears on
 * every step. In the App Router a layout is preserved across navigations
 * between its children, so a stepper fetched here would keep showing the
 * listing as it was when the layout first rendered — ticking "Details" as
 * incomplete right after the user completed it. Each step page loads the
 * listing itself and renders the stepper with fresh data.
 */
export default function ListingEditLayout({ children }: LayoutProps<"/listings/[id]/edit">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between gap-4 px-5">
          <Link href="/dashboard" className="text-lg font-semibold text-brand-900">
            <span aria-hidden="true" className="mr-1.5">
              🏠
            </span>
            Realty Marketplace
          </Link>
          {/* Leaving mid-form is safe — the draft is saved server-side — so say
              so rather than letting the user worry about losing their work. */}
          <span className="text-sm text-ink-subtle">Progress saves automatically</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8">{children}</main>
    </div>
  );
}
