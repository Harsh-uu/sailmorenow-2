import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useMarket } from "@/context/MarketContext";
import { toast } from "sonner";
import Modal from "@/components/Modal";
import Avatar from "@/components/Avatar";
import MessageLink from "@/components/MessageLink";
import CrewListingPopup from "@/components/CrewListingPopup";
import MultiSelectPicker from "@/components/MultiSelectPicker";
import { displayPosition, normalizePositions } from "@/lib/crewPositions";

const EMPTY = { positions: [], experience: "", notes: "", availability: "", markets: [], contact_via: "in-app", experience_types: [], sailing_style: {} };

function daysLeft(iso) {
  if (!iso) return null;
  const d = Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
  return d;
}

export default function CrewBank() {
  const { user } = useAuth();
  const { market } = useMarket();
  const [data, setData] = useState({ count: 0, entries: [], can_list_yourself: false });
  const [mine, setMine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [markets, setMarkets] = useState([]);
  const [expTypesList, setExpTypesList] = useState([]);
  const [positionsList, setPositionsList] = useState([]);
  const [styleAxes, setStyleAxes] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  useEffect(() => { api.get("/markets").then(({ data }) => { setMarkets(data.markets); setExpTypesList(data.experience_types || []); setStyleAxes(data.sailing_style_axes || []); }).catch(() => {}); }, []);
  useEffect(() => { api.get("/crew-positions").then(({ data }) => setPositionsList(data.positions || [])).catch(() => {}); }, []);
  useEffect(() => {
    if (!positionsList.length) return;
    setForm((s) => {
      const norm = normalizePositions(s.positions, positionsList);
      return (norm.length === s.positions.length && norm.every((p, i) => p === s.positions[i])) ? s : { ...s, positions: norm };
    });
  }, [positionsList]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: fresh } = await api.get("/crew-bank/standalone", { params: { market: market !== "all" ? market : undefined, verified_only: verifiedOnly || undefined } });
      setData(fresh);
    } finally { setLoading(false); }
  }, [market, verifiedOnly]);

  const loadMine = useCallback(async () => {
    if (!user) { setMine(null); return; }
    try {
      const { data: r } = await api.get("/crew-bank/standalone/mine");
      setMine(r.entry);
    } catch { setMine(null); }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadMine(); }, [loadMine]);

  const setStyleVal = (k, n) => setForm((s) => ({ ...s, sailing_style: { ...s.sailing_style, [k]: n } }));
  const closeForm = useCallback(() => setShowForm(false), []);

  const openForm = () => {
    if (!user) return toast.error("Sign in first");
    if (mine) {
      setForm({
        positions: normalizePositions(mine.positions, positionsList),
        experience: mine.experience || "",
        notes: mine.notes || "",
        availability: mine.availability || "",
        markets: mine.markets || [],
        contact_via: mine.contact_via || "in-app",
        experience_types: mine.experience_types || [],
        sailing_style: mine.sailing_style || {},
      });
    } else {
      setForm({ ...EMPTY, markets: user.primary_market ? [user.primary_market] : [] });
    }
    setShowForm(true);
  };

  const save = async () => {
    const positions = normalizePositions(form.positions, positionsList);
    if (positions.length === 0) return toast.error("Pick at least one position");
    if (form.markets.length === 0) return toast.error("Pick at least one market");
    setBusy(true);
    try {
      await api.post("/crew-bank/standalone", {
        ...form,
        positions,
        sailing_style: Object.keys(form.sailing_style || {}).length ? form.sailing_style : null,
      });
      toast.success(mine ? "Crew listing updated." : "You're listed. Fair winds!");
      setShowForm(false);
      await Promise.all([load(), loadMine()]);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  const setStatus = async (status) => {
    setBusy(true);
    try {
      await api.patch("/crew-bank/standalone/status", { status });
      toast.success(status === "found" ? "Marked as found." : "Back to seeking.");
      await Promise.all([load(), loadMine()]);
    } catch { toast.error("Failed"); }
    finally { setBusy(false); }
  };

  const renew = async () => {
    setBusy(true);
    try {
      await api.post("/crew-bank/standalone/renew");
      toast.success("Refreshed — good for another 90 days.");
      await Promise.all([load(), loadMine()]);
    } catch { toast.error("Failed"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm("Remove your standalone crew listing?")) return;
    setBusy(true);
    try {
      await api.delete("/crew-bank/standalone");
      toast.success("Removed.");
      setMine(null);
      setForm(EMPTY);
      await load();
    } catch { toast.error("Failed"); }
    finally { setBusy(false); }
  };

  const canList = !!user && (user.subscription_tier === "premium" || user.subscription_tier === "featured" || user.subscription_tier === "basic");

  const crewMissing = mine ? [
    !mine.experience && "your experience",
    !mine.availability && "your availability",
    !mine.notes && "a note for skippers",
  ].filter(Boolean) : [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="crewbank-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#F2A03B] flex items-center gap-2">
            <Icon name="crew" tone="current" className="h-3.5 w-3.5" /> Standalone Crew Bank
          </div>
          <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl mt-2 tracking-tight">Sailors ready for a boat.</h1>
          <p className="mt-2 text-slate-600 max-w-2xl">Available crew looking for boats to sail or race, outside of any single event. Listings run for 90 days and can be refreshed any time.</p>
          <Link to="/community?type=sailing_opportunity" data-testid="crew-sailing-opps-link"
                className="mt-3 inline-block text-sm font-semibold text-[#55B3AD] hover:underline">
            Looking for a boat? See Sailing Opportunities
          </Link>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/my-crew-listings" data-testid="crewbank-my-crew-listings-link"
                className="inline-flex items-center gap-2 border-2 border-[#1F3F5B] text-[#1F3F5B] rounded-full px-4 py-2 text-sm font-semibold hover:bg-[#1F3F5B]/5">
            <Icon name="layout-list" tone="current" className="h-4 w-4" /> My Crew Listings
          </Link>
          <button onClick={openForm} data-testid="list-yourself-btn"
                  className="inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2.5 font-semibold shadow-sm">
            <Icon name="add" tone="current" className="h-4 w-4" /> {mine ? "Edit my listing" : "List yourself"}
          </button>
        </div>
      </div>

      {mine && (
        <div className="mt-6 bg-white rounded-2xl p-5 border border-[#55B3AD]/30" data-testid="mine-summary">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD]">Your listing</div>
              <div className="mt-1 text-sm text-slate-700">
                Status: <b className={mine.status === "found" ? "text-[#1F3F5B]" : "text-[#F2A03B]"}>{mine.status === "found" ? "Found a boat" : "Seeking"}</b>
                {" · "}Expires in <b>{daysLeft(mine.expires_at) ?? "—"} days</b>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {mine.status === "seeking" ? (
                <button onClick={() => setStatus("found")} disabled={busy} data-testid="mine-mark-found"
                        className="text-sm font-semibold rounded-full border border-[#55B3AD] text-[#1F3F5B] hover:bg-teal-50 px-4 py-2 inline-flex items-center gap-1">
                  <Icon name="success" tone="current" className="h-4 w-4 text-[#55B3AD]" /> Found a boat
                </button>
              ) : (
                <button onClick={() => setStatus("seeking")} disabled={busy} data-testid="mine-mark-seeking"
                        className="text-sm font-semibold rounded-full border border-slate-200 hover:bg-slate-50 px-4 py-2">
                  Re-open (still seeking)
                </button>
              )}
              <button onClick={renew} disabled={busy} data-testid="mine-renew"
                      className="text-sm font-semibold rounded-full border border-slate-200 hover:bg-slate-50 px-4 py-2 inline-flex items-center gap-1">
                <Icon name="rotate" tone="current" className="h-4 w-4" /> Refresh 90d
              </button>
              <button onClick={remove} disabled={busy} data-testid="mine-remove"
                      className="text-sm font-semibold rounded-full border border-red-200 text-red-600 hover:bg-red-50 px-4 py-2 inline-flex items-center gap-1">
                <Icon name="delete" tone="current" className="h-4 w-4" /> Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {mine && crewMissing.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3" data-testid="crew-completeness-hint">
          <Icon name="sparkles" tone="current" className="h-5 w-5 text-[#d98c30] shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-[#92400E] text-sm">Make your crew profile shine</div>
            <p className="text-sm text-amber-800 mt-0.5">Add {crewMissing.join(", ")} so skippers can trust you&rsquo;re ready and reach out.</p>
            <button onClick={openForm} data-testid="crew-hint-complete-btn" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[#d98c30] hover:text-[#b5741f]">
              Complete my listing →
            </button>
          </div>
        </div>
      )}

      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold text-xl text-[#1F3F5B]">Sailors ready for a boat</h2>
          <button onClick={() => setVerifiedOnly((v) => !v)} data-testid="crew-verified-toggle"
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold border transition-colors ${verifiedOnly ? "bg-[#55B3AD] text-white border-[#55B3AD]" : "bg-white text-slate-600 border-slate-200 hover:border-[#55B3AD]"}`}>
            <Icon name="sliders-horizontal" tone="current" className="h-3.5 w-3.5" /> Verified only
          </button>
        </div>
        {loading ? (
          <div className="text-slate-500">Loading…</div>
        ) : data.entries.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center">
            <div className="text-slate-600">No sailors listed{market !== "all" ? ` in ${market}` : ""} yet.</div>
            {canList && !mine && (
              <button onClick={openForm} className="mt-3 text-sm font-semibold text-[#F2A03B] hover:text-[#d98c30]">
                Be the first — list yourself →
              </button>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="standalone-grid">
            {data.entries.map((e) => (
              <article key={e.user_id} onClick={() => setSelected(e)} role="button" tabIndex={0}
                       onKeyDown={(ev) => { if (ev.key === "Enter") setSelected(e); }}
                       className="relative bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md hover:border-[#55B3AD]/40 transition-shadow cursor-pointer"
                       data-testid={`standalone-${e.user_id}`}>
                {user && e.user_id !== user.user_id && (
                  <MessageLink toUserId={e.user_id} testId={`crew-card-message-${e.user_id}`}
                        ariaLabel={`Message ${e.user_name || "sailor"}`} title={`Message ${e.user_name || "sailor"}`}
                        className="absolute top-3 right-3 inline-flex items-center justify-center h-10 w-10 rounded-full border border-slate-200 text-[#1F3F5B] hover:text-[#152a3d] hover:border-[#55B3AD] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#55B3AD]">
                    <Icon name="mail" tone="current" className="h-4 w-4" />
                  </MessageLink>
                )}
                <div className="flex items-center gap-3 pr-12">
                  <Avatar src={e.user_avatar} className="h-11 w-11" alt={e.user_name || ""} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[#1F3F5B] leading-tight truncate flex items-center gap-1">
                      <span className="truncate">{e.user_name}</span>
                      {e.user_verified && <Icon name="verified" tone="current" className="h-3.5 w-3.5 text-[#55B3AD] shrink-0" data-testid={`crew-verified-${e.user_id}`} />}
                    </div>
                    {e.is_complete && <span title="This crew profile has all key details filled in — skippers can trust it's ready." className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-teal-800" data-testid="complete-badge">✓ Complete profile</span>}
                    <div className="text-xs text-slate-500 truncate">{(e.markets || []).slice(0, 3).join(" · ") || e.user_primary_market}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(e.positions || []).slice(0, 6).map((p) => (
                    <span key={p} className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{displayPosition(p)}</span>
                  ))}
                </div>
                {e.availability && <div className="mt-2 text-xs text-slate-500 line-clamp-2"><b className="uppercase tracking-widest text-[10px] text-slate-400 mr-1">Avail</b>{e.availability}</div>}
              </article>
            ))}
          </div>
        )}
      </div>

      <CrewListingPopup
        open={!!selected}
        entry={selected}
        currentUser={user}
        onClose={() => setSelected(null)}
        onEditOwn={() => { setSelected(null); openForm(); }}
      />

      <Modal
        open={showForm}
        onClose={closeForm}
        eyebrow={<><Icon name="crew" tone="current" className="h-3.5 w-3.5" /> Standalone Crew Bank</>}
        title={mine ? "Edit your crew listing" : "List yourself as available crew"}
        testId="standalone-modal"
        footer={
          <>
            <button onClick={() => setShowForm(false)} className="text-slate-600 px-4 py-2 rounded-full hover:bg-slate-100">Cancel</button>
            <button onClick={save} disabled={busy || !canList} data-testid="standalone-save-btn"
                    className="bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2 font-semibold disabled:opacity-50">
              {mine ? "Save changes" : "List me"}
            </button>
          </>
        }
      >
        {!canList ? (
          <div className="p-6">
            <div className="rounded-xl bg-orange-50 border border-orange-100 p-4">
              <div className="flex items-center gap-2 text-[#d98c30] font-semibold text-sm"><Icon name="sparkles" tone="current" className="h-4 w-4" /> Premium members only</div>
              <p className="text-sm text-slate-700 mt-2">Listing yourself in the standalone Crew Bank is a paid feature. Upgrade to get discovered by skippers year-round.</p>
              <Link to="/pricing" className="mt-3 inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-4 py-2 font-semibold text-sm">
                See pricing →
              </Link>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Positions</div>
              <MultiSelectPicker
                label="Positions"
                title="Select positions"
                testId="sa-positions-picker"
                searchable={false}
                options={positionsList.map((p) => ({ value: p, label: p }))}
                value={form.positions}
                onChange={(next) => setForm((s) => ({ ...s, positions: next }))}
                placeholder="Select positions"
                valueLabel={form.positions.length ? form.positions.map(displayPosition).join(", ") : undefined}
                ariaLabel={`Positions: ${form.positions.length ? form.positions.map(displayPosition).join(", ") : "none selected"}`}
              />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Markets you can sail from</div>
              <MultiSelectPicker
                label="Markets"
                title="Markets you can sail from"
                testId="sa-markets-picker"
                ariaLabel={`Markets you can sail from: ${form.markets.length ? form.markets.join(", ") : "none selected"}`}
                searchable={false}
                options={markets.map((m) => ({ value: m, label: m }))}
                value={form.markets}
                onChange={(next) => setForm((s) => ({ ...s, markets: next }))}
                placeholder="Select markets"
                valueLabel={form.markets.length ? form.markets.join(", ") : undefined}
              />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Type of sailing experience</div>
              <MultiSelectPicker
                label="Experience types"
                title="Select experience types"
                testId="sa-exp-picker"
                searchable={false}
                options={expTypesList.map((t) => ({ value: t, label: t }))}
                value={form.experience_types}
                onChange={(next) => setForm((s) => ({ ...s, experience_types: next }))}
                placeholder="Select experience types"
                valueLabel={form.experience_types.length ? form.experience_types.join(", ") : undefined}
                ariaLabel={`Experience types: ${form.experience_types.length ? form.experience_types.join(", ") : "none selected"}`}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Sailing style <span className="normal-case font-semibold text-slate-400">· optional</span></div>
                {Object.keys(form.sailing_style || {}).length > 0 && (
                  <button type="button" data-testid="sa-style-clear" onClick={() => setForm((s) => ({ ...s, sailing_style: {} }))}
                    className="text-xs font-semibold text-[#55B3AD] hover:underline">Clear</button>
                )}
              </div>
              <p className="text-xs text-slate-500 mb-3">Click 1 to 5 to place yourself between each pair.</p>
              {styleAxes.map((ax) => (
                <div key={ax.key} className="mb-3" data-testid={`sa-style-${ax.key}`}>
                  <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                    <span>{ax.low}</span><span>{ax.high}</span>
                  </div>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" onClick={() => setStyleVal(ax.key, n)} data-testid={`sa-style-${ax.key}-${n}`}
                        className={`flex-1 h-8 rounded-lg border text-sm font-bold ${form.sailing_style[ax.key] === n ? "bg-[#55B3AD] text-white border-[#55B3AD]" : "bg-white border-slate-200 text-slate-500 hover:border-[#55B3AD]"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Experience</span>
              <input value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} data-testid="sa-experience"
                     placeholder="e.g. 5 seasons foredeck on J/24s"
                     className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Availability</span>
              <input value={form.availability} onChange={(e) => setForm({ ...form, availability: e.target.value })} data-testid="sa-availability"
                     placeholder="Weekends, Wed nights, extended cruises…"
                     className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Notes for skippers</span>
              <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="sa-notes"
                        placeholder="Anything a skipper should know — gear, references, boats you've sailed…"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
            </label>
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="sa-contact" checked={form.contact_via === "in-app"} onChange={() => setForm({ ...form, contact_via: "in-app" })} />
                In-app DM only
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="sa-contact" checked={form.contact_via === "email"} onChange={() => setForm({ ...form, contact_via: "email" })} />
                Share my email with skippers
              </label>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
