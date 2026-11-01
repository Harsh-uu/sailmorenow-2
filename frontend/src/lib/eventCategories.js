import { Flag, Anchor, GraduationCap, HandHeart, CircleDashed } from "lucide-react";

export const EVENT_CATEGORIES = [
  { key: "racing", label: "Racing", icon: Flag, cls: "bg-[#F2A03B]/15 text-[#b86f1a] dark:text-[#F2A03B]" },
  { key: "cruising", label: "Cruising", icon: Anchor, cls: "bg-[#55B3AD]/15 text-[#2A7871] dark:text-[#7fcac4]" },
  { key: "social", label: "Social", icon: Anchor, cls: "bg-[#55B3AD]/15 text-[#2A7871] dark:text-[#7fcac4]" },
  { key: "education", label: "Education", icon: GraduationCap, cls: "bg-blue-100 dark:bg-blue-900/40 text-[#1F3F5B] dark:text-blue-200" },
  { key: "volunteering", label: "Volunteering", icon: HandHeart, cls: "bg-orange-100 dark:bg-orange-900/40 text-[#d98c30]" },
  { key: "other", label: "Other", icon: CircleDashed, cls: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300" },
];

export const categoryMeta = (key) => EVENT_CATEGORIES.find((c) => c.key === key) || EVENT_CATEGORIES[5];

// All event times are shown in Pacific time (America/Los_Angeles, DST-aware) with a "PT" label.
const PT = "America/Los_Angeles";

// "No time" prefers the explicit stored flag; falls back to the legacy
// midnight-UTC sentinel only when the flag is absent (older rows).
const noTimeWeb = (s, flag) => (typeof flag === "boolean" ? flag : (!s || s.length <= 10 || s.endsWith("T00:00:00+00:00")));

// "[Draft] Foo" -> { title: "Foo", tentative: true }. Derived from the LIVE title
// so the Tentative label disappears automatically when the source drops "[Draft]".
export function eventTitleParts(title) {
  const t = (title || "").trim();
  const m = /^\[\s*draft\s*\]\s*/i.exec(t);
  return { title: m ? t.slice(m[0].length) : t, tentative: !!m };
}

function ptDateLabel(s) {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

export function formatEventDate(startsAt, timeNotListed) {
  if (!startsAt) return "";
  if (noTimeWeb(startsAt, timeNotListed)) return `${ptDateLabel(startsAt)} · Time not listed, see details`;
  return new Date(startsAt).toLocaleString("en-US", { timeZone: PT, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT";
}

// Full "when" line including an optional end (time range for timed, date range for date-only).
export function formatEventWhen(startsAt, endsAt, timeNotListed) {
  if (!startsAt) return "";
  if (noTimeWeb(startsAt, timeNotListed)) {
    if (endsAt && noTimeWeb(endsAt) && endsAt.slice(0, 10) !== startsAt.slice(0, 10)) {
      const [ey, em, ed] = endsAt.slice(0, 10).split("-").map(Number);
      const endShort = new Date(Date.UTC(ey, (em || 1) - 1, ed || 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
      return `${ptDateLabel(startsAt)} to ${endShort}`;
    }
    return `${ptDateLabel(startsAt)} · Time not listed, see details`;
  }
  const f = new Date(startsAt).toLocaleString("en-US", { timeZone: PT, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (endsAt && !noTimeWeb(endsAt)) {
    const e = new Date(endsAt).toLocaleTimeString("en-US", { timeZone: PT, hour: "numeric", minute: "2-digit" });
    return `${f} – ${e} PT`;
  }
  return `${f} PT`;
}

// Just the time portion in PT (used for an event's end time).
export function formatEventTimePT(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: PT, hour: "numeric", minute: "2-digit" }) + " PT";
}

// Month + day for the compact date badge, in PT.
export function eventBadge(startsAt, timeNotListed) {
  if (!startsAt) return { month: "", day: "" };
  if (noTimeWeb(startsAt, timeNotListed)) {
    const [y, m, d] = startsAt.slice(0, 10).split("-").map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    return { month: dt.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" }), day: String(d) };
  }
  const dt = new Date(startsAt);
  return {
    month: dt.toLocaleDateString("en-US", { timeZone: PT, month: "short" }),
    day: dt.toLocaleDateString("en-US", { timeZone: PT, day: "numeric" }),
  };
}

// Pacific calendar day (YYYY-MM-DD) for an event; all-day events use their stored date.
export function eventDayKey(startsAt, timeNotListed) {
  if (!startsAt) return "";
  if (noTimeWeb(startsAt, timeNotListed)) return startsAt.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: PT, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(startsAt));
}

export const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// A datetime-local value typed by the creator is interpreted as Pacific; convert to a UTC ISO for storage.
export function ptInputToISO(localStr) {
  if (!localStr) return "";
  const [datePart, timePart] = localStr.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = (timePart || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offAt = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: PT, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  let utc = guess - offAt(guess);
  utc = guess - offAt(utc);
  return new Date(utc).toISOString();
}

// A stored UTC ISO rendered back into a datetime-local field as Pacific wall-clock.
export function isoToPTInput(iso) {
  if (!iso) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: PT, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
