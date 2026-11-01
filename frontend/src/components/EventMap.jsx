import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { MARKET_COORDS, PNW_CENTER } from "@/lib/marketCoords";
import { categoryMeta, formatEventDate, eventTitleParts } from "@/lib/eventCategories";

const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pin = (n) => L.divIcon({
  className: "",
  html: `<div style="width:34px;height:34px;border-radius:999px;background:#1F3F5B;border:3px solid #F2A03B;color:#fff;font:700 13px/28px sans-serif;text-align:center;box-shadow:0 4px 12px rgba(15,23,42,.35)">${n}</div>`,
  iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18],
});

const venuePin = L.divIcon({
  className: "",
  html: '<div style="width:22px;height:22px;border-radius:999px 999px 999px 0;transform:rotate(-45deg);background:#F2A03B;border:3px solid #1F3F5B;box-shadow:0 3px 8px rgba(15,23,42,.35)"></div>',
  iconSize: [22, 22], iconAnchor: [11, 22], popupAnchor: [0, -20],
});

// Club/partner-hosted venues fly the brand burgee so they read as nautical.
const partnerPin = L.divIcon({
  className: "",
  html: `<div style="width:34px;height:34px;border-radius:999px;background:#1F3F5B;border:3px solid #F2A03B;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(15,23,42,.35)">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2.5 L5 21.5"/><path d="M5 4 L20 6.5 L16.5 8.5 L20 10.5 L5 13"/><path d="M9.3 5.7 L9.86 7.23 L11.49 7.29 L10.2 8.29 L10.65 9.86 L9.3 8.95 L7.95 9.86 L8.4 8.29 L7.11 7.29 L8.74 7.23 Z" fill="#fff" stroke="none"/></svg>
  </div>`,
  iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18],
});

// Vanilla Leaflet (no react-leaflet) — sidesteps React 19 StrictMode double-init.
export default function EventMap({ events, onOpen }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const map = L.map(el.current, { center: PNW_CENTER, zoom: 6, scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const onClick = (e) => {
      const btn = e.target.closest("[data-event-id]");
      if (btn) onOpenRef.current?.(JSON.parse(decodeURIComponent(btn.dataset.event)));
    };
    el.current.addEventListener("click", onClick);
    return () => { el.current?.removeEventListener("click", onClick); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const points = [];
    const groups = {};
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 45,
      iconCreateFunction: (c) => L.divIcon({
        className: "",
        html: `<div style="width:38px;height:38px;border-radius:999px;background:#1F3F5B;border:3px solid #F2A03B;color:#fff;font:700 14px/32px sans-serif;text-align:center;box-shadow:0 4px 12px rgba(15,23,42,.35)">${c.getChildCount()}</div>`,
        iconSize: [38, 38], iconAnchor: [19, 19],
      }),
    });
    // Events with an exact venue pin get their own marker; the rest cluster at the market center.
    for (const e of events) {
      if (typeof e.lat === "number" && typeof e.lng === "number") {
        points.push([e.lat, e.lng]);
        const data = encodeURIComponent(JSON.stringify(e));
        L.marker([e.lat, e.lng], { icon: e.organizer_partner_badge ? partnerPin : venuePin }).addTo(cluster).bindPopup(
          `<div data-testid="map-venue-${esc(e.id)}" style="min-width:220px">
            <button data-event-id="${esc(e.id)}" data-event="${data}" data-testid="map-event-${esc(e.id)}" style="text-align:left;width:100%;padding:4px;border-radius:6px;background:none;border:0;cursor:pointer">
              <div style="font:700 13px/1.25 sans-serif;color:#1F3F5B">${esc(eventTitleParts(e.title).title)}</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px">${esc(formatEventDate(e.starts_at, e.time_not_listed))} · <b>${esc(categoryMeta(e.category).label)}</b></div>
              ${e.location ? `<div style="font-size:11px;color:#64748b">${esc(e.location)}</div>` : ""}</button></div>`,
          { maxWidth: 300 },
        );
        continue;
      }
      if (!MARKET_COORDS[e.market]) continue;
      (groups[e.market] ||= []).push(e);
    }
    layer.addLayer(cluster);
    for (const [market, evs] of Object.entries(groups)) {
      const coords = MARKET_COORDS[market];
      points.push(coords);
      const items = evs.slice(0, 12).map((e) => {
        const data = encodeURIComponent(JSON.stringify(e));
        return `<li><button data-event-id="${esc(e.id)}" data-event="${data}" data-testid="map-event-${esc(e.id)}" style="text-align:left;width:100%;padding:4px;border-radius:6px;background:none;border:0;cursor:pointer">
          <div style="font:600 12px/1.25 sans-serif;color:#1F3F5B">${esc(eventTitleParts(e.title).title)}</div>
          <div style="font-size:11px;color:#64748b">${esc(formatEventDate(e.starts_at, e.time_not_listed))} · <b>${esc(categoryMeta(e.category).label)}</b></div></button></li>`;
      }).join("");
      const more = evs.length > 12 ? `<li style="font-size:11px;color:#94a3b8">+${evs.length - 12} more — filter by market to see all</li>` : "";
      L.marker(coords, { icon: pin(evs.length) }).addTo(layer).bindPopup(
        `<div data-testid="map-popup-${esc(market)}" style="min-width:240px">
          <div style="font:700 13px sans-serif;color:#1F3F5B">${esc(market)} · ${evs.length} event${evs.length === 1 ? "" : "s"}</div>
          <ul style="list-style:none;margin:8px 0 0;padding:0;max-height:224px;overflow-y:auto">${items}${more}</ul></div>`,
        { maxWidth: 320 },
      );
    }
    if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 9 });
    else if (points.length === 1) map.setView(points[0], 9);
    else map.setView(PNW_CENTER, 6);
  }, [events]);

  return <div ref={el} className="rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-sm relative z-0" style={{ height: 520 }} data-testid="event-map" />;
}
