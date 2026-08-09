import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // In the App Router, searchParams arrives as a Promise and must be awaited.
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-900">Welcome back</h1>
        <p className="mt-2 text-base text-ink-muted">
          Sign in to manage your listings, viewings and bookings.
        </p>
      </div>

      <LoginForm next={next} />
    </div>
  );
}
