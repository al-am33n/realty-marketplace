"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in public/sw.js.
 *
 * "use client" at the top marks this as a Client Component. Most of this app
 * renders on the server, but registration has to happen in the user's browser
 * because `navigator.serviceWorker` only exists there. This component renders
 * nothing — it exists purely for the side effect.
 *
 * Registration is skipped in development. A service worker aggressively holds
 * on to assets, which makes local changes appear not to take effect and is a
 * genuinely confusing thing to debug.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Wait for `load` so registering never competes with the initial render for
    // bandwidth — this matters on the slow connections the app targets.
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // A failed registration must never break the app. The site works
        // perfectly well without offline support, so this is silent by design.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
