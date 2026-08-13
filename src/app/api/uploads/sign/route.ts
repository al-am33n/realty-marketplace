import { NextResponse, type NextRequest } from "next/server";
import {
  MAX_PHOTOS_PER_LISTING,
  cloudinaryConfigured,
  listingFolder,
  signUpload,
} from "@/lib/cloudinary";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";

/**
 * Issues a one-shot Cloudinary upload signature for a listing the caller owns.
 *
 * This endpoint is the only thing standing between the internet and your free
 * Cloudinary quota, so it checks, in order:
 *
 *   1. Is the caller signed in?
 *   2. Do they own this listing, and is it still editable?
 *   3. Are they under the per-listing photo cap?
 *   4. Are they under a rate limit?
 *
 * Only then does it sign, and the signature is scoped to that listing's folder
 * and expires with its timestamp.
 */
export async function POST(request: NextRequest) {
  if (!cloudinaryConfigured()) {
    console.error("[upload sign] Cloudinary env vars are missing");
    return NextResponse.json(
      { error: "Photo uploads aren't available right now." },
      { status: 503 }
    );
  }

  const { user } = await getCurrentProfile();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { listingId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const listingId = body.listingId;
  if (!listingId) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  // Ownership and editability. RLS means a listing belonging to someone else
  // simply is not returned, so this cannot be used to probe other people's
  // listings either.
  const supabase = await createClient();
  const { data: listing } = await supabase
    .from("listings")
    .select("id, owner_id, status, images")
    .eq("id", listingId)
    .maybeSingle();

  if (!listing || listing.owner_id !== user.id) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  if (listing.status !== "draft" && listing.status !== "rejected") {
    return NextResponse.json(
      { error: "This listing can no longer be edited." },
      { status: 409 }
    );
  }

  if ((listing.images?.length ?? 0) >= MAX_PHOTOS_PER_LISTING) {
    return NextResponse.json(
      { error: `You can add up to ${MAX_PHOTOS_PER_LISTING} photos per listing.` },
      { status: 409 }
    );
  }

  // Even for a legitimate owner: a runaway client or an impatient retry loop
  // could burn the shared free quota quickly.
  const ip = await getClientIp();
  const allowed = await checkRateLimit({
    key: `upload:${user.id}:${ip}`,
    maxAttempts: 60,
    windowMinutes: 30,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many uploads just now. Please wait a few minutes." },
      { status: 429 }
    );
  }

  // Cloudinary expects seconds, and treats an old timestamp as expired — which
  // is what makes a leaked signature useless after a short while.
  const timestamp = Math.round(Date.now() / 1000);
  const folder = listingFolder(listingId);

  // Every parameter here is signed, so the browser cannot change any of them.
  // In particular it cannot redirect the upload into a different folder.
  const paramsToSign = { folder, timestamp };
  const signature = signUpload(paramsToSign);

  return NextResponse.json({
    signature,
    timestamp,
    folder,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  });
}
