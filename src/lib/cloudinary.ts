import "server-only";

import { createHash } from "node:crypto";

/**
 * Cloudinary configuration and upload signing.
 *
 * `import "server-only"` is a build-time guard: if a client component ever
 * imports this file, even indirectly, the build FAILS rather than shipping the
 * API secret to browsers. Same protection as src/lib/supabase/admin.ts.
 *
 * WHY SIGNED UPLOADS
 *
 * Cloudinary offers "unsigned" uploads, where the browser posts straight to
 * Cloudinary using a preset name. That is simpler, and wrong for this project:
 * the preset name is visible in the page source, so anyone who finds it can
 * upload anything they like to your account until the free quota is gone.
 *
 * Signed uploads mean our server issues a short-lived signature for one
 * specific upload, tied to the folder and settings we choose. The secret stays
 * on the server, and an upload with no valid signature is refused by
 * Cloudinary. The browser still uploads directly — the file never passes
 * through our server — so a 4MB photo on a slow Nigerian mobile connection is
 * one upload, not two.
 */

export const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";

/** Photos per listing. Cloudinary's free tier is finite and shared across every
 *  listing on the platform, so this is a real constraint, not a UI preference.
 *  CLAUDE.md: "compress before upload, cap photos per listing". */
export const MAX_PHOTOS_PER_LISTING = 12;
export const MIN_PHOTOS_PER_LISTING = 3;

/** Largest file we accept from the browser, AFTER client-side compression. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function cloudinaryConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
      && process.env.CLOUDINARY_API_KEY
      && process.env.CLOUDINARY_API_SECRET
  );
}

/**
 * Builds a signature for a direct browser upload.
 *
 * Cloudinary's scheme: sort the parameters alphabetically, join as a query
 * string, append the API secret, and SHA-1 the result. Cloudinary repeats the
 * calculation on its side and rejects anything that does not match — so the
 * browser cannot alter the folder, the timestamp, or any other signed
 * parameter without invalidating the signature.
 */
export function signUpload(params: Record<string, string | number>): string {
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!secret) throw new Error("CLOUDINARY_API_SECRET is not set");

  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  return createHash("sha1").update(toSign + secret).digest("hex");
}

/**
 * Where a listing's photos live in Cloudinary.
 *
 * Namespacing by listing id keeps the media library navigable, and means a
 * listing's photos can be found and removed as a set later without guessing
 * which file belonged to which property.
 */
export function listingFolder(listingId: string): string {
  return `realty/listings/${listingId}`;
}

/**
 * Rewrites a delivered image URL to request an optimised version.
 *
 * `f_auto` picks the best format the requesting browser supports (usually WebP
 * or AVIF, often 30-50% smaller than JPEG) and `q_auto` chooses a quality level
 * per image. `c_limit` caps the dimensions without ever enlarging or cropping.
 *
 * This is why the app uses plain <img> rather than next/image: Cloudinary has
 * already done the optimisation, and Vercel's image pipeline is metered on the
 * free tier. Re-optimising would spend the allowance to no benefit.
 */
export function optimisedUrl(url: string, width = 1200): string {
  if (!url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/f_auto,q_auto,c_limit,w_${width}/`);
}
