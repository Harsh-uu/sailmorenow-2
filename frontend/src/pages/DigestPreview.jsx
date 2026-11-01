import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useNavigate, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import Avatar from "@/components/Avatar";
import usePushNotifications from "@/hooks/usePushNotifications";
import PushPreferencesPanel from "@/components/PushPreferencesPanel";

export default function DigestPreview() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState("");
  const push = usePushNotifications();

  useEffect(() => {
    api.get("/markets").then(({ data }) => setMarkets(data.markets)).catch(() => {});
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    setError(null);
    setData(null);
    const params = selectedMarket ? { market: selectedMarket } : {};
    api.get("/digest/preview", { params })
      .then(({ data }) => {
        setData(data);
        if (!selectedMarket) setSelectedMarket(data.market);
      })
      .catch((e) => setError(e?.response?.data?.detail || "Failed to load preview"));
  }, [user, loading, nav, selectedMarket]);

  const toggle = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const next = !data.newsletter_opt_in;
      await api.patch("/auth/newsletter", { newsletter_opt_in: next });
      setData({ ...data, newsletter_opt_in: next });
      toast.success(next ? "You're subscribed. See you Sunday!" : "Unsubscribed. No more digests.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  if (!user) return null;
  if (error) return <div className="max-w-3xl mx-auto p-10 text-center text-slate-500">{error}</div>;
  if (!data) return <div className="max-w-3xl mx-auto p-10 text-slate-500">Loading…</div>;

  const isPrimary = data.market === user.primary_market;
  const history = data.send_history || [];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="digest-preview-page">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#F2A03B] flex items-center gap-2">
            <Icon name="mail" tone="current" className="h-3.5 w-3.5" /> Sunday digest preview
          </div>
          <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl mt-2 tracking-tight">Your week in {data.market}.</h1>
          <p className="mt-2 text-slate-600 max-w-2xl">This is what would land in your inbox on Sunday morning if we sent right now. Toggle off any time to opt out.</p>
          <div className="mt-4 flex items-center gap-2 flex-wrap" data-testid="digest-market-picker">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Preview market:</span>
            <select
              value={selectedMarket}
              onChange={(e) => setSelectedMarket(e.target.value)}
              data-testid="digest-market-select"
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-[#55B3AD] outline-none"
            >
              {markets.map((m) => (
                <option key={m} value={m}>{m}{m === user.primary_market ? " (yours)" : ""}</option>
              ))}
            </select>
            {!isPrimary && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-slate-100 text-slate-500">Scouting</span>
            )}
          </div>
          <button
            onClick={() => nav("/clubs")}
            data-testid="digest-following-pill"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#55B3AD]/15 text-[#2A7871] dark:text-[#7fcac4] px-4 py-2 text-sm font-semibold hover:bg-[#55B3AD]/25 transition-colors"
          >
            <Icon name="org" tone="current" className="h-4 w-4" /> Following - latest from people and orgs you follow
            <Icon name="arrow-right" tone="current" className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shrink-0" data-testid="digest-opt-toggle-card">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Delivery</div>
          <label className="mt-2 flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={data.newsletter_opt_in} onChange={toggle} disabled={busy} data-testid="digest-opt-toggle" />
            <span className="text-sm font-semibold text-[#1F3F5B]">
              {data.newsletter_opt_in ? "Subscribed" : "Unsubscribed"}
            </span>
          </label>
          {data.last_sent_at && (
            <div className="mt-2 text-[11px] text-slate-400">Last sent {new Date(data.last_sent_at).toLocaleDateString()}</div>
          )}
        </div>
      </div>

      <div className="mt-6 grid md:grid-cols-2 gap-3" data-testid="digest-recap">
        <div className="rounded-2xl bg-white border border-slate-100 p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] flex items-center gap-1.5">
            <Icon name="history" tone="current" className="h-3.5 w-3.5" /> Recent sends
          </div>
          {history.length === 0 ? (
            <div className="mt-2 text-sm text-slate-500">No digests sent yet. Your first one lands on Sunday.</div>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {history.slice().reverse().slice(0, 6).map((iso) => {
                const eng = data.engagement?.[iso] || {};
                const chip = eng.clicked_at ? { label: "clicked", cls: "bg-teal-100 text-[#1F3F5B]" }
                              : eng.opened_at ? { label: "opened", cls: "bg-orange-100 text-[#d98c30]" }
                              : { label: "delivered", cls: "text-slate-400" };
                return (
                  <li key={iso} className="flex items-center justify-between border-b border-slate-50 last:border-0 pb-1 last:pb-0" data-testid={`send-${iso.slice(0,10)}`}>
                    <span>{new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${chip.cls}`}>{chip.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-2 text-[11px] text-slate-400">Open/click stats update when your inbox pings the Resend webhook.</div>
        </div>
        <div className="rounded-2xl bg-white border border-slate-100 p-4" data-testid="digest-push-card">
          <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] flex items-center gap-1.5">
            <Icon name="notifications" tone="current" className="h-3.5 w-3.5" /> Browser push
          </div>
          {!push.supported ? (
            <div className="mt-2 text-sm text-slate-500">Not supported in this browser.</div>
          ) : push.subscribed ? (
            <>
              <div className="mt-2 text-sm text-slate-700">You&apos;ll get instant alerts for DMs, comments, and review requests — no waiting for Sunday.</div>
              <PushPreferencesPanel testId="digest-push-preferences" />
              <button onClick={push.unsubscribe} disabled={push.busy} data-testid="push-off-btn"
                      className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 text-sm font-semibold">
                <Icon name="bell-off" tone="current" className="h-4 w-4" /> Turn off
              </button>
            </>
          ) : (
            <>
              <div className="mt-2 text-sm text-slate-700">Turn on browser push for DMs, comments, and review requests. Opt out any time.</div>
              <button onClick={push.subscribe} disabled={push.busy} data-testid="push-on-btn"
                      className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#F2A03B] hover:bg-[#d98c30] text-white px-4 py-2 text-sm font-semibold">
                <Icon name="notifications" tone="current" className="h-4 w-4" /> Turn on push
              </button>
            </>
          )}
        </div>
      </div>

      {data.empty && (
        <div className="mt-6 rounded-2xl border border-orange-100 bg-orange-50 p-5 flex items-start gap-3" data-testid="digest-empty">
          <Icon name="sparkles" tone="current" className="h-5 w-5 text-[#F2A03B] shrink-0" />
          <div>
            <div className="font-semibold text-[#d98c30]">Quiet week in {data.market}</div>
            <p className="text-sm text-slate-700 mt-1">No new sailors listed, no fresh events, no new comments in the last 7 days. If it stays quiet, we skip sending — nothing lands in your inbox.</p>
          </div>
        </div>
      )}

      <section className="mt-8" data-testid="digest-section-crew">
        <div className="flex items-center gap-2 text-[#1F3F5B]">
          <Icon name="crew" tone="current" className="h-4 w-4" />
          <h2 className="font-display font-bold text-lg">New sailors ready for a boat</h2>
          <span className="text-xs text-slate-400">({data.new_crew.length})</span>
        </div>
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          {data.new_crew.length === 0 && <div className="text-sm text-slate-500">No new listings this week.</div>}
          {data.new_crew.map((c) => (
            <div key={c.user_id} className="bg-white rounded-xl border border-slate-100 p-3 flex items-center gap-3" data-testid={`digest-crew-${c.user_id}`}>
              <Avatar src={c.user_avatar} className="h-9 w-9" alt={c.user_name || ""} />
              <div className="min-w-0">
                <div className="font-semibold text-[#1F3F5B] truncate">{c.user_name}</div>
                <div className="text-xs text-slate-500 truncate">{(c.positions || []).slice(0, 4).join(" · ") || "Any position"}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8" data-testid="digest-section-events">
        <div className="flex items-center gap-2 text-[#1F3F5B]">
          <Icon name="events" tone="current" className="h-4 w-4" />
          <h2 className="font-display font-bold text-lg">Fresh events</h2>
          <span className="text-xs text-slate-400">({data.new_events.length})</span>
        </div>
        <div className="mt-3 space-y-2">
          {data.new_events.length === 0 && <div className="text-sm text-slate-500">No new events on the calendar.</div>}
          {data.new_events.map((e) => (
            <div key={e.id} className="bg-white rounded-xl border border-slate-100 p-3" data-testid={`digest-event-${e.id}`}>
              <div className="font-semibold text-[#1F3F5B]">{e.title}</div>
              <div className="text-xs text-slate-500 mt-0.5">{(e.starts_at || "").slice(0, 10)} · {e.location || e.market}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8" data-testid="digest-section-comments">
        <div className="flex items-center gap-2 text-[#1F3F5B]">
          <Icon name="message-square" tone="current" className="h-4 w-4" />
          <h2 className="font-display font-bold text-lg">Community chatter</h2>
        </div>
        <div className="mt-2 text-sm text-slate-700">
          <b>{data.new_comments}</b> new comment{data.new_comments === 1 ? "" : "s"} across {isPrimary ? "your market" : data.market}&apos;s feed this week.
        </div>
      </section>

      <section className="mt-8" data-testid="digest-section-saved">
        <div className="flex items-center gap-2 text-[#1F3F5B]">
          <Icon name="bookmark" tone="current" className="h-4 w-4" />
          <h2 className="font-display font-bold text-lg">Your saved items</h2>
          <span className="text-xs text-slate-400">({(data.saved || []).length})</span>
        </div>
        <div className="mt-3 space-y-2">
          {(data.saved || []).length === 0 && <div className="text-sm text-slate-500">Nothing saved yet. Bookmark posts, listings, forum topics or blogs to see them here.</div>}
          {(data.saved || []).map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-4 py-2.5" data-testid={`digest-saved-${s.id}`}>
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-slate-100 text-slate-600 shrink-0">{s.label}</span>
              <Link to={s.url || "/community"} className="text-sm font-semibold text-[#1F3F5B] truncate hover:underline" data-testid={`digest-saved-link-${s.id}`}>{s.title}</Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
