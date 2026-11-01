import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/Icon";
import { googleCalendarUrl, downloadIcs } from "@/lib/calendarLinks";

export default function AddToCalendar({ event, compact = false }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button data-testid={`add-to-calendar-${event.id}`} title="Add to my calendar"
          className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-200 hover:border-[#55B3AD] hover:text-[#1F3F5B] dark:hover:text-white font-semibold ${compact ? "p-2" : "px-3 py-1.5 text-xs"}`}>
          <Icon name="calendar-plus" tone="current" className="h-4 w-4" />{!compact && <span>Add to calendar</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[200]">
        <DropdownMenuItem asChild>
          <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer" data-testid={`gcal-${event.id}`} className="flex items-center gap-2 cursor-pointer">
            <Icon name="external-link" tone="current" className="h-4 w-4" /> Google Calendar
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => downloadIcs(event)} data-testid={`ics-${event.id}`} className="flex items-center gap-2 cursor-pointer">
          <Icon name="download" tone="current" className="h-4 w-4" /> Download .ics (Apple / Outlook)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
