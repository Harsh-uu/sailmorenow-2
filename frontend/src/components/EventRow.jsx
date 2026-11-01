import { useState } from "react";
import { Icon } from "@/components/Icon";
import CrewBankModal from "@/components/CrewBankModal";
import AddToCalendar from "@/components/AddToCalendar";
import { categoryMeta, formatEventDate, eventBadge, eventTitleParts } from "@/lib/eventCategories";
import { eventHasCrewBank } from "@/lib/events";

export default function EventRow({ event, onOpen, onChanged }) {
  const [crewOpen, setCrewOpen] = useState(false);
  const cat = categoryMeta(event.category);
  const CatIcon = cat.icon;
  const badge = eventBadge(event.starts_at, event.time_not_listed);
  const { title: displayTitle, tentative } = eventTitleParts(event.title);

  return (
    <article className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow flex flex-wrap sm:flex-nowrap items-stretch gap-3 sm:gap-4 p-3 sm:p-4 min-w-0 overflow-hidden" data-testid={`event-${event.id}`}>
      <div className="shrink-0 w-14 rounded-lg bg-[#1F3F5B] text-white flex flex-col items-center justify-center leading-none py-2">
        <span className="text-[10px] uppercase tracking-widest font-bold text-[#7fcac4]">{badge.month}</span>
        <span className="font-display font-extrabold text-2xl mt-0.5">{badge.day}</span>
      </div>
      <div className="flex-1 min-w-0 basis-[calc(100%-4.5rem)] sm:basis-auto">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${cat.cls}`} data-testid={`event-cat-${event.id}`}><CatIcon className="h-3 w-3" /> {cat.label}</span>
          {event.source === "aggregator" && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 truncate max-w-[180px]">via {event.source_label?.replace(/^48° North /, "").replace(/^Oregon /, "")}</span>}
          {event.series_id && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300" data-testid={`series-chip-${event.id}`}>Series #{event.series_index}/{event.series_total}</span>}
          {tentative && <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#F2A03B]/15 text-[#b86f1a] dark:text-[#F2A03B]" data-testid={`event-tentative-${event.id}`}>Tentative</span>}
        </div>
        <h3 className="font-display font-bold smn-heading text-base sm:text-lg leading-tight mt-1 truncate">{displayTitle}</h3>
        <div className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
          <span>{formatEventDate(event.starts_at, event.time_not_listed)}</span>
          <span className="inline-flex items-center gap-1 truncate"><Icon name="location" tone="current" className="h-3.5 w-3.5 shrink-0" /> {[event.location, event.market].filter(Boolean).join(" · ")}</span>
        </div>
      </div>
      <div className="shrink-0 w-full sm:w-auto flex flex-row xl:flex-row items-center justify-end gap-2">
        <AddToCalendar event={event} compact />
        {eventHasCrewBank(event) && (
          <button onClick={() => setCrewOpen(true)} data-testid={`crewbank-btn-${event.id}`}
            className="inline-flex items-center gap-1.5 rounded-full border-2 border-[#55B3AD] text-[#1F3F5B] dark:text-white px-3 py-1.5 hover:bg-[#55B3AD] hover:text-white font-bold text-xs uppercase tracking-wider">
            <Icon name="crew" tone="current" className="h-4 w-4" /> Crew Bank
            {event.crew_count > 0 && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[#F2A03B] text-white text-[10px] px-1">{event.crew_count}</span>}
          </button>
        )}
        <button onClick={() => onOpen(event)} data-testid={`learn-more-${event.id}`}
          className="inline-flex items-center gap-1 rounded-full bg-[#F2A03B] hover:bg-[#d98c30] text-white px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-semibold">
          Learn more <Icon name="chevron-right" tone="current" className="h-4 w-4" />
        </button>
      </div>
      <CrewBankModal event={event} open={crewOpen} onClose={() => setCrewOpen(false)} onChanged={onChanged} />
    </article>
  );
}
