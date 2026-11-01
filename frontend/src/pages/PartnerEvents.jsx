import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import Avatar from "@/components/Avatar";
import WaveDivider from "@/components/WaveDivider";
import EventRow from "@/components/EventRow";
import EventDetailModal from "@/components/EventDetailModal";
import { toast } from "sonner";

// Public, linkable page: /partners/:handle — a partner's upcoming events.
export default function PartnerEvents() {
  const { handle } = useParams();
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [active, setActive] = useState(null);
  const load = () => api.get(`/partners/${encodeURIComponent((handle || "").replace(/^@/, ""))}/events`).then(({ data }) => setData(data)).catch(() => setNotFound(true));
  useEffect(() => { load(); }, [handle]); // eslint-disable-line react-hooks/exhaustive-deps

  if (notFound) return <div className="max-w-3xl mx-auto px-4 py-20 text-center text-slate-500" data-testid="partner-notfound">No organizer found for @{handle}.</div>;
  if (!data) return <div className="max-w-3xl mx-auto px-4 py-20 text-center text-slate-500">Loading…</div>;
  const { organizer: o, events } = data;
  const copy = () => { navigator.clipboard?.writeText(window.location.href); toast.success("Link copied — paste it on your website or newsletter"); };

  return (
    <div className="bg-[var(--smn-bg)] dark:bg-slate-950" data-testid="partner-events-page">
      <section className="smn-hero text-white -mt-16 pt-24 pb-14 relative overflow-hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-5 flex-wrap">
          <Avatar src={o.picture || o.avatar} className="h-20 w-20 ring-4 ring-white/20" alt={o.name ? `${o.name} logo` : ""} fallback={<Icon name="profile" tone="current" className="h-8 w-8" />} />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#55B3AD]">Upcoming events hosted by</div>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight truncate" data-testid="partner-name">{o.name}</h1>
            <div className="text-slate-300 text-sm mt-1 flex items-center gap-3 flex-wrap">
              <Link to={`/u/${o.handle}`} className="font-mono hover:text-white" data-testid="partner-handle">@{o.handle}</Link>
              {o.primary_market && <span>· {o.primary_market}</span>}
              <span className="inline-flex items-center gap-1" data-testid="partner-count"><Icon name="events" tone="current" className="h-3.5 w-3.5" /> {events.length} upcoming</span>
            </div>
          </div>
          <button onClick={copy} data-testid="partner-copy-link" style={{ color: "#1F3F5B" }} className="inline-flex items-center gap-1.5 bg-white/95 hover:bg-white rounded-full px-4 py-2 text-sm font-semibold"><Icon name="link" tone="current" className="h-4 w-4" /> Copy page link</button>
        </div>
        <WaveDivider flip className="absolute inset-x-0 bottom-0 text-[var(--smn-bg)] dark:text-slate-950" />
      </section>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {o.bio && <p className="text-slate-600 dark:text-slate-300 mb-6">{o.bio}</p>}
        <div className="space-y-3" data-testid="partner-events-list">
          {events.length === 0 ? (
            <div className="text-slate-500 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center" data-testid="partner-events-empty">No upcoming events right now — check back soon.</div>
          ) : events.map((e) => <EventRow key={e.id} event={e} onOpen={setActive} onChanged={load} />)}
        </div>
        <div className="mt-10 text-center text-sm text-slate-500">
          Powered by <Link to="/" className="font-semibold text-[#1F3F5B] dark:text-slate-100 hover:text-[#F2A03B]">Sail More Now</Link> · <Link to="/events" className="hover:text-[#F2A03B]">See all PNW events</Link>
        </div>
      </div>
      <EventDetailModal event={active} open={!!active} onClose={() => setActive(null)} onChanged={load} />
    </div>
  );
}
