"use client";

import dynamic from "next/dynamic";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveLocationAction } from "@/app/actions/listings";
import { ABUJA_CENTER } from "@/components/listings/location-map";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { ListingFormState } from "@/lib/validation/listing";
import type { Listing } from "@/lib/supabase/database.types";

// Leaflet reads `window` when its module loads, so it cannot be rendered on the
// server. ssr: false defers the whole component to the browser.
const LocationMap = dynamic(() => import("@/components/listings/location-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[320px] w-full items-center justify-center rounded-lg border border-line-strong bg-surface-sunken text-sm text-ink-muted">
      Loading map…
    </div>
  ),
});

const INITIAL: ListingFormState = { ok: false };

type Suggestion = { label: string; lat: number; lng: number };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth disabled={pending}>
      {pending ? "Saving…" : "Save and continue"}
    </Button>
  );
}

export function LocationForm({ listing }: { listing: Listing }) {
  const action = saveLocationAction.bind(null, listing.id);
  const [state, formAction] = useActionState(action, INITIAL);

  const [address, setAddress] = useState(listing.location_text ?? "");
  const [position, setPosition] = useState({
    lat: listing.lat ?? ABUJA_CENTER.lat,
    lng: listing.lng ?? ABUJA_CENTER.lng,
  });
  // Whether a position has actually been chosen, as opposed to the map simply
  // opening on the default Abuja centre. Without this a user could skip the
  // step and silently pin every property to the same spot.
  const [hasPin, setHasPin] = useState(listing.lat !== null && listing.lng !== null);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function search() {
    const query = address.trim();
    if (query.length < 3) {
      setSearchError("Type at least 3 characters to search.");
      return;
    }

    setSearching(true);
    setSearchError(null);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const body = await response.json();

      if (!response.ok) {
        setSearchError(body?.error ?? "Address lookup didn't work. You can still drag the pin.");
        setSuggestions([]);
        return;
      }

      setSuggestions(body.results ?? []);
      if ((body.results ?? []).length === 0) {
        setSearchError(
          "We couldn't find that address. Try a nearby landmark or street, then drag the pin to the exact spot."
        );
      }
    } catch {
      // The map still works without search, so this is a setback rather than a
      // dead end — say so instead of just reporting failure.
      setSearchError("Address lookup didn't work. You can still place the pin by hand.");
    } finally {
      setSearching(false);
    }
  }

  function choose(suggestion: Suggestion) {
    setPosition({ lat: suggestion.lat, lng: suggestion.lng });
    setHasPin(true);
    setSuggestions([]);
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}

      <div className="flex flex-col gap-3">
        <Field
          label="Area or address"
          name="location_text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          errors={state.fieldErrors?.location_text}
          hint="For example “Wuse 2, Abuja” or “Plot 14, Gana Street, Maitama”."
          // Enter would otherwise submit the whole form instead of searching,
          // which is a surprising way to lose your place in a six-step form.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
          required
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => void search()}
          disabled={searching}
          className="self-start"
        >
          {searching ? "Searching…" : "Find on map"}
        </Button>

        {searchError && <Alert tone="pending">{searchError}</Alert>}

        {suggestions.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-lg border border-line bg-surface-raised p-2">
            {suggestions.map((suggestion, i) => (
              <li key={`${suggestion.lat},${suggestion.lng},${i}`}>
                <button
                  type="button"
                  onClick={() => choose(suggestion)}
                  className="w-full rounded px-3 py-2 text-left text-sm text-ink hover:bg-surface-sunken"
                >
                  {suggestion.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink">Exact position</p>
        <p className="text-sm text-ink-muted">
          Drag the pin to where the property actually is. This is what renters
          see on the map, so it&rsquo;s worth getting right.
        </p>

        <LocationMap
          lat={position.lat}
          lng={position.lng}
          onChange={(lat, lng) => {
            setPosition({ lat, lng });
            setHasPin(true);
          }}
        />

        {/* The map's coordinates travel to the server as hidden fields. */}
        <input type="hidden" name="lat" value={hasPin ? position.lat : ""} />
        <input type="hidden" name="lng" value={hasPin ? position.lng : ""} />

        {/* A map is a visual control, so also state the position in text —
            otherwise a screen reader user has no way to confirm it is set. */}
        <p className="tabular text-sm text-ink-subtle" aria-live="polite">
          {hasPin
            ? `Pin placed at ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`
            : "No pin placed yet — search for the address or drag the pin."}
        </p>
      </div>

      <SubmitButton />
    </form>
  );
}
