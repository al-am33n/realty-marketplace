"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePhotosAction } from "@/app/actions/listings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Listing } from "@/lib/supabase/database.types";

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 12;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
/** Rejected before compression — anything larger is almost certainly not a photo. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/**
 * Shrinks a photo in the browser before uploading.
 *
 * A photo straight off a modern phone is 4-6MB and several thousand pixels
 * wide. Nobody browsing listings needs that, and uploading it costs the user
 * time and mobile data they are paying for — while eating a free Cloudinary
 * quota shared across every listing on the platform.
 *
 * Resizing to 1600px and re-encoding as JPEG typically turns 5MB into ~400KB
 * with no visible difference at the sizes these are actually displayed.
 * CLAUDE.md: "compress before upload, cap photos per listing".
 */
async function compressImage(file: File, maxDimension = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file; // No canvas support: send the original rather than failing.
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.82)
  );

  // If compression somehow produced something larger, keep the original.
  if (!blob || blob.size >= file.size) return file;
  return blob;
}

type Status = { kind: "idle" } | { kind: "uploading"; done: number; total: number };

export function PhotosForm({ listing }: { listing: Listing }) {
  const router = useRouter();
  const [images, setImages] = useState<string[]>(listing.images ?? []);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const persist = useCallback(
    (next: string[]) => {
      setImages(next);
      startSaving(async () => {
        const result = await savePhotosAction(listing.id, next);
        if (!result.ok) setError(result.message ?? "We couldn't save those photos.");
      });
    },
    [listing.id]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      const chosen = Array.from(files);
      const room = MAX_PHOTOS - images.length;

      if (room <= 0) {
        setError(`You've reached the maximum of ${MAX_PHOTOS} photos.`);
        return;
      }

      const usable = chosen.slice(0, room).filter((file) => {
        if (!ACCEPTED.includes(file.type)) {
          setError("Photos need to be JPEG, PNG or WebP files.");
          return false;
        }
        if (file.size > MAX_SOURCE_BYTES) {
          setError(`“${file.name}” is too large. Photos should be under 25MB.`);
          return false;
        }
        return true;
      });

      if (usable.length === 0) return;
      if (chosen.length > room) {
        setError(`Only the first ${room} were added — the limit is ${MAX_PHOTOS} photos.`);
      }

      setStatus({ kind: "uploading", done: 0, total: usable.length });
      const uploaded: string[] = [];

      for (const [index, file] of usable.entries()) {
        try {
          // One signature per upload, from our server. The API secret never
          // reaches the browser.
          const signResponse = await fetch("/api/uploads/sign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listingId: listing.id }),
          });
          const signed = await signResponse.json();
          if (!signResponse.ok) {
            setError(signed?.error ?? "We couldn't start the upload.");
            break;
          }

          const compressed = await compressImage(file);

          const form = new FormData();
          form.append("file", compressed);
          form.append("api_key", signed.apiKey);
          form.append("timestamp", String(signed.timestamp));
          form.append("folder", signed.folder);
          form.append("signature", signed.signature);

          // Straight to Cloudinary — the file never passes through our server,
          // so it is one upload rather than two.
          const uploadResponse = await fetch(
            `https://api.cloudinary.com/v1_1/${signed.cloudName}/image/upload`,
            { method: "POST", body: form }
          );
          const result = await uploadResponse.json();

          if (!uploadResponse.ok || !result.secure_url) {
            console.error("[upload]", result);
            setError(`“${file.name}” didn't upload. Please try again.`);
            break;
          }

          uploaded.push(result.secure_url);
          setStatus({ kind: "uploading", done: index + 1, total: usable.length });
        } catch {
          setError("Upload failed. Check your connection and try again.");
          break;
        }
      }

      setStatus({ kind: "idle" });
      if (uploaded.length > 0) persist([...images, ...uploaded]);
    },
    [images, listing.id, persist]
  );

  function remove(index: number) {
    persist(images.filter((_, i) => i !== index));
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= images.length) return;
    const next = [...images];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    persist(next);
  }

  const enough = images.length >= MIN_PHOTOS;
  const uploading = status.kind === "uploading";

  return (
    <div className="flex flex-col gap-6">
      {error && <Alert tone="danger">{error}</Alert>}

      {/* Drop zone. It is a real <button> so keyboard and screen reader users
          get the same thing as everyone else — a bare div with a click handler
          would be reachable by mouse only. */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
        }}
        disabled={uploading || images.length >= MAX_PHOTOS}
        className={cn(
          "flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          dragging ? "border-brand-600 bg-brand-50" : "border-line-strong bg-surface-raised",
          "hover:border-brand-300 disabled:opacity-60"
        )}
      >
        <span aria-hidden="true" className="text-3xl">
          📷
        </span>
        <span className="font-medium text-ink">
          {images.length >= MAX_PHOTOS
            ? `Maximum ${MAX_PHOTOS} photos reached`
            : "Tap to add photos, or drag them here"}
        </span>
        <span className="text-sm text-ink-muted">
          JPEG, PNG or WebP · {images.length} of {MAX_PHOTOS} added
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        multiple
        className="sr-only-text"
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files);
          e.target.value = ""; // allow re-picking the same file
        }}
      />

      {uploading && (
        <p role="status" aria-live="polite" className="text-sm text-ink-muted">
          Uploading photo {status.done + 1} of {status.total}… compressing before
          upload to save your data.
        </p>
      )}

      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((src, index) => (
            <li
              key={src}
              className="relative overflow-hidden rounded-lg border border-line bg-surface-raised"
            >
              {/* Plain <img>: Cloudinary already serves these optimised, and
                  Vercel's image optimisation is metered on the free tier. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src.replace("/upload/", "/upload/f_auto,q_auto,c_limit,w_400/")}
                alt={`Listing photo ${index + 1}${index === 0 ? " (cover photo)" : ""}`}
                className="h-32 w-full object-cover"
                loading="lazy"
              />

              {index === 0 && (
                <span className="absolute left-1.5 top-1.5 rounded bg-brand-700 px-1.5 py-0.5 text-xs font-medium text-white">
                  Cover
                </span>
              )}

              <div className="flex items-center justify-between gap-1 p-1.5">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0 || saving}
                    className="rounded px-2 py-1 text-sm text-ink-muted hover:bg-surface-sunken disabled:opacity-30"
                  >
                    <span aria-hidden="true">←</span>
                    <span className="sr-only-text">Move photo {index + 1} earlier</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, index + 1)}
                    disabled={index === images.length - 1 || saving}
                    className="rounded px-2 py-1 text-sm text-ink-muted hover:bg-surface-sunken disabled:opacity-30"
                  >
                    <span aria-hidden="true">→</span>
                    <span className="sr-only-text">Move photo {index + 1} later</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => remove(index)}
                  disabled={saving}
                  className="rounded px-2 py-1 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-40"
                >
                  Remove
                  <span className="sr-only-text"> photo {index + 1}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* The first photo is what appears in search results, so say so — it is
          not obvious, and it changes which photo people choose to put first. */}
      {images.length > 1 && (
        <p className="text-sm text-ink-subtle">
          The first photo is the one shown in search results. Use the arrows to
          reorder.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {!enough && (
          <Alert tone="pending">
            {MIN_PHOTOS - images.length === MIN_PHOTOS
              ? `Add at least ${MIN_PHOTOS} photos to continue.`
              : `${MIN_PHOTOS - images.length} more photo${
                  MIN_PHOTOS - images.length === 1 ? "" : "s"
                } needed — listings with photos of every room get far more viewings.`}
          </Alert>
        )}

        <Button
          onClick={() => router.push(`/listings/${listing.id}/edit/location`)}
          disabled={!enough || uploading || saving}
          fullWidth
        >
          {saving ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </div>
  );
}
