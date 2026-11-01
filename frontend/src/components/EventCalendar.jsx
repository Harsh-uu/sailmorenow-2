import { useMemo } from "react";
import { Calendar } from "@/components/ui/calendar";
import { eventDayKey, dayKey } from "@/lib/eventCategories";

export default function EventCalendar({ events, selected, onSelect }) {
  const counts = useMemo(() => {
    const m = {};
    for (const e of events) { const k = eventDayKey(e.starts_at, e.time_not_listed); if (k) m[k] = (m[k] || 0) + 1; }
    return m;
  }, [events]);
  const hasEvents = (d) => !!counts[dayKey(d)];

  return (
    <div className="smn-card rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-2 sm:p-4" data-testid="event-calendar">
      <Calendar
        mode="single"
        selected={selected}
        onSelect={(d) => onSelect(d && selected && dayKey(d) === dayKey(selected) ? null : d)}
        modifiers={{ hasEvents }}
        modifiersClassNames={{ hasEvents: "smn-cal-has-events" }}
        className="p-0 w-full"
        classNames={{
          months: "w-full", month: "w-full space-y-3", table: "w-full border-collapse table-fixed",
          head_row: "grid grid-cols-7 w-full", head_cell: "text-[11px] uppercase tracking-wider font-bold text-slate-400",
          row: "grid grid-cols-7 w-full mt-1", cell: "p-0 text-center min-w-0",
          caption_label: "font-display font-bold smn-heading text-base",
          day: "h-10 w-full rounded-lg text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-700 relative",
          day_selected: "!bg-[#1F3F5B] !text-white hover:!bg-[#1F3F5B]",
          day_today: "ring-1 ring-[#55B3AD]",
          day_outside: "text-slate-300 dark:text-slate-600",
        }}
        components={{
          DayContent: ({ date }) => {
            const n = counts[dayKey(date)];
            return (
              <span className="flex flex-col items-center justify-center leading-none">
                <span>{date.getDate()}</span>
                {n ? <span className="mt-1 flex gap-0.5">{Array.from({ length: Math.min(n, 3) }).map((_, i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-[#F2A03B]" />)}</span> : <span className="mt-1 h-1.5" />}
              </span>
            );
          },
        }}
      />
    </div>
  );
}
