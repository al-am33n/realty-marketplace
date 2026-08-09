"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Draggable map pin for the listing's location (app-flow.docx §1 step 3).
 *
 * OpenStreetMap tiles via Leaflet, per the stack decision — chosen over Mapbox
 * specifically because usage is uncapped and free.
 *
 * This component must only ever be rendered in the browser. Leaflet reads
 * `window` as its module loads, so importing it during server rendering
 * crashes. The parent loads it with next/dynamic and ssr: false.
 */

/** Roughly the centre of Abuja — where the map opens before an address is known. */
export const ABUJA_CENTER = { lat: 9.0765, lng: 7.3986 };

/**
 * A marker built from inline HTML rather than Leaflet's default icon.
 *
 * Leaflet's built-in marker references image files by relative path, which
 * bundlers rewrite and break — the classic "markers are invisible" problem. A
 * divIcon has no image to lose, and it lets the pin use the brand colour.
 */
function createPinIcon() {
  return L.divIcon({
    className: "",
    html: `
      <span style="
        display:block;width:28px;height:28px;border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);background:#1b3c5e;
        border:3px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,.35);
      "></span>`,
    iconSize: [28, 28],
    // Anchor at the pin's point, not its centre, so it sits on the exact spot.
    iconAnchor: [14, 28],
  });
}

/** Moves the map when the chosen coordinates change from outside (a search). */
function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], Math.max(map.getZoom(), 15));
  }, [lat, lng, map]);
  return null;
}

export default function LocationMap({
  lat,
  lng,
  onChange,
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}) {
  const icon = useMemo(() => createPinIcon(), []);
  const markerRef = useRef<L.Marker | null>(null);

  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      scrollWheelZoom={false}
      // Touch-friendly height; the UI spec calls for generous targets and the
      // map is the hardest thing to use on a small screen.
      style={{ height: "320px", width: "100%" }}
      className="rounded-lg border border-line-strong"
    >
      <TileLayer
        // Attribution is a requirement of using OpenStreetMap data, not a
        // nicety — do not remove it.
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <Recenter lat={lat} lng={lng} />
      <Marker
        position={[lat, lng]}
        draggable
        icon={icon}
        ref={markerRef}
        eventHandlers={{
          dragend: () => {
            const position = markerRef.current?.getLatLng();
            if (position) onChange(position.lat, position.lng);
          },
        }}
      />
    </MapContainer>
  );
}
