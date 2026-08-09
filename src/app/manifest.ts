import type { MetadataRoute } from "next";

/**
 * Web App Manifest — makes the site installable to a phone home screen.
 *
 * Next.js serves this automatically at /manifest.webmanifest and links it from
 * every page, so no <link rel="manifest"> tag is needed by hand.
 *
 * This replaces the `next-pwa` plugin named in the project brief. That package
 * was last published in 2022, predates the App Router entirely, and its
 * maintained fork requires webpack — which Next.js 16 is moving away from.
 * Next.js now has manifest support built in, so the dependency buys nothing and
 * costs compatibility. See docs/ notes in the Phase 1 summary.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable id means an app update is recognised as the SAME app rather than
    // installing a second copy on the user's home screen.
    id: "/",
    name: "Realty Marketplace — Verified homes in Abuja",
    short_name: "Realty",
    description:
      "Browse verified properties for rent and sale in Abuja. Every listing is "
      + "reviewed, and every viewing is accompanied by a vetted agent.",
    start_url: "/",
    scope: "/",
    // "standalone" hides the browser address bar, so the installed app looks
    // and feels native rather than like a bookmarked web page.
    display: "standalone",
    orientation: "portrait",
    lang: "en-NG",
    dir: "ltr",
    categories: ["business", "lifestyle", "shopping"],
    // Shown on the splash screen while the app boots.
    background_color: "#faf8f5",
    theme_color: "#1b3c5e",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // "maskable" icons have padding built in so Android can crop them to
      // whatever shape the launcher uses (circle, squircle, rounded square)
      // without slicing the artwork.
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
