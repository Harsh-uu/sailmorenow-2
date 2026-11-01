import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "react-router-dom";
import Avatar from "@/components/Avatar";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

function Banner({ signedOut }) {
  return (
    <div className="grid lg:grid-cols-2 gap-6 lg:gap-8 items-center mb-8" data-testid="crew-video-banner">
      <div className="relative rounded-3xl overflow-hidden shadow-xl ring-1 ring-slate-200 dark:ring-slate-700 aspect-[16/9]">
        <img src="/crew-poster.jpg" alt="" aria-hidden="true"
             className="absolute inset-0 w-full h-full object-cover hero-kenburns" />
        <video
          data-testid="crew-video"
          className="relative w-full h-full object-cover"
          autoPlay muted loop playsInline preload="metadata"
          poster="/crew-poster.jpg" aria-hidden="true"
          onLoadedMetadata={(e) => { e.currentTarget.muted = true; }}
        >
          <source src="/crew-loop.webm" type="video/webm" />
          <source src="/crew-loop.mp4" type="video/mp4" />
        </video>
        <div aria-hidden="true" className="absolute inset-0 hero-vignette pointer-events-none" />
      </div>
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.28em] text-[#2A7871] dark:text-[#7fcac4] flex items-center gap-2">
          <Icon name="crew" tone="current" className="h-3.5 w-3.5" /> Available crew this week
        </div>
        <h2 className="font-display font-extrabold smn-heading text-3xl sm:text-4xl mt-2 tracking-tight">Sailors ready to hop on a boat.</h2>
        {signedOut
          ? <Link to="/register" data-testid="crew-signup-cta" className="mt-5 inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2.5 text-sm font-semibold">
              Create a free account <Icon name="arrow-right" tone="current" className="h-4 w-4" />
            </Link>
          : <Link to="/crew-bank" data-testid="crew-see-all" className="mt-5 inline-flex items-center gap-1.5 bg-[#1F3F5B] hover:bg-[#152a3d] text-white rounded-full px-5 py-2.5 text-sm font-semibold">
              See all crew <Icon name="arrow-right" tone="current" className="h-4 w-4" />
            </Link>}
      </div>
    </div>
  );
}

export default function OpenCrewSlots({ wrap = (n) => n }) {
  const { user } = useAuth();
  const [slots, setSlots] = useState([]);
  useEffect(() => {
    if (!user) return; // crew pool is members-only; skip the fetch for signed-out visitors
    api.get("/crew-bank/open", { params: { days: 14, limit: 8 } }).then(({ data }) => setSlots(data)).catch(() => {});
  }, [user]);

  // Signed-out visitors on the public landing page: keep the marketing banner and
  // invite them to sign up instead of exposing sailors' names and profiles.
  if (!user) {
    return wrap(
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4" data-testid="open-crew-slots">
        <Banner signedOut />
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 p-8 text-center" data-testid="open-crew-signup-prompt">
          <p className="text-slate-600 dark:text-slate-300">Create a free account to see the sailors available this week and to reach out.</p>
          <Link to="/register" data-testid="open-crew-signup-btn" className="mt-4 inline-flex items-center justify-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2.5 text-sm font-semibold">
            <Icon name="user-plus" tone="current" className="h-4 w-4" /> Create an account
          </Link>
        </div>
      </section>
    );
  }

  if (slots.length === 0) return null;
  return wrap(
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4" data-testid="open-crew-slots">
      <Banner />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {slots.map((s) => (
          <article key={`${s.event_id}-${s.user_id}`} className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all"
                   data-testid={`open-slot-${s.event_id}-${s.user_id}`}>
            <div className="flex items-center gap-3">
              <Avatar src={s.user_avatar} className="h-10 w-10" alt={s.user_name || ""} />
              <div className="min-w-0">
                {s.user_handle
                  ? <Link to={`/u/${s.user_handle}`} data-testid={`open-slot-profile-${s.user_id}`} className="font-semibold smn-heading leading-tight truncate block hover:underline">{s.user_name}</Link>
                  : <div className="font-semibold smn-heading leading-tight truncate">{s.user_name}</div>}
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{s.user_market}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {(s.positions || []).slice(0, 4).map((p) => <span key={p} className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">{p}</span>)}
            </div>
            <div className="mt-3 text-xs text-slate-600 dark:text-slate-300 line-clamp-2 min-h-[2rem]">{s.experience || s.notes || "Available. DM to connect."}</div>
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1"><Icon name="events" tone="current" className="h-3.5 w-3.5" /> {s.event_title}</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{(s.event_starts_at || "").slice(0, 10)} · {s.event_market}</div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
