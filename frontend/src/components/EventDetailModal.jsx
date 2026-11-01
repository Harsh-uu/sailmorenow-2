import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import FlagButton from "@/components/FlagButton";
import AdminControls from "@/components/AdminControls";
import { toast } from "sonner";
import { PartnerBadge } from "@/components/PartnerBadge";
import Modal from "@/components/Modal";
import CrewBankModal from "@/components/CrewBankModal";
import AddToCalendar from "@/components/AddToCalendar";
import Linkify from "@/lib/linkify";
import { eventHasCrewBank } from "@/lib/events";
import EventBlast from "@/components/EventBlast";
import ShareButton from "@/components/ShareButton";
import InviteBanner from "@/components/InviteBanner";
import { categoryMeta, formatEventWhen, eventTitleParts } from "@/lib/eventCategories";

export default function EventDetailModal({ event, open, onClose, onChanged, onEdit, onDuplicate, onCancelEvent, onCancelSeries }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(null);
  const [crewOpen, setCrewOpen] = useState(false);
  const { title: displayTitle, tentative } = eventTitleParts(event?.title);

  useEffect(() => {
    if (!user || !event || !open) return;
    api.get(`/events/${event.id}/registrations`).then(({ data }) => {
      setMine(data.mine || data.registrations?.find?.((r) => r.user_id === user.user_id) || null);
    }).catch(() => {});
  }, [event, user, open]);

  if (!event) return null;
  const cat = categoryMeta(event.category);
  const CatIcon = cat.icon;
  const isSourceEvent = event.source === "aggregator";
  // Volunteer / race-committee events (including imported ones) can be signed up
  // for in-app; the signup routes to the linked club/org when one is matched.
  const canRegisterInApp = event.is_volunteer || (!isSourceEvent && (event.category === "education" || !event.registration_url));
  const showExternal = !!event.registration_url && (isSourceEvent || !canRegisterInApp);
  const canMessageOrganizer = !!event.organizer_id && event.organizer_id !== user?.user_id;
  const counts = event.registrations || { attendee: 0, volunteer: 0 };
  const canManage = !!user && !isSourceEvent && (event.organizer_id === user.user_id || user.platform_role === "admin");
  const downloadCsv = async () => {
    try {
      const { data } = await api.get(`/events/${event.id}/attendees.csv`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a"); a.href = url; a.download = `${event.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-attendees.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch { toast.error("Couldn't export attendees"); }
  };

  const register = async (kind) => {
    if (!user) return toast.error("Sign in to register");
    setBusy(true);
    try {
      const { data } = await api.post(`/events/${event.id}/register`, { kind });
      setMine(data); toast.success(kind === "volunteer" ? "You're on the volunteer list!" : "You're registered!"); onChanged?.();
    } catch (e) { toast.error(errMsg(e, "Failed")); } finally { setBusy(false); }
  };
  const unregister = async () => {
    setBusy(true);
    try { await api.delete(`/events/${event.id}/register`); setMine(null); toast.success("You've unregistered."); onChanged?.(); }
    catch { toast.error("Failed"); } finally { setBusy(false); }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title={displayTitle} testId="event-detail-modal"
        eyebrow={<span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${cat.cls}`}><CatIcon className="h-3 w-3" /> {cat.label}</span>}
        footer={
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-slate-500 flex items-center gap-3">
              {counts.volunteer > 0 && <span className="inline-flex items-center gap-1"><Icon name="hand-heart" tone="current" className="h-3.5 w-3.5" /> {counts.volunteer} volunteers</span>}
              {counts.attendee > 0 && <span className="inline-flex items-center gap-1"><Icon name="crew" tone="current" className="h-3.5 w-3.5" /> {counts.attendee} going</span>}
            </div>
            <div className="flex items-center gap-2">
              <FlagButton targetType="event" targetId={event.id} hidden={event.organizer_id === user?.user_id} />
              <AdminControls entity="event" item={event} compact onChanged={(next) => { if (!next) { onClose?.(); } onChanged?.(); }} />
              <AddToCalendar event={event} />
              <ShareButton
                path={`/events?event=${event.id}`}
                title={event.title}
                text={`Check out "${event.title}" on Sail More Now`}
                iconOnly
                testId="event-share-btn"
              />
              {eventHasCrewBank(event) && (
                <button onClick={() => setCrewOpen(true)} data-testid={`modal-crewbank-btn-${event.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-[#55B3AD] text-[#1F3F5B] dark:text-white px-3 py-1.5 hover:bg-[#55B3AD] hover:text-white font-bold text-xs uppercase tracking-wider">
                  <Icon name="crew" tone="current" className="h-4 w-4" /> Crew Bank
                </button>
              )}
              {canMessageOrganizer && (
                <Link to={`/messages?to=${event.organizer_id}`} data-testid={`message-organizer-${event.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-[#1F3F5B] text-[#1F3F5B] dark:text-white dark:border-white px-3 py-1.5 hover:bg-[#1F3F5B] hover:text-white font-bold text-xs uppercase tracking-wider">
                  <Icon name="mail" tone="current" className="h-4 w-4" /> Message organizer
                </Link>
              )}
              {canRegisterInApp ? (mine ? (
                <button onClick={unregister} disabled={busy} data-testid={`unregister-${event.id}`} className="text-xs font-semibold text-slate-500 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-600">
                  <Icon name="check" tone="current" className="inline h-3.5 w-3.5 mr-1 text-[#55B3AD]" /> Registered — cancel
                </button>
              ) : (
                <button onClick={() => register(event.is_volunteer ? "volunteer" : "attendee")} disabled={busy} data-testid={`register-${event.id}`}
                  className="text-sm font-semibold text-white bg-[#F2A03B] hover:bg-[#d98c30] rounded-full px-4 py-1.5 disabled:opacity-50">
                  {event.is_volunteer ? "Volunteer" : event.category === "education" ? "Register" : "RSVP"}
                </button>
              )) : null}
              {showExternal && (
                <a href={event.registration_url} target="_blank" rel="noopener noreferrer" data-testid={`register-external-${event.id}`}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-white bg-[#F2A03B] hover:bg-[#d98c30] rounded-full px-4 py-1.5">
                  Register <Icon name="external-link" tone="current" className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        }>
        <div className="p-4 sm:p-6" data-testid="event-detail-body">
        {event.image_url && <img src={event.image_url} alt={event.title} className="w-full max-h-64 object-cover rounded-xl mb-4" />}
        {!user && <InviteBanner blurb={`Sign up free to RSVP to "${event.title}" and discover more PNW sailing events.`} />}
        <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-2"><Icon name="events" tone="current" className="h-4 w-4 text-[#55B3AD]" /> {formatEventWhen(event.starts_at, event.ends_at, event.time_not_listed)}
            {tentative && <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#F2A03B]/15 text-[#b86f1a] dark:text-[#F2A03B]" data-testid="event-tentative-badge">Tentative</span>}
          </div>
          <div className="flex items-center gap-2"><Icon name="location" tone="current" className="h-4 w-4 text-[#55B3AD]" /> {[event.location, event.market].filter(Boolean).join(" · ")}
            {typeof event.lat === "number" && <a href={`https://www.google.com/maps?q=${event.lat},${event.lng}`} target="_blank" rel="noreferrer" data-testid="event-directions" className="ml-1 text-xs font-semibold text-[#F2A03B] hover:underline">Directions</a>}
          </div>
          {event.series_id && <div className="flex items-center gap-2 text-xs text-slate-500" data-testid="event-series-badge"><Icon name="repeat" tone="current" className="h-3.5 w-3.5 text-[#55B3AD]" /> Part of a series · #{event.series_index} of {event.series_total}</div>}
          {event.is_free && <div className="flex items-center gap-2" data-testid="event-free-badge"><Icon name="ticket" tone="current" className="h-4 w-4 text-[#2A7871]" /> Free</div>}
          {event.organizer_name && <div className="text-xs text-slate-500 flex items-center gap-1.5">Hosted by {event.organizer_name}{isSourceEvent ? " (imported feed)" : ""}<PartnerBadge kind={event.organizer_partner_badge} /></div>}
          {event.is_volunteer && (event.volunteer_contact_email || event.volunteer_contact_phone) && (
            user ? (
              <div className="flex items-center gap-2 flex-wrap pt-1" data-testid="volunteer-contact">
                {event.volunteer_contact_email && <a href={`mailto:${event.volunteer_contact_email}`} data-testid="volunteer-email-btn" className="inline-flex items-center gap-1.5 rounded-full bg-[#55B3AD]/15 text-[#2A7871] px-3 py-1.5 text-xs font-semibold"><Icon name="mail" tone="current" className="h-3.5 w-3.5" /> Email</a>}
                {event.volunteer_contact_phone && <a href={`tel:${event.volunteer_contact_phone}`} data-testid="volunteer-phone-btn" className="inline-flex items-center gap-1.5 rounded-full bg-[#55B3AD]/15 text-[#2A7871] px-3 py-1.5 text-xs font-semibold"><Icon name="phone" tone="current" className="h-3.5 w-3.5" /> Call</a>}
              </div>
            ) : (
              <div className="text-xs text-slate-500" data-testid="volunteer-contact-locked">Sign in to see volunteer contact details</div>
            )
          )}
          {event.organizer_email && (
            user ? (
              <div className="flex items-center gap-2 flex-wrap pt-1" data-testid="event-contact">
                <a href={`mailto:${event.organizer_email}`} data-testid="event-contact-email-btn" className="inline-flex items-center gap-1.5 rounded-full bg-[#55B3AD]/15 text-[#2A7871] px-3 py-1.5 text-xs font-semibold"><Icon name="mail" tone="current" className="h-3.5 w-3.5" /> Contact</a>
              </div>
            ) : (
              <div className="text-xs text-slate-500" data-testid="event-contact-locked">Sign in to see the event contact</div>
            )
          )}
        </div>
        {event.description && <p className="mt-4 text-slate-700 dark:text-slate-200 whitespace-pre-line leading-relaxed" data-testid="event-detail-description"><Linkify text={event.description} /></p>}
        {canManage && (
          <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-700 flex items-center gap-2 flex-wrap" data-testid="event-manage">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mr-1">Organizer tools</span>
            <button onClick={() => onEdit?.(event)} data-testid={`edit-event-${event.id}`} className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold hover:border-[#55B3AD]"><Icon name="edit" tone="current" className="h-3.5 w-3.5" /> Edit</button>
            <button onClick={downloadCsv} data-testid={`export-attendees-${event.id}`} className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold hover:border-[#55B3AD]"><Icon name="download" tone="current" className="h-3.5 w-3.5" /> Check-in CSV</button>
            <button onClick={() => onDuplicate?.(event)} data-testid={`duplicate-event-${event.id}`} className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold hover:border-[#55B3AD]"><Icon name="copy" tone="current" className="h-3.5 w-3.5" /> Post again</button>
            <button onClick={() => onCancelEvent?.(event)} data-testid={`cancel-event-${event.id}`} className="inline-flex items-center gap-1 rounded-full border border-red-200 text-red-600 px-3 py-1.5 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950/40"><Icon name="delete" tone="current" className="h-3.5 w-3.5" /> Cancel event</button>
            {event.series_id && <button onClick={() => onCancelSeries?.(event)} data-testid={`cancel-series-${event.id}`} className="inline-flex items-center gap-1 rounded-full border border-red-200 text-red-600 px-3 py-1.5 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950/40"><Icon name="delete" tone="current" className="h-3.5 w-3.5" /> Cancel whole series</button>}
            <EventBlast event={event} />
          </div>
        )}
        </div>
      </Modal>
      <CrewBankModal event={event} open={crewOpen} onClose={() => setCrewOpen(false)} onChanged={onChanged} />
    </>
  );
}
