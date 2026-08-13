import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/server";

/**
 * Guard for the whole admin area.
 *
 * A layout wraps every page beneath it, so this check runs for all of
 * /admin/* without each page having to remember it — and a page added later
 * inherits the guard automatically rather than shipping unprotected.
 *
 * This is a convenience gate, not the security boundary. The real enforcement
 * is RLS: `is_admin()` is checked by the database on every admin policy, so
 * even if this layout were removed entirely, a non-admin's queries would return
 * nothing and their updates would be refused.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { user, profile } = await getCurrentProfile();

  if (!user) redirect("/login?next=/admin/listings");

  // Send non-admins to their own dashboard rather than showing a "forbidden"
  // page, which would confirm that an admin area exists here.
  if (!profile || profile.role !== "admin") redirect("/dashboard");

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-brand-900">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-4 px-5">
          <Link href="/admin/listings" className="text-lg font-semibold text-white">
            <span aria-hidden="true" className="mr-1.5">
              🛡️
            </span>
            Admin
          </Link>
          <Link href="/dashboard" className="text-sm text-brand-100 underline">
            Back to app
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-8">{children}</main>
    </div>
  );
}
