import { useEffect, useState, useCallback } from "react";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import Modal from "@/components/Modal";
import Avatar from "@/components/Avatar";
import MessageLink from "@/components/MessageLink";
import PlanPrompt from "@/components/PlanPrompt";
import { CrewListingView } from "@/components/CrewListingPopup";
import MultiSelectPicker from "@/components/MultiSelectPicker";
import { displayPosition, normalizePositions } from "@/lib/crewPositions";

const EMPTY_FORM = { positions: [], experienceTypes: [], sailingStyle: {}, experience: "", availability: "", notes: "", contactVia: "in-app" };

export default function CrewBankModal({ event, open, onClose, onChanged }) {
  const { user } = useAuth();
  const [data, setData] = useState({ count: 0, entries: [], mine: null, can_join: false });
  const [form, setForm] = useState(EMPTY_FORM);
  const [expTypesList, setExpTypesList] = useState([]);
  const [positionsList, setPositionsList] = useState([]);
  const [styleAxes, setStyleAxes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [viewing, setViewing] = useState(null);

  useEffect(() => { api.get("/markets").then(({ data }) => { setExpTypesList(data.experience_types || []); setStyleAxes(data.sailing_style_axes || []); }).catch(() => {}); }, []);
  useEffect(() => { api.get("/crew-positions").then(({ data }) => setPositionsList(data.positions || [])).catch(() => {}); }, []);
  // Once the live list loads, drop any prefilled position that is no longer valid.
  useEffect(() => {
    if (!positionsList.length) return;
    setForm((s) => {
      const norm = normalizePositions(s.positions, positionsList);
      return (norm.length === s.positions.length && norm.every((p, i) => p === s.positions[i])) ? s : { ...s, positions: norm };
    });
  }, [positionsList]);

  const reload = useCallback(async () => {
    // Crew pool is members-only (the API returns 401 for signed-out callers).
    if (!user) { setData({ count: 0, entries: [], mine: null, can_join: false }); setLoaded(true); return; }
    const { data: fresh } = await api.get(`/events/${event.id}/crew`);
    setData(fresh);
    if (fresh.mine) {
      const m = fresh.mine;
      setForm({
        positions: normalizePositions(m.positions, positionsList),
        experienceTypes: m.experience_types || [],
        sailingStyle: m.sailing_style || {},
        experience: m.experience || "",
        availability: m.availability || "",
        notes: m.notes || "",
        contactVia: m.contact_via || "in-app",
      });
    } else {
      // Prefill from the sailor's standalone crew listing if they have one.
      try {
        const { data: sa } = await api.get("/crew-bank/standalone/mine");
        const e = sa?.entry;
        setForm(e ? {
          positions: normalizePositions(e.positions, positionsList),
          experienceTypes: e.experience_types || [], sailingStyle: e.sailing_style || {},
          experience: e.experience || "", availability: e.availability || "",
          notes: e.notes || "", contactVia: e.contact_via || "in-app",
        } : EMPTY_FORM);
      } catch { setForm(EMPTY_FORM); }
    }
    setLoaded(true);
  }, [event.id, user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) { setLoaded(false); setViewing(null); return; }
    setLoaded(false);
    reload();
  }, [open, reload]);

  const setStyleVal = (k, n) => setForm((s) => ({ ...s, sailingStyle: { ...s.sailingStyle, [k]: n } }));

  const join = async () => {
    if (!user) return toast.error("Sign in first");
    if (form.positions.length === 0) return toast.error("Pick at least one position");
    setBusy(true);
    try {
      await api.post(`/events/${event.id}/crew`, {
        positions: normalizePositions(form.positions, positionsList), experience: form.experience,
        availability: form.availability, notes: form.notes, contact_via: form.contactVia,
        experience_types: form.experienceTypes,
        sailing_style: Object.keys(form.sailingStyle || {}).length ? form.sailingStyle : null,
      });
      toast.success(data.mine ? "Crew profile updated." : "You're in the crew pool!");
      await reload();
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  const setStatus = async (status) => {
    setBusy(true);
    try {
      await api.patch(`/events/${event.id}/crew/status`, { status });
      toast.success(status === "found" ? "Marked as found. Fair winds!" : "Back to seeking.");
      await reload();
      onChanged?.();
    } catch { toast.error("Failed"); }
    finally { setBusy(false); }
  };

  const leave = async () => {
    setBusy(true);
    try {
      await api.delete(`/events/${event.id}/crew`);
      toast.success("Removed from crew pool.");
      await reload();
      onChanged?.();
    } catch { toast.error("Failed"); }
    finally { setBusy(false); }
  };

  const mineStatus = data.mine?.status || "seeking";

  return (
    <Modal
      open={open}
      onClose={onClose}
      testId="crewbank-modal"
      eyebrow={<><Icon name="crew" tone="current" className="h-3.5 w-3.5" /> Crew Bank</>}
      title={event.title}
    >
      {/* Legacy testid alias — keep automation stable. */}
      <span data-testid="crewbank-close" className="sr-only" onClick={onClose} />
      {!loaded ? (
        <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>
      ) : !user ? (
        <div className="p-6 text-center" data-testid="crew-signup-prompt">
          <div className="inline-flex h-12 w-12 rounded-2xl bg-[#55B3AD]/15 items-center justify-center mb-3">
            <Icon name="crew" tone="current" className="h-6 w-6 text-[#55B3AD]" />
          </div>
          <div className="font-semibold text-[#1F3F5B] text-lg">See and join the crew pool</div>
          <p className="text-sm text-slate-500 mt-2">Create a free account to see who is crewing for this race and to raise your hand.</p>
          <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center">
            <Link to="/register" data-testid="crew-signup-btn" className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#F2A03B] hover:bg-[#d98c30] text-white font-semibold px-5 py-2.5">
              <Icon name="user-plus" tone="current" className="h-4 w-4" /> Create an account
            </Link>
            <Link to="/login" data-testid="crew-login-btn" className="inline-flex items-center justify-center rounded-full border border-slate-300 text-[#1F3F5B] font-semibold px-5 py-2.5 hover:bg-slate-50">
              Log in
            </Link>
          </div>
        </div>
      ) : viewing ? (
        <CrewListingView
          entry={viewing}
          currentUser={user}
          eventContext={{ title: event.title, starts_at: event.starts_at }}
          onBack={() => setViewing(null)}
          onEditOwn={viewing.user_id === user?.user_id ? () => setViewing(null) : undefined}
        />
      ) : (
        <>
          <section className="p-5 border-b border-slate-100">
            <div className="text-sm font-semibold text-slate-700">{data.count} in the crew pool</div>
            <div className="mt-3 space-y-3">
              {data.entries.length === 0 && (
                <div className="text-sm text-slate-500">No one&apos;s signed up yet — be the first to raise your hand.</div>
              )}
              {data.entries.map((e) => (
                <div key={e.user_id} role="button" tabIndex={0}
                     onClick={() => setViewing(e)}
                     onKeyDown={(ev) => { if (ev.key === "Enter") setViewing(e); }}
                     className="rounded-xl border border-slate-100 p-3 flex items-start gap-3 cursor-pointer hover:border-[#55B3AD]/50 hover:shadow-sm transition-shadow"
                     data-testid={`crew-entry-${e.user_id}`}>
                  <Avatar src={e.user_avatar} className="h-9 w-9" alt={e.user_name || ""} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#1F3F5B] flex items-center gap-2" data-testid={`crew-entry-open-${e.user_id}`}>
                      {e.user_name}
                      {e.user_id === user?.user_id && <span className="text-xs text-[#F2A03B]">(you)</span>}
                      {e.status === "found" && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-teal-100 text-[#1F3F5B]"><Icon name="success" tone="current" className="h-3 w-3" /> Found a boat</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(e.positions || []).map((p) => <span key={p} className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{displayPosition(p)}</span>)}
                    </div>
                  </div>
                  {user && e.user_id !== user.user_id && e.status !== "found" && (
                    <MessageLink toUserId={e.user_id} testId={`crew-row-message-${e.user_id}`}
                      ariaLabel={`Message ${e.user_name || "sailor"}`} title={`Message ${e.user_name || "sailor"}`}
                      className="shrink-0 inline-flex items-center justify-center h-10 w-10 rounded-full border border-slate-200 text-[#1F3F5B] hover:text-[#152a3d] hover:border-[#55B3AD] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#55B3AD]">
                      <Icon name="mail" tone="current" className="h-4 w-4" />
                    </MessageLink>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="p-5">
            {!user ? (
              <div className="text-sm text-slate-500">Sign in to join the crew pool.</div>
            ) : !data.can_join && !data.mine ? (
              <PlanPrompt featureKey="crew_bank_listing" testId="crew-plan-prompt" />
            ) : (
              <>
                {data.mine && (
                  <div className="mb-4 rounded-xl border border-slate-100 p-3 flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs text-slate-600">Current status: <b className={mineStatus === "found" ? "text-[#1F3F5B]" : "text-[#F2A03B]"}>{mineStatus === "found" ? "Found a boat" : "Seeking"}</b></div>
                    {mineStatus === "seeking" ? (
                      <button onClick={() => setStatus("found")} disabled={busy} data-testid="mark-found-btn"
                        className="text-xs font-semibold rounded-full border border-[#55B3AD] text-[#1F3F5B] hover:bg-teal-50 px-3 py-1.5">
                        <Icon name="success" tone="current" className="inline h-3.5 w-3.5 mr-1 text-[#55B3AD]" /> Found a boat
                      </button>
                    ) : (
                      <button onClick={() => setStatus("seeking")} disabled={busy} data-testid="mark-seeking-btn"
                        className="text-xs font-semibold rounded-full border border-slate-200 hover:bg-slate-50 px-3 py-1.5">
                        Re-open (still seeking)
                      </button>
                    )}
                  </div>
                )}
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">{data.mine ? "Update your crew profile for this race" : "Add yourself to the crew pool"}</div>
                <MultiSelectPicker
                  label="Positions"
                  title="Select positions"
                  testId="crew-positions-picker"
                  searchable={false}
                  options={positionsList.map((p) => ({ value: p, label: p }))}
                  value={form.positions}
                  onChange={(next) => setForm((s) => ({ ...s, positions: next }))}
                  placeholder="Select positions"
                  valueLabel={form.positions.length ? form.positions.map(displayPosition).join(", ") : undefined}
                  ariaLabel={`Positions: ${form.positions.length ? form.positions.map(displayPosition).join(", ") : "none selected"}`}
                />
                <div className="mt-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Type of sailing experience</div>
                  <MultiSelectPicker
                    label="Experience types"
                    title="Select experience types"
                    testId="crew-exp-picker"
                    searchable={false}
                    options={expTypesList.map((t) => ({ value: t, label: t }))}
                    value={form.experienceTypes}
                    onChange={(next) => setForm((s) => ({ ...s, experienceTypes: next }))}
                    placeholder="Select experience types"
                    valueLabel={form.experienceTypes.length ? form.experienceTypes.join(", ") : undefined}
                    ariaLabel={`Experience types: ${form.experienceTypes.length ? form.experienceTypes.join(", ") : "none selected"}`}
                  />
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Sailing style <span className="normal-case font-semibold text-slate-400">· optional</span></div>
                    {Object.keys(form.sailingStyle || {}).length > 0 && (
                      <button type="button" data-testid="crew-style-clear" onClick={() => setForm((s) => ({ ...s, sailingStyle: {} }))}
                        className="text-xs font-semibold text-[#55B3AD] hover:underline">Clear</button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mb-3">Click 1 to 5 to place yourself between each pair.</p>
                  {styleAxes.map((ax) => (
                    <div key={ax.key} className="mb-3" data-testid={`crew-style-${ax.key}`}>
                      <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                        <span>{ax.low}</span><span>{ax.high}</span>
                      </div>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} type="button" onClick={() => setStyleVal(ax.key, n)} data-testid={`crew-style-${ax.key}-${n}`}
                            className={`flex-1 h-8 rounded-lg border text-sm font-bold ${form.sailingStyle[ax.key] === n ? "bg-[#55B3AD] text-white border-[#55B3AD]" : "bg-white border-slate-200 text-slate-500 hover:border-[#55B3AD]"}`}>
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <input value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })}
                  placeholder="Experience (e.g. 5 seasons, J/24, foredeck)"
                  data-testid="crew-experience" className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
                <div className="mt-3">
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Availability around this event <span className="normal-case font-semibold text-slate-400">· optional</span></div>
                  <input value={form.availability} onChange={(e) => setForm({ ...form, availability: e.target.value })}
                    placeholder="For example, can help with the delivery after the race."
                    data-testid="crew-availability" className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
                </div>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Notes for the skipper (gear, references…)"
                  data-testid="crew-notes" rows={2} className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
                <div className="mt-3 flex items-center gap-3 text-sm flex-wrap">
                  <label className="inline-flex items-center gap-2"><input type="radio" name="contact" value="in-app" checked={form.contactVia === "in-app"} onChange={() => setForm({ ...form, contactVia: "in-app" })} /> In-app DM only</label>
                  <label className="inline-flex items-center gap-2"><input type="radio" name="contact" value="email" checked={form.contactVia === "email"} onChange={() => setForm({ ...form, contactVia: "email" })} /> Share my email with organizers</label>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  {data.mine && <button onClick={leave} disabled={busy} data-testid="crew-leave-btn" className="text-slate-600 px-4 py-2 rounded-full hover:bg-slate-100">Leave pool</button>}
                  <button onClick={join} disabled={busy} data-testid="crew-join-btn" className="bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2 font-semibold disabled:opacity-50">
                    {data.mine ? "Save changes" : "Add me to the bank"}
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </Modal>
  );
}
