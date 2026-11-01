import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link, useSearchParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useMarket } from "@/context/MarketContext";
import { toast } from "sonner";
import EventCalendar from "@/components/EventCalendar";
import SponsorCarousel from "@/components/SponsorCarousel";
import EventRow from "@/components/EventRow";
import EventMap from "@/components/EventMap";
import LocationPicker from "@/components/LocationPicker";
import FlyerUploader from "@/components/FlyerUploader";
import EventDetailModal from "@/components/EventDetailModal";
import { EVENT_CATEGORIES, eventDayKey, dayKey, ptInputToISO, isoToPTInput } from "@/lib/eventCategories";
import SegmentedControl from "@/components/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CAT_KEYS = EVENT_CATEGORIES.map((c) => c.key);
const parseDay = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

const EMPTY_DRAFT = {
  title: "", description: "", market: "", starts_at: "", ends_at: "", location: "", time_tbd: false,
  is_volunteer: false, is_paid: true, is_free: false, freeTouched: false, is_race: false,
  volunteer_contact_email: "", volunteer_contact_phone: "", volunteer_reminder_lead_days: 1,
  registration_url: "", image_url: "", category: "", pin: null, repeat: "none", occurrences: 8,
};

export default function Events() {
  const { user, loading: authLoading } = useAuth();
  const { market } = useMarket();
  const [events, setEvents] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const reqIdRef = useRef(0);
  const [markets, setMarkets] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingSeries, setEditingSeries] = useState(null);
  const [applyTo, setApplyTo] = useState("one");
  const [aggBusy, setAggBusy] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [catError, setCatError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const fieldRefs = useRef({});
  const clearErr = (k) => setFieldErrors((p) => (p[k] ? { ...p, [k]: undefined } : p));
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState(CAT_KEYS.includes(params.get("category")) ? params.get("category") : "all");
  const [day, setDay] = useState(() => parseDay(params.get("date")));
  const [active, setActive] = useState(null);
  const pendingEventId = useRef(params.get("event"));
  const [view, setView] = useState(params.get("view") === "map" ? "map" : "list");

  // Keep the URL shareable: /events?category=racing&date=2026-09-12&event=<id>
  useEffect(() => {
    const next = new URLSearchParams();
    if (category !== "all") next.set("category", category);
    if (day) next.set("date", dayKey(day));
    if (active) next.set("event", active.id);
    else if (pendingEventId.current) next.set("event", pendingEventId.current);
    if (view === "map") next.set("view", "map");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [category, day, active, view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = pendingEventId.current;
    if (id && events?.length) {
      const ev = events.find((e) => e.id === id);
      pendingEventId.current = null;
      if (ev) setActive(ev);
    }
  }, [events]);

  const copyLink = () => { navigator.clipboard?.writeText(window.location.href); toast.success("Link copied — share this view"); };

  useEffect(() => { api.get("/markets").then(({ data }) => setMarkets(data.markets)); }, []);
  // The header market selector drives the list, exactly like mobile:
  // "all" sends no filter (all markets); a named market sends market=<name>.
  const load = () => {
    const reqId = ++reqIdRef.current;
    setLoadError(false);
    const params = market === "all" ? {} : { market };
    api.get("/events", { params })
      .then(({ data }) => { if (reqId === reqIdRef.current) setEvents(data); })
      .catch(() => { if (reqId === reqIdRef.current) setLoadError(true); });
  };
  useEffect(() => { if (!authLoading) load(); }, [market, user, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const byCategory = useMemo(() => { const list = events || []; return category === "all" ? list : list.filter((e) => e.category === category); }, [events, category]);
  const visible = useMemo(() => day ? byCategory.filter((e) => eventDayKey(e.starts_at, e.time_not_listed) === dayKey(day)) : byCategory, [byCategory, day]);

  const submit = async () => {
    if (!user) return toast.error("Sign in to post events");
    const errs = {};
    if (!draft.title.trim()) errs.title = "Add an event title.";
    if (!draft.market) errs.market = "Choose a market.";
    if (!draft.starts_at) errs.starts_at = "Pick a start date and time.";
    if (!draft.description.trim()) errs.description = "Add a description.";
    if (user?.platform_role !== "admin" && !draft.category) errs.category = "Choose a category.";
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setCatError(!!errs.category);
      const first = ["title", "market", "starts_at", "category", "description"].find((k) => errs[k]);
      const el = fieldRefs.current[first];
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => el.focus({ preventScroll: true }), 300); }
      return;
    }
    setFieldErrors({}); setCatError(false);
    try {
      const { pin, repeat, occurrences, freeTouched, is_free, ...rest } = draft;
      const startsISO = draft.time_tbd ? draft.starts_at.slice(0, 10) : ptInputToISO(draft.starts_at);
      const endsISO = draft.time_tbd ? null : (draft.ends_at ? ptInputToISO(draft.ends_at) : null);
      if (endsISO && new Date(endsISO) <= new Date(startsISO)) {
        setFieldErrors({ ends_at: "End time must be after the start time" });
        toast.error("End time must be after the start time");
        return;
      }
      const payload = { ...rest, starts_at: startsISO, ends_at: endsISO, category: draft.category || null, lat: pin?.lat ?? null, lng: pin?.lng ?? null };
      if (freeTouched) payload.is_free = is_free;
      if (editingId) {
        if (editingSeries && applyTo === "series") {
          const { data } = await api.patch(`/events/series/${editingSeries}`, payload);
          toast.success(`Updated ${data.updated} remaining events in the series`);
        } else {
          await api.patch(`/events/${editingId}`, payload);
          toast.success("Event updated — attendees notified of any time/place changes");
        }
      } else if (repeat !== "none") {
        const { data } = await api.post("/events/series", { ...payload, repeat, occurrences: Number(occurrences) || 8 });
        toast.success(`Posted ${data.count} events in the series`);
      } else {
        await api.post("/events", payload);
        toast.success("Event submitted");
      }
      setCreating(false); setEditingId(null); setEditingSeries(null); setApplyTo("one"); setDraft(EMPTY_DRAFT); setActive(null); load();
    } catch (e) { if (e?.upgradeHandled) return; toast.error(errMsg(e, "Failed")); }
  };

  const toLocalInput = isoToPTInput;
  const draftFrom = (ev) => ({
    title: ev.title || "", description: ev.description || "", market: ev.market || "", starts_at: toLocalInput(ev.starts_at), ends_at: toLocalInput(ev.ends_at),
    location: ev.location || "", is_volunteer: !!ev.is_volunteer, is_paid: !!ev.is_paid, is_free: !!ev.is_free, freeTouched: false, is_race: !!ev.is_race,
    volunteer_contact_email: ev.volunteer_contact_email || "", volunteer_contact_phone: ev.volunteer_contact_phone || "", volunteer_reminder_lead_days: ev.volunteer_reminder_lead_days || 1,
    registration_url: ev.registration_url || "", image_url: ev.image_url || "", category: ev.category_manual ? ev.category : "",
    pin: typeof ev.lat === "number" ? { lat: ev.lat, lng: ev.lng } : null, repeat: "none", occurrences: 8,
  });
  const openForm = () => { setActive(null); setCreating(true); setCatError(false); setFieldErrors({}); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const startEdit = (ev) => { setDraft(draftFrom(ev)); setEditingId(ev.id); setEditingSeries(ev.series_id || null); openForm(); };
  const duplicate = (ev) => { setDraft({ ...draftFrom(ev), starts_at: "", ends_at: "" }); setEditingId(null); setEditingSeries(null); openForm(); toast("Prefilled from your event — pick a new date"); };

  // Deep-link actions from the organizer dashboard: ?post=1, ?edit=<id>, ?duplicate=<id>
  const pendingAction = useRef({ edit: params.get("edit"), duplicate: params.get("duplicate"), post: params.get("post") });
  useEffect(() => {
    const a = pendingAction.current;
    if (!a) return;
    if (a.post) { pendingAction.current = null; setCreating(true); return; }
    if (!events?.length) return;
    const ev = events.find((e) => e.id === (a.edit || a.duplicate));
    pendingAction.current = null;
    if (ev) (a.edit ? startEdit : duplicate)(ev);
  }, [events]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancelSeries = async (ev) => {
    if (!window.confirm(`Cancel the whole series (${ev.series_total} events)? Everyone signed up will be notified.`)) return;
    try { const { data } = await api.delete(`/events/series/${ev.series_id}`); toast.success(`Cancelled ${data.cancelled} events`); setActive(null); load(); }
    catch (e) { toast.error(errMsg(e, "Failed")); }
  };
  const cancelEvent = async (ev) => {
    if (!window.confirm(`Cancel "${ev.title}"? Everyone who RSVP'd or joined the Crew Bank will be notified.`)) return;
    try { await api.delete(`/events/${ev.id}`); toast.success("Event cancelled and attendees notified"); setActive(null); load(); }
    catch (e) { toast.error(errMsg(e, "Failed")); }
  };

  const runAggregator = async () => {
    setAggBusy(true);
    try {
      const { data } = await api.post("/admin/events/aggregate");
      toast.success(`Synced ${(data.inserted || 0) + (data.updated || 0)} events from ${data.sources?.length} sources${data.errors ? ` (${data.errors} errored)` : ""}`);
      load();
    } catch (e) { toast.error(errMsg(e, "Sync failed")); } finally { setAggBusy(false); }
  };

  const isAdmin = user?.platform_role === "admin";
  const canPostEvents = user && (user.account_type === "partner" || user.account_type === "boat_pro" || isAdmin);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="events-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#55B3AD]">Events calendar</div>
          <h1 className="font-display font-extrabold smn-heading text-3xl sm:text-4xl mt-1">What&apos;s happening on the water.</h1>
          <p className="text-slate-600 dark:text-slate-300 mt-2">Regattas, rendezvous, clinics and volunteer days across the PNW — sourced from local clubs and our community.</p>
        </div>
        <div className="flex gap-2 items-center">
          {isAdmin && <button onClick={runAggregator} disabled={aggBusy} data-testid="sync-feeds-btn" className="inline-flex items-center gap-2 border-2 border-[#1F3F5B] dark:border-slate-400 smn-heading rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50">{aggBusy ? "Syncing…" : "Sync feeds"}</button>}
          {user && <Link to="/my-crew-listings" data-testid="events-my-crew-listings-link" className="inline-flex items-center gap-2 border-2 border-[#1F3F5B] dark:border-slate-400 smn-heading rounded-full px-4 py-2 text-sm font-semibold"><Icon name="crew" tone="current" className="h-4 w-4" /> My Crew Listings</Link>}
          {canPostEvents && <Link to="/my-events" data-testid="my-events-link" className="inline-flex items-center gap-2 border-2 border-[#1F3F5B] dark:border-slate-400 smn-heading rounded-full px-4 py-2 text-sm font-semibold"><Icon name="layout-list" tone="current" className="h-4 w-4" /> My events</Link>}
          {canPostEvents && <button onClick={() => setCreating(!creating)} data-testid="new-event-btn" className="inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2.5 font-semibold"><Icon name="add" tone="current" className="h-4 w-4" /> Post event</button>}
        </div>
      </div>

      {creating && canPostEvents && (
        <div className="mt-6 bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-100 dark:border-slate-700 grid sm:grid-cols-2 gap-4" data-testid="new-event-form">
          {Object.values(fieldErrors).filter(Boolean).length > 0 && (
            <div className="sm:col-span-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-semibold text-red-700" role="alert" aria-live="assertive" data-testid="event-form-error-summary">
              Please complete the highlighted {Object.values(fieldErrors).filter(Boolean).length === 1 ? "field" : "fields"} below before publishing.
            </div>
          )}
          {editingId && <div className="sm:col-span-2 text-xs font-bold uppercase tracking-widest text-[#d98c30]" data-testid="editing-banner">Editing event — attendees are notified if time or place changes</div>}
          {editingId && editingSeries && (
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-900 p-3" data-testid="apply-to-controls">
              <Icon name="repeat" tone="current" className="h-4 w-4 text-[#55B3AD]" /><span className="text-sm font-semibold smn-heading">Apply changes to</span>
              {[["one", "Only this event"], ["series", "All remaining events in the series"]].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setApplyTo(k)} data-testid={`apply-to-${k}`} className={`rounded-full px-3 py-1 text-xs font-semibold border ${applyTo === k ? "bg-[#1F3F5B] text-white border-[#1F3F5B]" : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"}`}>{l}</button>
              ))}
              {applyTo === "series" && <span className="text-[11px] text-slate-500 w-full">Time changes shift every occurrence by the same amount, so the weekly cadence is kept.</span>}
            </div>
          )}
          <div className="flex flex-col">
            <input ref={(el) => (fieldRefs.current.title = el)} placeholder="Event title" value={draft.title} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); clearErr("title"); }} aria-invalid={!!fieldErrors.title} aria-describedby={fieldErrors.title ? "event-title-error" : undefined} className={`w-full rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none min-h-[44px] ${fieldErrors.title ? "border-red-400" : "border-slate-200 dark:border-slate-700"}`} data-testid="event-title" />
            {fieldErrors.title && <span id="event-title-error" className="text-xs text-red-500 mt-1" data-testid="event-title-error">{fieldErrors.title}</span>}
          </div>
          <div className="flex flex-col">
            <select ref={(el) => (fieldRefs.current.market = el)} value={draft.market} onChange={(e) => { setDraft({ ...draft, market: e.target.value }); clearErr("market"); }} aria-invalid={!!fieldErrors.market} aria-describedby={fieldErrors.market ? "event-market-error" : undefined} className={`w-full rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none min-h-[44px] ${fieldErrors.market ? "border-red-400" : "border-slate-200 dark:border-slate-700"}`} data-testid="event-market">
              <option value="">Market…</option>{markets.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {fieldErrors.market && <span id="event-market-error" className="text-xs text-red-500 mt-1" data-testid="event-market-error">{fieldErrors.market}</span>}
          </div>
          <label className="flex flex-col text-xs font-semibold text-slate-500 gap-1">Start
            <input ref={(el) => (fieldRefs.current.starts_at = el)} type="datetime-local" step="1800" value={draft.starts_at} onChange={(e) => { setDraft({ ...draft, starts_at: e.target.value }); clearErr("starts_at"); }} aria-invalid={!!fieldErrors.starts_at} aria-describedby={fieldErrors.starts_at ? "event-start-error" : undefined} className={`w-full rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none min-h-[44px] font-normal text-slate-900 dark:text-white ${fieldErrors.starts_at ? "border-red-400" : "border-slate-200 dark:border-slate-700"}`} data-testid="event-start" />
            <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer"><input type="checkbox" checked={!!draft.time_tbd} onChange={(e) => setDraft({ ...draft, time_tbd: e.target.checked })} data-testid="event-time-tbd" /> Time to be decided (show the date only)</label>
            {fieldErrors.starts_at && <span id="event-start-error" className="text-red-500" data-testid="event-start-error">{fieldErrors.starts_at}</span>}</label>
          <label className="flex flex-col text-xs font-semibold text-slate-500 gap-1">End (optional)
            <input type="datetime-local" step="1800" value={draft.ends_at} onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none min-h-[44px] font-normal text-slate-900 dark:text-white" data-testid="event-end" /></label>
          {!editingId && (
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-900 p-3" data-testid="repeat-controls">
              <Icon name="repeat" tone="current" className="h-4 w-4 text-[#55B3AD]" />
              <span className="text-sm font-semibold smn-heading">Repeats</span>
              <select value={draft.repeat} onChange={(e) => setDraft({ ...draft, repeat: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none min-h-[44px]" data-testid="event-repeat">
                <option value="none">One-time event</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option>
              </select>
              {draft.repeat !== "none" && (
                <label className="text-sm text-slate-600 dark:text-slate-300 inline-flex items-center gap-2">for
                  <input type="number" min={2} max={26} value={draft.occurrences} onChange={(e) => setDraft({ ...draft, occurrences: e.target.value })} className="w-20 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-center focus:border-[#55B3AD] outline-none min-h-[44px]" data-testid="event-occurrences" />
                  weeks/occurrences (max 26)</label>
              )}
            </div>
          )}
          <input placeholder="Location" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none min-h-[44px]" />
          <div className="flex flex-col">
            <select ref={(el) => (fieldRefs.current.category = el)} value={draft.category} onChange={(e) => { setDraft({ ...draft, category: e.target.value }); setCatError(false); clearErr("category"); }} aria-invalid={!!fieldErrors.category} aria-describedby={fieldErrors.category ? "event-category-error" : undefined} className={`w-full rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none min-h-[44px] ${(catError || fieldErrors.category) ? "border-red-400" : "border-slate-200 dark:border-slate-700"}`} data-testid="event-category">
              <option value="" disabled={!isAdmin}>{isAdmin ? "Category (auto-detect)…" : "Category…"}</option>{EVENT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            {fieldErrors.category && <span id="event-category-error" className="text-xs text-red-500 mt-1" data-testid="event-category-error">{fieldErrors.category}</span>}
          </div>
          <div className="sm:col-span-2 flex flex-col">
            <textarea ref={(el) => (fieldRefs.current.description = el)} placeholder="Description" value={draft.description} onChange={(e) => { setDraft({ ...draft, description: e.target.value }); clearErr("description"); }} rows={3} aria-invalid={!!fieldErrors.description} aria-describedby={fieldErrors.description ? "event-desc-error" : undefined} className={`w-full rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none ${fieldErrors.description ? "border-red-400" : "border-slate-200 dark:border-slate-700"}`} data-testid="event-desc" />
            {fieldErrors.description && <span id="event-desc-error" className="text-xs text-red-500 mt-1" data-testid="event-desc-error">{fieldErrors.description}</span>}
          </div>
          <div className="sm:col-span-2"><LocationPicker market={draft.market} value={draft.pin} onChange={(pin) => setDraft((d) => ({ ...d, pin }))} /></div>
          <label className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4 accent-[#55B3AD]" checked={draft.is_volunteer} onChange={(e) => setDraft({ ...draft, is_volunteer: e.target.checked })} /> Volunteer opportunity (enables in-app volunteer signup)</label>
          {draft.is_volunteer && (
            <div className="sm:col-span-2 grid sm:grid-cols-2 gap-3 rounded-xl bg-slate-50 dark:bg-slate-900 p-3" data-testid="volunteer-contact-fields">
              <input type="email" placeholder="Volunteer contact email (optional)" value={draft.volunteer_contact_email} onChange={(e) => setDraft({ ...draft, volunteer_contact_email: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none min-h-[44px]" data-testid="volunteer-email" />
              <input placeholder="Volunteer contact phone (optional)" value={draft.volunteer_contact_phone} onChange={(e) => setDraft({ ...draft, volunteer_contact_phone: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none min-h-[44px]" data-testid="volunteer-phone" />
              <label className="sm:col-span-2 flex items-center justify-between gap-2 text-sm text-slate-600">
                <span>Auto-remind volunteers</span>
                <select value={draft.volunteer_reminder_lead_days} onChange={(e) => setDraft({ ...draft, volunteer_reminder_lead_days: Number(e.target.value) })} data-testid="volunteer-lead-days" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none min-h-[44px]">
                  <option value={1}>1 day before</option>
                  <option value={2}>2 days before</option>
                  <option value={3}>3 days before</option>
                  <option value={7}>1 week before</option>
                </select>
              </label>
            </div>
          )}
          <label className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4 accent-[#55B3AD]" data-testid="event-is-race" checked={draft.is_race} onChange={(e) => setDraft({ ...draft, is_race: e.target.checked })} /> This is a race (enables Crew Bank)</label>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4 accent-[#55B3AD]" data-testid="event-is-free" checked={!draft.is_paid} onChange={(e) => setDraft({ ...draft, is_paid: !e.target.checked, is_free: e.target.checked, freeTouched: true })} /> Free event</label>
            <span className="text-xs text-slate-500">Paid details are on the event page.</span>
          </div>
          <input placeholder="External registration URL (leave blank for in-app RSVP)" value={draft.registration_url} onChange={(e) => setDraft({ ...draft, registration_url: e.target.value })} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none sm:col-span-2" />
          <div className="sm:col-span-2"><FlyerUploader value={draft.image_url} onChange={(image_url) => setDraft((d) => ({ ...d, image_url }))} /></div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button onClick={() => { setCreating(false); setEditingId(null); setEditingSeries(null); setApplyTo("one"); setDraft(EMPTY_DRAFT); }} className="px-5 py-2.5 rounded-full hover:bg-slate-100">Cancel</button>
            <button onClick={submit} data-testid="event-submit" className="bg-[#1F3F5B] text-white hover:bg-[#152a3d] rounded-full px-5 py-2.5 font-semibold">{editingId ? "Save changes" : "Publish"}</button>
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3" data-testid="events-filters">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger data-testid="events-category" aria-label="Event category"
            className="w-[200px] rounded-full border-[var(--smn-border)] bg-[var(--smn-surface)] min-h-[44px] px-4 text-sm font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="cat-opt-all">All categories</SelectItem>
            {EVENT_CATEGORIES.map(({ key, label }) => (
              <SelectItem key={key} value={key} data-testid={`cat-opt-${key}`}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-6 grid lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)] gap-6 items-start">
        <div className="lg:sticky lg:top-24 min-w-0">
          <EventCalendar events={byCategory} selected={day} onSelect={setDay} />
          <p className="text-xs text-slate-500 mt-2 px-1">Tap a date to see that day&apos;s events. Dots mark days with events.</p>
          <SponsorCarousel />
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div className="text-sm text-slate-500 dark:text-slate-400" data-testid="events-count">
              {events === null || loadError ? <span>&nbsp;</span> : day ? <>{visible.length} event{visible.length === 1 ? "" : "s"} on <b className="smn-heading">{day.toLocaleDateString(undefined, { dateStyle: "long" })}</b></> : <>{visible.length} upcoming event{visible.length === 1 ? "" : "s"}</>}
            </div>
            {day && <button onClick={() => setDay(null)} data-testid="show-all-upcoming" className="inline-flex items-center gap-1 text-xs font-semibold rounded-full border border-slate-200 dark:border-slate-600 px-3 py-1 hover:border-[#55B3AD]"><Icon name="close" tone="current" className="h-3 w-3" /> Show all upcoming</button>}
            <button onClick={copyLink} data-testid="copy-events-link" className="inline-flex items-center gap-1 text-xs font-semibold rounded-full border border-slate-200 dark:border-slate-600 px-3 py-1 hover:border-[#55B3AD] text-slate-600 dark:text-slate-300"><Icon name="link" tone="current" className="h-3 w-3" /> Share this view</button>
            <SegmentedControl
              testId="view-toggle"
              ariaLabel="View mode"
              value={view}
              onChange={setView}
              options={[
                { value: "list", label: "List", icon: "list" },
                { value: "map", label: "Map", icon: "map" },
              ]}
            />
          </div>
          {loadError ? (
            <div className="rounded-xl border border-dashed border-[var(--smn-border)] p-8 text-center" data-testid="events-error">
              <p className="text-[var(--smn-text-secondary)]">We could not load events. Check your connection and try again.</p>
              <button onClick={load} data-testid="events-retry"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--smn-border)] px-4 min-h-[40px] text-sm font-semibold text-[var(--smn-text)] hover:border-[var(--smn-teal)]">
                <Icon name="repeat" tone="current" className="h-4 w-4" /> Try again
              </button>
            </div>
          ) : events === null ? (
            <div className="space-y-3" data-testid="events-loading">
              <p className="text-sm text-[var(--smn-text-secondary)]">Loading events</p>
              {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
            </div>
          ) : view === "map" ? (
            <EventMap events={visible} onOpen={setActive} />
          ) : (
          <div className="space-y-3" data-testid="events-list">
            {visible.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--smn-border)] p-8 text-center" data-testid="events-empty">
                <p className="text-[var(--smn-text-secondary)]">No events match. Try another day or category.</p>
                {(category !== "all" || day) && (
                  <button onClick={() => { setCategory("all"); setDay(null); }} data-testid="events-clear-filters"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--smn-border)] px-4 min-h-[40px] text-sm font-semibold text-[var(--smn-text)] hover:border-[var(--smn-teal)]">
                    <Icon name="close" tone="current" className="h-4 w-4" /> Clear filters
                  </button>
                )}
              </div>
            ) : visible.map((e) => <EventRow key={e.id} event={e} onOpen={setActive} onChanged={load} />)}
          </div>
          )}
        </div>
      </div>

      <EventDetailModal event={active} open={!!active} onClose={() => setActive(null)} onChanged={load} onEdit={startEdit} onDuplicate={duplicate} onCancelEvent={cancelEvent} onCancelSeries={cancelSeries} />
    </div>
  );
}
