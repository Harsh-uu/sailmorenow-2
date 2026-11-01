import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { displayPosition } from "@/lib/crewPositions";

function daysLeft(iso) {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

export default function MyCrewListings() {
  const [listings, setListings] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/crew-bank/mine");
      setListings(data.listings || []);
    } catch {
      setListings([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStandaloneStatus = async (status) => {
    setBusy(true);
    try { await api.patch("/crew-bank/standalone/status", { status }); toast.success(status === "found" ? "Marked as found." : "Back to seeking."); await load(); }
    catch { toast.error("Failed"); } finally { setBusy(false); }
  };
  const renewStandalone = async () => {
    setBusy(true);
    try { await api.post("/crew-bank/standalone/renew"); toast.success("Refreshed for another 90 days."); await load(); }
    catch { toast.error("Failed"); } finally { setBusy(false); }
  };
  const removeStandalone = async () => {
    if (!window.confirm("Remove your standalone crew listing?")) return;
    setBusy(true);
    try { await api.delete("/crew-bank/standalone"); toast.success("Removed."); await load(); }
    catch { toast.error("Failed"); } finally { setBusy(false); }
  };
  const setEventStatus = async (eventId, status) => {
    setBusy(true);
    try { await api.patch(`/events/${eventId}/crew/status`, { status }); toast.success(status === "found" ? "Marked as found." : "Back to seeking."); await load(); }
    catch { toast.error("Failed"); } finally { setBusy(false); }
  };
  const leaveEvent = async (eventId) => {
    if (!window.confirm("Remove your crew sign-up for this event?")) return;
    setBusy(true);
    try { await api.delete(`/events/${eventId}/crew`); toast.success("Removed."); await load(); }
    catch { toast.error("Failed"); } finally { setBusy(false); }
  };

  const Btn = ({ onClick, tone = "default", testId, icon, children }) => {
    const base = "inline-flex items-center gap-1 text-sm font-semibold rounded-full px-4 py-2 border disabled:opacity-50";
    const tones = {
      default: "border-slate-200 hover:bg-slate-50 text-[#1F3F5B]",
      teal: "border-[#55B3AD] text-[#1F3F5B] hover:bg-teal-50",
      danger: "border-red-200 text-red-600 hover:bg-red-50",
    };
    return (
      <button onClick={onClick} disabled={busy} data-testid={testId} className={`${base} ${tones[tone]}`}>
        {icon && <Icon name={icon} tone="current" className="h-4 w-4" />} {children}
      </button>
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="my-crew-listings-page">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#F2A03B] flex items-center gap-2">
        <Icon name="crew" tone="current" className="h-3.5 w-3.5" /> Crew
      </div>
      <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl mt-2 tracking-tight">My Crew Listings</h1>
      <p className="mt-2 text-slate-600 max-w-2xl">Your standalone Crew Bank listing and every event crew sign-up, in one place.</p>

      {listings === null ? (
        <div className="mt-8 text-slate-500">Loading…</div>
      ) : listings.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-100 bg-white p-8 text-center" data-testid="my-crew-empty">
          <div className="text-slate-600">You have no crew listings yet.</div>
          <Link to="/crew-bank" data-testid="my-crew-empty-cta" className="mt-3 inline-block text-sm font-semibold text-[#F2A03B] hover:text-[#d98c30]">
            List yourself in the Crew Bank
          </Link>
        </div>
      ) : (
        <div className="mt-8 space-y-4" data-testid="my-crew-list">
          {listings.map((l) => {
            const key = l.kind === "event" ? `event-${l.event_id}` : "standalone";
            const isFound = l.status === "found";
            return (
              <div key={key} data-testid={`crew-row-${key}`}
                   className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 text-slate-600" data-testid={`crew-kind-${key}`}>
                      {l.kind === "event" ? "Event sign-up" : "Standalone"}
                    </span>
                    <div className="mt-1.5 font-semibold text-[#1F3F5B]">
                      {l.kind === "event" ? (l.event_name || "Event crew") : "Standalone crew listing"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(l.positions || []).slice(0, 8).map((p) => (
                        <span key={p} className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-teal-50 text-[#2A7871]">{displayPosition(p)}</span>
                      ))}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Status: <b className={isFound ? "text-[#1F3F5B]" : "text-[#F2A03B]"}>{isFound ? "Found" : "Seeking"}</b>
                      {(l.markets || []).length > 0 && <> · {(l.markets || []).slice(0, 3).join(" · ")}</>}
                      {l.kind === "event" && l.event_starts_at && <> · {new Date(l.event_starts_at).toLocaleDateString()}</>}
                      {l.kind === "standalone" && l.expires_at && <> · {l.is_expired ? "Expired" : `Expires in ${daysLeft(l.expires_at)} days`}</>}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  {l.kind === "standalone" ? (
                    <>
                      <Link to="/crew-bank" data-testid="crew-standalone-edit"
                            className="inline-flex items-center gap-1 text-sm font-semibold rounded-full px-4 py-2 border border-slate-200 hover:bg-slate-50 text-[#1F3F5B]">
                        <Icon name="edit" tone="current" className="h-4 w-4" /> Edit
                      </Link>
                      {isFound
                        ? <Btn onClick={() => setStandaloneStatus("seeking")} testId="crew-standalone-seeking">Re-open (seeking)</Btn>
                        : <Btn onClick={() => setStandaloneStatus("found")} tone="teal" icon="success" testId="crew-standalone-found">Found a boat</Btn>}
                      <Btn onClick={renewStandalone} icon="rotate" testId="crew-standalone-renew">Refresh 90d</Btn>
                      <Btn onClick={removeStandalone} tone="danger" icon="delete" testId="crew-standalone-remove">Remove</Btn>
                    </>
                  ) : (
                    <>
                      <Link to={`/events?event=${l.event_id}`} data-testid={`crew-event-open-${l.event_id}`}
                            className="inline-flex items-center gap-1 text-sm font-semibold rounded-full px-4 py-2 border border-slate-200 hover:bg-slate-50 text-[#1F3F5B]">
                        <Icon name="calendar" tone="current" className="h-4 w-4" /> Open event
                      </Link>
                      {isFound
                        ? <Btn onClick={() => setEventStatus(l.event_id, "seeking")} testId={`crew-event-seeking-${l.event_id}`}>Re-open (seeking)</Btn>
                        : <Btn onClick={() => setEventStatus(l.event_id, "found")} tone="teal" icon="success" testId={`crew-event-found-${l.event_id}`}>Found a boat</Btn>}
                      <Btn onClick={() => leaveEvent(l.event_id)} tone="danger" icon="delete" testId={`crew-event-remove-${l.event_id}`}>Remove</Btn>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
