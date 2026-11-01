import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";

// Organizer → attendees announcement. Lives inside the event detail modal and
// the organizer dashboard. `audience` targets all / volunteer / attendee.
export default function EventBlast({ event, audience = "all", label, icon = "myEvents", defaultSubject = "", defaultMessage = "" }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  useEffect(() => { if (open) api.get(`/events/${event.id}/blasts`).then(({ data }) => setHistory(data)).catch(() => {}); }, [open, event.id]);
  useEffect(() => { if (open) { setSubject(defaultSubject); setMessage(defaultMessage); } }, [open, defaultSubject, defaultMessage]);

  const send = async () => {
    if (subject.trim().length < 2 || message.trim().length < 2) return toast.error("Add a subject and a message");
    setBusy(true);
    try {
      const { data } = await api.post(`/events/${event.id}/blast`, { subject: subject.trim(), message: message.trim(), send_email: sendEmail, audience });
      toast.success(`Sent to ${data.recipients} ${data.recipients === 1 ? "person" : "people"}${data.emailed ? ` · ${data.emailed} emailed` : ""}`);
      setSubject(""); setMessage(""); setOpen(false);
    } catch (e) { toast.error(errMsg(e, "Couldn't send")); } finally { setBusy(false); }
  };

  const total = audience === "volunteer" ? (event.registrations?.volunteer || 0)
    : audience === "attendee" ? (event.registrations?.attendee || 0)
    : (event.registrations?.attendee || 0) + (event.registrations?.volunteer || 0) + (event.crew_count || 0);
  const triggerLabel = label || "Message attendees";
  const audienceHint = audience === "volunteer" ? "everyone who signed up to volunteer"
    : audience === "attendee" ? "everyone who RSVP'd" : "everyone who RSVP'd or joined the Crew Bank";
  return (
    <div className="w-full" data-testid="event-blast">
      {!open ? (
        <button onClick={() => setOpen(true)} data-testid={`blast-open-${event.id}`} className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold hover:border-[#55B3AD]">
          <Icon name={icon} tone="current" className="h-3.5 w-3.5" /> {triggerLabel}{total ? ` (${total})` : ""}
        </button>
      ) : (
        <div className="mt-2 rounded-xl bg-slate-50 dark:bg-slate-900 p-3 space-y-2" data-testid="blast-form">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Message {audienceHint}</div>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Subject — e.g. Skippers' meeting moved to 5:30" data-testid="blast-subject" className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={4} placeholder="Your message…" data-testid="blast-message" className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm" />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} data-testid="blast-email-toggle" /> Also email (replies go to you)</label>
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} className="text-xs px-3 py-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700">Cancel</button>
              <button onClick={send} disabled={busy} data-testid="blast-send" className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#F2A03B] hover:bg-[#d98c30] rounded-full px-4 py-1.5 disabled:opacity-50"><Icon name="send" tone="current" className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send"}</button>
            </div>
          </div>
          {history.length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 space-y-1" data-testid="blast-history">
              <div className="font-bold uppercase tracking-widest text-[10px]">Sent before</div>
              {history.slice(0, 3).map((h) => <div key={h.id}><b className="text-slate-700 dark:text-slate-200">{h.subject}</b> · {h.recipients} people · {new Date(h.created_at).toLocaleDateString()}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
