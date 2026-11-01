const isAllDay = (iso) => !!iso && iso.endsWith("T00:00:00+00:00");
const pad = (n) => String(n).padStart(2, "0");
const stampUtc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const dateOnly = (iso) => iso.slice(0, 10).replace(/-/g, "");
const nextDay = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); const n = new Date(Date.UTC(y, m - 1, d + 1)); return `${n.getUTCFullYear()}${pad(n.getUTCMonth() + 1)}${pad(n.getUTCDate())}`; };

function range(ev) {
  if (isAllDay(ev.starts_at)) return { allDay: true, start: dateOnly(ev.starts_at), end: nextDay(ev.starts_at) };
  const s = new Date(ev.starts_at);
  const e = ev.ends_at ? new Date(ev.ends_at) : new Date(s.getTime() + 2 * 3600 * 1000);
  return { allDay: false, start: stampUtc(s), end: stampUtc(e) };
}

const esc = (s = "") => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

export function googleCalendarUrl(ev) {
  const r = range(ev);
  const p = new URLSearchParams({
    action: "TEMPLATE", text: ev.title, dates: `${r.start}/${r.end}`,
    details: [ev.description, ev.registration_url].filter(Boolean).join("\n\n"),
    location: [ev.location, ev.market].filter(Boolean).join(", "),
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function downloadIcs(ev) {
  const r = range(ev);
  const dt = r.allDay ? (k, v) => `${k};VALUE=DATE:${v}` : (k, v) => `${k}:${v}`;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sail More Now//Events//EN", "BEGIN:VEVENT",
    `UID:${ev.id}@sailmorenow.com`, `DTSTAMP:${stampUtc(new Date())}`,
    dt("DTSTART", r.start), dt("DTEND", r.end),
    `SUMMARY:${esc(ev.title)}`,
    `DESCRIPTION:${esc([ev.description, ev.registration_url].filter(Boolean).join("\n\n"))}`,
    `LOCATION:${esc([ev.location, ev.market].filter(Boolean).join(", "))}`,
    ev.registration_url ? `URL:${ev.registration_url}` : null,
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean);
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${(ev.title || "event").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
