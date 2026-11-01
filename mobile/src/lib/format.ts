import dayjs from "dayjs";

// Event times are shown in Pacific time (America/Los_Angeles, DST handled) and labelled PT.
// Pure-math Pacific offset so it works on Hermes (no reliance on Intl/timezone data).
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function nthSundayUTC(year: number, month1: number, n: number, hourUTC: number): number {
  const firstDow = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
  const day = 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
  return Date.UTC(year, month1 - 1, day, hourUTC, 0, 0);
}
// US Pacific: PDT (-420) from 2nd Sun Mar 02:00 local to 1st Sun Nov 02:00 local, else PST (-480).
function pacificOffsetMinutes(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  const dstStart = nthSundayUTC(y, 3, 2, 10);
  const dstEnd = nthSundayUTC(y, 11, 1, 9);
  return utcMs >= dstStart && utcMs < dstEnd ? -420 : -480;
}
type Fields = { y: number; mo: number; d: number; h: number; mi: number; dow: number };
function ptFields(iso: string): Fields {
  const base = new Date(iso);
  const s = new Date(base.getTime() + pacificOffsetMinutes(base.getTime()) * 60000);
  return { y: s.getUTCFullYear(), mo: s.getUTCMonth(), d: s.getUTCDate(), h: s.getUTCHours(), mi: s.getUTCMinutes(), dow: s.getUTCDay() };
}
function dateFields(iso: string): Fields {
  const [y, mo, d] = String(iso).slice(0, 10).split("-").map(Number);
  const dow = new Date(Date.UTC(y, (mo || 1) - 1, d || 1)).getUTCDay();
  return { y, mo: (mo || 1) - 1, d: d || 1, h: 0, mi: 0, dow };
}
// "No time" prefers the explicit stored flag; falls back to the legacy
// midnight-UTC sentinel only when the flag is absent (older rows).
const noTime = (iso?: string | null, flag?: boolean | null) =>
  typeof flag === "boolean" ? flag : (!iso || String(iso).length <= 10 || String(iso).endsWith("T00:00:00+00:00"));
const dLabel = (f: Fields) => `${DOW[f.dow]}, ${MON[f.mo]} ${f.d}`;
const tLabel = (f: Fields) => { const h = f.h % 12 || 12; const ap = f.h < 12 ? "AM" : "PM"; return `${h}:${String(f.mi).padStart(2, "0")} ${ap}`; };

// "[Draft] Foo" -> { title: "Foo", tentative: true }. Derived from the LIVE title
// so the Tentative label disappears automatically when the source drops "[Draft]".
export function eventTitleParts(title?: string | null): { title: string; tentative: boolean } {
  const t = (title || "").trim();
  const m = /^\[\s*draft\s*\]\s*/i.exec(t);
  return { title: m ? t.slice(m[0].length) : t, tentative: !!m };
}

export function fmtDate(iso?: string | null, timeNotListed?: boolean | null): string {
  if (!iso) return "";
  return dLabel(noTime(iso, timeNotListed) ? dateFields(iso) : ptFields(iso));
}

export function fmtDateTime(iso?: string | null, timeNotListed?: boolean | null): string {
  if (!iso) return "";
  if (noTime(iso, timeNotListed)) return `${dLabel(dateFields(iso))} · Time not listed, see details`;
  const f = ptFields(iso);
  return `${dLabel(f)} · ${tLabel(f)} PT`;
}

// Start [- end], both Pacific, single "PT". Date-only shows the date (+ range) and "Time not listed".
export function fmtEventRange(starts?: string | null, ends?: string | null, timeNotListed?: boolean | null): string {
  if (!starts) return "";
  if (noTime(starts, timeNotListed)) {
    const a = dateFields(starts);
    if (ends && noTime(ends)) { const b = dateFields(ends); if (b.y !== a.y || b.mo !== a.mo || b.d !== a.d) return `${dLabel(a)} to ${MON[b.mo]} ${b.d}`; }
    return `${dLabel(a)} · Time not listed, see details`;
  }
  const a = ptFields(starts);
  if (!ends || noTime(ends)) return `${dLabel(a)} · ${tLabel(a)} PT`;
  const b = ptFields(ends);
  return `${dLabel(a)} · ${tLabel(a)} – ${tLabel(b)} PT`;
}

// Pacific calendar day (YYYY-MM-DD) for grouping/filtering events.
export function ptDayKey(iso?: string | null, timeNotListed?: boolean | null): string {
  if (!iso) return "";
  const f = noTime(iso, timeNotListed) ? dateFields(iso) : ptFields(iso);
  return `${f.y}-${String(f.mo + 1).padStart(2, "0")}-${String(f.d).padStart(2, "0")}`;
}

// Month/day for the compact date badge, in PT.
export function fmtBadge(iso?: string | null, timeNotListed?: boolean | null): { month: string; day: string } {
  if (!iso) return { month: "—", day: "" };
  const f = noTime(iso, timeNotListed) ? dateFields(iso) : ptFields(iso);
  return { month: MON[f.mo].toUpperCase(), day: String(f.d) };
}

// A creator-typed Pacific wall-clock -> UTC ISO (two-pass for DST). Empty time = date-only (no time).
export function ptInputToISO(dateStr: string, timeStr?: string | null): string {
  if (!dateStr) return "";
  if (!timeStr) return dateStr;
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  let utc = guess - pacificOffsetMinutes(guess) * 60000;
  utc = guess - pacificOffsetMinutes(utc) * 60000;
  return new Date(utc).toISOString();
}
export function isoToPTDate(iso?: string | null): string {
  if (!iso) return "";
  const f = noTime(iso) ? dateFields(iso) : ptFields(iso);
  return `${f.y}-${String(f.mo + 1).padStart(2, "0")}-${String(f.d).padStart(2, "0")}`;
}
export function isoToPTTime(iso?: string | null): string {
  if (!iso || noTime(iso)) return "";
  const f = ptFields(iso);
  return `${String(f.h).padStart(2, "0")}:${String(f.mi).padStart(2, "0")}`;
}

export function fmtTimeAgo(iso?: string | null): string {
  if (!iso) return "";
  const d = dayjs(iso);
  if (!d.isValid()) return "";
  const diff = dayjs().diff(d, "minute");
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.format("MMM D");
}

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  sailor: "Sailor",
  boat_owner: "Boat Owner",
  boat_pro: "Boat Pro",
  partner: "Community Partner",
};

export function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}


export function fmtPhone(v?: string | null): string {
  const d = (v || "").replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}
