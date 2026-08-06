import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import "./globals.css";

// next/font downloads the font at BUILD time and serves it from our own domain.
// That matters for the target market: no request to Google's servers at page
// load, no extra DNS lookup on a slow mobile connection, and no layout shift
// while the font arrives.
//
// Only Geist Sans is loaded. The scaffold also included Geist Mono, which this
// app never uses — every unused font is a wasted download for a user on
// metered mobile data.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Realty Marketplace — Verified homes for rent and sale in Abuja",
    // Child pages set their own title, which slots into this pattern.
    template: "%s · Realty Marketplace",
  },
  description:
    "Browse verified properties for rent and sale in Abuja. Every listing is "
    + "reviewed, and every viewing is accompanied by a vetted agent.",
  applicationName: "Realty Marketplace",
  // Tells iOS to treat the installed PWA as a standalone app.
  appleWebApp: {
    capable: true,
    title: "Realty",
    statusBarStyle: "default",
  },
  // Stops iOS Safari auto-linking things that look like phone numbers
  // (property reference codes, prices) and restyling them unpredictably.
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  // Mobile-first: match the device width, and DO NOT block zooming.
  // Disabling pinch-zoom is a common default in app templates and an
  // accessibility failure — users with low vision rely on it.
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Colours the browser chrome around the app once installed.
  themeColor: "#1b3c5e",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-surface text-ink">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
