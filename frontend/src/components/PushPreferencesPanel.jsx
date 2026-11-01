import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";

const LABELS = {
  dm: "Direct messages", review_request: "Review requests", review_completed: "Review reveals",
  review_withdrawn: "Reviews withdrawn", review_reply: "Replies to your review",
  comment: "Comments on your posts", mention: "You're @mentioned", crew_join: "Crew signups on your events",
  blog_approved: "Your blog approved", event_reminder: "Event reminders (RSVPs & Crew Bank)",
  review_nudge: "\"Leave a review\" reminders",
};
const TIMINGS = [
  { key: "morning_of", label: "Day of" },
  { key: "day_before", label: "Day before" },
  { key: "both", label: "Both" },
];

export default function PushPreferencesPanel({ testId = "push-preferences" }) {
  const [prefs, setPrefs] = useState(null);
  const [kinds, setKinds] = useState([]);
  const [timing, setTiming] = useState("morning_of");
  const [hour, setHour] = useState(7);
  useEffect(() => {
    api.get("/push/preferences").then(({ data }) => {
      setKinds(data.kinds || []); setPrefs(data.preferences || {}); setTiming(data.reminder_timing || "morning_of"); setHour(data.reminder_hour ?? 7);
    }).catch(() => {});
  }, []);
  const save = async (nextPrefs, nextTiming, nextHour = hour) => {
    try { await api.patch("/push/preferences", { preferences: nextPrefs, reminder_timing: nextTiming, reminder_hour: nextHour }); }
    catch { toast.error("Failed to save"); }
  };
  const changeHour = (h) => { setHour(h); save(prefs, timing, h); toast.success("Reminder time saved"); };
  const toggle = (k) => { const next = { ...prefs, [k]: !prefs[k] }; setPrefs(next); save(next, timing); };
  const changeTiming = (t) => { setTiming(t); save(prefs, t); toast.success("Reminder timing saved"); };
  if (!prefs) return null;
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Notify me about</div>
      {kinds.map((k) => (
        <label key={k} className="flex items-center justify-between gap-2 text-sm cursor-pointer">
          <span className="text-slate-700 dark:text-slate-200">{LABELS[k] || k}</span>
          <input type="checkbox" data-testid={`pref-${k}`} checked={!!prefs[k]} onChange={() => toggle(k)} />
        </label>
      ))}
      {prefs.event_reminder !== false && (
        <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-700" data-testid="reminder-timing">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Remind me</div>
          <div className="flex flex-wrap gap-1.5">
            {TIMINGS.map((t) => (
              <button key={t.key} type="button" onClick={() => changeTiming(t.key)} data-testid={`reminder-timing-${t.key}`}
                className={`rounded-full px-3 py-1 text-xs font-semibold border ${timing === t.key ? "bg-[#1F3F5B] text-white border-[#1F3F5B]" : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-[#55B3AD]"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-semibold">at</span>
            <select value={hour} onChange={(e) => changeHour(Number(e.target.value))} data-testid="reminder-hour" className="rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1 text-xs font-semibold">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h === 0 ? "12:00 AM" : h < 12 ? `${h}:00 AM` : h === 12 ? "12:00 PM" : `${h - 12}:00 PM`}</option>)}
            </select>
            <span className="text-slate-400">Pacific time</span>
          </div>
        </div>
      )}
    </div>
  );
}
