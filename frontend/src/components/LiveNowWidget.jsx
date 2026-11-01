import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";

/**
 * Live-community ticker for the landing hero. Pulls three parallel counts
 * (open crew slots this week, live forum threads, upcoming events) and
 * renders a compact horizontally-scrolling strip with a friendly summary
 * for each. Falls back to skeleton chips while loading and collapses when
 * every count is zero so a brand-new deployment doesn't advertise "0 of
 * everything" — that would kill the "community is active" signal.
 */
export default function LiveNowWidget() {
  const [state, setState] = useState({ loading: true, crew: 0, forum: 0, events: 0 });
  useEffect(() => {
    Promise.allSettled([
      api.get("/stats/public"),
      api.get("/discussions", { params: { kind: "forum", limit: 50 } }),
      api.get("/events", { params: { limit: 50, category: "racing" } }),
    ]).then(([stats, forum, events]) => {
      const size = (r) => {
        if (r.status !== "fulfilled") return 0;
        const d = r.value?.data;
        return Array.isArray(d) ? d.length : (d?.events?.length || d?.discussions?.length || 0);
      };
      const crew = stats.status === "fulfilled" ? (stats.value?.data?.sailors_seeking_crew || 0) : 0;
      setState({ loading: false, crew, forum: size(forum), events: size(events) });
    });
  }, []);

  const { loading, crew, forum, events } = state;
  if (!loading && crew + forum + events === 0) return null;
  const chips = [
    { icon: "crew", label: `${crew} sailor${crew === 1 ? "" : "s"} looking for crew`, to: "/crew-bank", tint: "text-[#F2A03B]" },
    { icon: "messages-square", label: `${forum} forum thread${forum === 1 ? "" : "s"} active`, to: "/community-hub", tint: "text-[#55B3AD]" },
    { icon: "events", label: `${events} upcoming race${events === 1 ? "" : "s"} on the calendar`, to: "/events?category=racing", tint: "text-[#55B3AD]" },
  ];
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-4 sm:-mt-6 relative z-10" data-testid="live-now-widget">
      <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur rounded-2xl lg:rounded-full border border-slate-200 dark:border-slate-700 shadow-lg">
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 text-sm">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.2em] text-red-600 dark:text-red-400 mr-1 sm:mr-2 shrink-0 w-full lg:w-auto">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /> Live
          </span>
          {chips.map(({ icon, label, to, tint }, i) => (
            <Link key={i} to={to} data-testid={`live-now-chip-${i}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 shrink-0 max-w-full">
              <Icon name={icon} tone="current" className={`h-3.5 w-3.5 ${tint}`} />
              <span className="font-medium">{loading ? "…" : label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
