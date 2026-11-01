import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { canInteract, promptUpgrade } from "@/lib/plan";
import { toast } from "sonner";
import { categoryMeta, formatEventDate, eventTitleParts } from "@/lib/eventCategories";
import { eventHasCrewBank } from "@/lib/events";
import EventBlast from "@/components/EventBlast";

export default function MyEvents() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [events, setEvents] = useState(null);
  const [tab, setTab] = useState("upcoming");
  const [rosterId, setRosterId] = useState(null);
  const [roster, setRoster] = useState({});
  const load = () => api.get("/events/mine").then(({ data }) => setEvents(data)).catch(() => setEvents([]));
  useEffect(() => { if (user) load(); }, [user]);

  const openRoster = async (eid) => {
    setRosterId(eid);
    if (!roster[eid]) {
      try {
        const { data } = await api.get(`/events/${eid}/registrations`);
        setRoster((r) => ({ ...r, [eid]: data.registrations || [] }));
      } catch { setRoster((r) => ({ ...r, [eid]: [] })); }
    }
  };

  // Deep link from an "event_rsvp" notification: /my-events?event=<id>&roster=<kind>
  // auto-opens that event's roster for the host. Switches to the right tab if the
  // event is in the past.
  useEffect(() => {
    const eid = params.get("event");
    if (!eid || !events) return;
    const target = events.find((e) => e.id === eid);
    if (!target) return;
    setTab(target.is_past ? "past" : "upcoming");
    openRoster(eid);
    const el = document.querySelector(`[data-testid="my-event-${eid}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, params]);

  const toggleRoster = async (e) => {
    if (rosterId === e.id) { setRosterId(null); return; }
    openRoster(e.id);
  };

  const visible = useMemo(() => (events || []).filter((e) => tab === "past" ? e.is_past : !e.is_past), [events, tab]);
  const totals = useMemo(() => (events || []).filter((e) => !e.is_past).reduce((a, e) => ({
    events: a.events + 1, rsvps: a.rsvps + (e.registrations?.attendee || 0), vols: a.vols + (e.registrations?.volunteer || 0), crew: a.crew + (e.crew_count || 0),
  }), { events: 0, rsvps: 0, vols: 0, crew: 0 }), [events]);

  const csv = async (e) => {
    try {
      const { data } = await api.get(`/events/${e.id}/attendees.csv`, { responseType: "blob" });
      const url = URL.createObjectURL(data); const a = document.createElement("a");
      a.href = url; a.download = `${e.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-attendees.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { toast.error("Couldn't export"); }
  };
  const cancel = async (e) => {
    if (!window.confirm(`Cancel "${e.title}"? Everyone signed up will be notified.`)) return;
    try { await api.delete(`/events/${e.id}`); toast.success("Cancelled"); load(); } catch (err) { toast.error(errMsg(err, "Failed")); }
  };

  if (!user) return <div className="max-w-4xl mx-auto px-4 py-16 text-center text-slate-500" data-testid="my-events-signin">Sign in to manage your events.</div>;

  const canPost = user && (user.account_type === "partner" || user.account_type === "boat_pro" || user.platform_role === "admin");

  const Stat = ({ icon, label, value, testId }) => (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 px-4 py-3 flex items-center gap-3" data-testid={testId}>
      <span className="h-9 w-9 rounded-full bg-[#55B3AD]/15 text-[#2A7871] dark:text-[#7fcac4] flex items-center justify-center"><Icon name={icon} tone="current" className="h-4 w-4" /></span>
      <div><div className="font-display font-extrabold text-2xl smn-heading leading-none">{value}</div><div className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mt-1">{label}</div></div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="my-events-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#55B3AD]">Organizer dashboard</div>
          <h1 className="font-display font-extrabold smn-heading text-3xl sm:text-4xl mt-1">Your events at a glance.</h1>
        </div>
        {canPost && <Link to="/events?post=1" data-testid="my-events-new" className="inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2.5 font-semibold"><Icon name="add" tone="current" className="h-4 w-4" /> Post event</Link>}
      </div>
      {user.handle && (
        <div className="mt-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 px-4 py-3 flex items-center justify-between gap-3 flex-wrap text-sm" data-testid="public-page-card">
          <div className="text-slate-600 dark:text-slate-300 min-w-0 break-words"><b className="smn-heading">Your public events page:</b> <Link to={`/partners/${user.handle}`} className="font-mono text-[#1F3F5B] dark:text-slate-100 hover:text-[#F2A03B] break-all" data-testid="public-page-link">/partners/{user.handle}</Link> — link it from your website or newsletter.</div>
          <button onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/partners/${user.handle}`); toast.success("Link copied"); }} data-testid="public-page-copy" className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-3 py-1 text-xs font-semibold hover:border-[#55B3AD]"><Icon name="link" tone="current" className="h-3.5 w-3.5" /> Copy</button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="events" label="Upcoming events" value={totals.events} testId="stat-events" />
        <Stat icon="crew" label="RSVPs" value={totals.rsvps} testId="stat-rsvps" />
        <Stat icon="hand-heart" label="Volunteers" value={totals.vols} testId="stat-volunteers" />
        <Stat icon="crew" label="Crew signups" value={totals.crew} testId="stat-crew" />
      </div>

      <div className="mt-8 inline-flex rounded-full border border-slate-200 dark:border-slate-600 p-0.5 bg-white dark:bg-slate-800">
        {["upcoming", "past"].map((t) => (
          <button key={t} onClick={() => setTab(t)} data-testid={`tab-${t}`} className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize ${tab === t ? "bg-[#1F3F5B] text-white" : "text-slate-600 dark:text-slate-300"}`}>{t}</button>
        ))}
      </div>

      <div className="mt-4 space-y-3" data-testid="my-events-list">
        {events === null ? <div className="text-slate-500">Loading…</div> : visible.length === 0 ? (
          <div className="text-slate-500 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center" data-testid="my-events-empty">
            {tab === "upcoming" ? "No upcoming events yet — post your first one." : "No past events in the last 90 days."}
          </div>
        ) : visible.map((e) => {
          const cat = categoryMeta(e.category); const CatIcon = cat.icon;
          return (
            <article key={e.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm p-4" data-testid={`my-event-${e.id}`}>
              <div className={rosterId === e.id ? "lg:flex lg:items-start lg:gap-6" : ""}>
                <div className={`min-w-0 space-y-3 ${rosterId === e.id ? "lg:flex-1 lg:min-w-[320px]" : ""}`}>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${cat.cls}`}><CatIcon className="h-3 w-3" /> {cat.label}</span>
                      {e.series_id && <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300"><Icon name="repeat" tone="current" className="h-3 w-3" /> #{e.series_index}/{e.series_total}</span>}
                      {eventTitleParts(e.title).tentative && <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#F2A03B]/15 text-[#b86f1a] dark:text-[#F2A03B]">Tentative</span>}
                    </div>
                    <h3 className="font-display font-bold smn-heading text-lg leading-tight mt-1 truncate">{eventTitleParts(e.title).title}</h3>
                    <div className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
                      <span className="whitespace-nowrap">{formatEventDate(e.starts_at, e.time_not_listed)}</span>
                      <span className="inline-flex items-center gap-1 min-w-0"><Icon name="location" tone="current" className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{[e.location, e.market].filter(Boolean).join(" · ")}</span></span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="flex items-center gap-4 text-sm flex-wrap" data-testid={`counts-${e.id}`}>
                      {e.source === "aggregator" && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#55B3AD]/15 text-[#2A7871] dark:text-[#7fcac4]" data-testid={`imported-tag-${e.id}`}><Icon name="download" tone="current" className="h-3 w-3" /> Imported</span>}
                      <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-200" title="RSVPs"><Icon name="crew" tone="current" className="h-4 w-4 text-[#55B3AD]" /> <b>{e.registrations?.attendee || 0}</b></span>
                      {(e.is_volunteer || e.registrations?.volunteer > 0) && <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-200" title="Volunteers"><Icon name="hand-heart" tone="current" className="h-4 w-4 text-[#F2A03B]" /> <b>{e.registrations?.volunteer || 0}</b></span>}
                      {eventHasCrewBank(e) && <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-200" title="Crew signups (found)"><Icon name="crew" tone="current" className="h-4 w-4 text-[#1F3F5B] dark:text-white" /> <b>{e.crew_count || 0}</b>{e.crew_found > 0 && <span className="text-xs text-slate-400">({e.crew_found} placed)</span>}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <button onClick={() => toggleRoster(e)} title="View roster" data-testid={`roster-toggle-${e.id}`} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${rosterId === e.id ? "border-[#55B3AD] text-[#2A7871]" : "border-slate-200 dark:border-slate-600 hover:border-[#55B3AD]"}`}><Icon name="crew" tone="current" className="h-3.5 w-3.5" /> Roster</button>
                      <button onClick={() => csv(e)} title="Check-in CSV" data-testid={`csv-${e.id}`} className="p-2 rounded-full border border-slate-200 dark:border-slate-600 hover:border-[#55B3AD]"><Icon name="download" tone="current" className="h-4 w-4" /></button>
                      {e.source !== "aggregator" && <>
                        <button onClick={() => nav(`/events?edit=${e.id}`)} title="Edit" data-testid={`edit-${e.id}`} className="p-2 rounded-full border border-slate-200 dark:border-slate-600 hover:border-[#55B3AD]"><Icon name="edit" tone="current" className="h-4 w-4" /></button>
                        <button onClick={() => nav(`/events?duplicate=${e.id}`)} title="Post again" data-testid={`duplicate-${e.id}`} className="p-2 rounded-full border border-slate-200 dark:border-slate-600 hover:border-[#55B3AD]"><Icon name="copy" tone="current" className="h-4 w-4" /></button>
                        {!e.is_past && <button onClick={() => cancel(e)} title="Cancel event" data-testid={`cancel-${e.id}`} className="p-2 rounded-full border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"><Icon name="delete" tone="current" className="h-4 w-4" /></button>}
                      </>}
                    </div>
                  </div>
                </div>
                {rosterId === e.id && (
                  <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 lg:mt-0 lg:pt-0 lg:border-t-0 lg:border-l lg:pl-6 lg:flex-1 lg:max-w-[460px] lg:min-w-0" data-testid={`roster-panel-${e.id}`}>
                    <RosterPanel event={e} regs={roster[e.id]} user={user} />
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}


function RosterMessageButton({ person, user }) {
  const label = (
    <span className="inline-flex items-center gap-1"><Icon name="mail" tone="current" className="h-3.5 w-3.5" /> Message</span>
  );
  const cls = "shrink-0 inline-flex items-center rounded-full border-2 border-[#1F3F5B] text-[#1F3F5B] dark:text-white dark:border-white px-3 py-1 text-xs font-bold uppercase tracking-wider hover:bg-[#1F3F5B] hover:text-white";
  if (canInteract(user)) {
    return <Link to={`/messages?to=${person.user_id}`} data-testid={`roster-message-${person.user_id}`} className={cls}>{label}</Link>;
  }
  return (
    <button type="button" data-testid={`roster-message-${person.user_id}`} className={cls}
      onClick={() => promptUpgrade("Upgrade to message volunteers and attendees directly.")}>{label}</button>
  );
}

function RosterGroup({ title, icon, color, people, user }) {
  if (!people.length) return null;
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5"><Icon name={icon} tone="current" className={`h-3.5 w-3.5 ${color}`} /> {title} ({people.length})</div>
      <ul className="space-y-2.5">
        {people.map((p) => (
          <li key={p.id || p.user_id} className="flex items-start justify-between gap-3 text-sm max-w-md" data-testid={`roster-person-${p.user_id}`}>
            <div className="min-w-0">
              {p.user_handle ? (
                <Link to={`/u/${p.user_handle}`} data-testid={`roster-profile-${p.user_id}`} className="font-semibold text-[#1F3F5B] dark:text-slate-100 hover:text-[#F2A03B] truncate block">{p.user_name || "Sailor"}</Link>
              ) : (
                <span className="font-semibold text-slate-700 dark:text-slate-200 truncate block">{p.user_name || "Sailor"}</span>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                {p.user_email && <a href={`mailto:${p.user_email}`} data-testid={`roster-email-${p.user_id}`} className="inline-flex items-center gap-1 hover:underline"><Icon name="mail" tone="current" className="h-3 w-3" /> {p.user_email}</a>}
                {p.user_phone && <a href={`tel:${p.user_phone}`} data-testid={`roster-phone-${p.user_id}`} className="inline-flex items-center gap-1 hover:underline"><Icon name="phone" tone="current" className="h-3 w-3" /> {p.user_phone}</a>}
              </div>
            </div>
            <RosterMessageButton person={p} user={user} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RosterPanel({ event, regs, user }) {
  if (regs === undefined) return <div className="text-sm text-slate-500" data-testid="roster-loading">Loading roster…</div>;
  const volunteers = regs.filter((r) => r.kind === "volunteer");
  const attendees = regs.filter((r) => r.kind !== "volunteer");
  const reminderSubject = `Reminder: ${eventTitleParts(event.title).title}`;
  const reminderMessage = `Hi! A quick reminder that you signed up to volunteer for "${eventTitleParts(event.title).title}" on ${formatEventDate(event.starts_at, event.time_not_listed)}${event.location ? ` at ${event.location}` : ""}. We can't wait to see you there. Please reply if anything has changed. Thank you!`;
  return (
    <div className="space-y-4">
      {regs.length === 0 ? (
        <div className="text-sm text-slate-500" data-testid="roster-empty">No RSVPs or volunteer signups yet.</div>
      ) : (
        <div className="flex flex-col gap-5">
          <RosterGroup title="Volunteers" icon="hand-heart" color="text-[#F2A03B]" people={volunteers} user={user} />
          <RosterGroup title="Going" icon="crew" color="text-[#55B3AD]" people={attendees} user={user} />
        </div>
      )}
      <div className="flex flex-wrap items-start gap-2 pt-1">
        {(event.is_volunteer || volunteers.length > 0) && (
          <EventBlast event={event} audience="volunteer" label="Remind volunteers" icon="hand-heart" defaultSubject={reminderSubject} defaultMessage={reminderMessage} />
        )}
        <EventBlast event={event} audience="all" label="Message everyone" />
      </div>
    </div>
  );
}
