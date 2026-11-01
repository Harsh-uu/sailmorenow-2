import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MARKET_COORDS, PNW_CENTER } from "@/lib/marketCoords";

const pinIcon = L.divIcon({
  className: "",
  html: '<div style="width:22px;height:22px;border-radius:999px 999px 999px 0;transform:rotate(-45deg);background:#F2A03B;border:3px solid #1F3F5B;box-shadow:0 3px 8px rgba(15,23,42,.35)"></div>',
  iconSize: [22, 22], iconAnchor: [11, 22],
});

// Click-to-drop pin picker for event venue. value = {lat,lng} | null.
export default function LocationPicker({ market, value, onChange }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const map = L.map(el.current, { center: PNW_CENTER, zoom: 7, scrollWheelZoom: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    map.on("click", (e) => onChangeRef.current({ lat: +e.latlng.lat.toFixed(5), lng: +e.latlng.lng.toFixed(5) }));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || value) return;
    const c = MARKET_COORDS[market];
    if (c) map.setView(c, 12);
  }, [market, value]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) { map.removeLayer(markerRef.current); markerRef.current = null; }
    if (value) {
      markerRef.current = L.marker([value.lat, value.lng], { icon: pinIcon, draggable: true }).addTo(map);
      markerRef.current.on("dragend", (e) => { const p = e.target.getLatLng(); onChangeRef.current({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) }); });
    }
  }, [value]);

  return (
    <div data-testid="location-picker">
      <div ref={el} className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600 relative z-0" style={{ height: 240 }} />
      <div className="flex items-center justify-between mt-1.5 text-xs text-slate-500">
        <span data-testid="location-picker-status">{value ? `Pinned at ${value.lat}, ${value.lng} — drag to adjust` : "Tap the map to drop a pin on the marina, ramp or clubhouse (optional)"}</span>
        {value && <button type="button" onClick={() => onChange(null)} data-testid="location-picker-clear" className="font-semibold text-[#d98c30] hover:underline">Clear pin</button>}
      </div>
    </div>
  );
}
