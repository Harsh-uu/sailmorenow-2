import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import WeeklyChart from "@/components/WeeklyChart";
import Sparkline from "@/components/Sparkline";
import AbusePanel from "@/components/AbusePanel";

function StatCard({ testId, label, value, sub, icon, tint = "bg-slate-100 text-slate-700", trend, trendColor }) {
  return (
    <div data-testid={testId} className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
        <span className={`inline-flex items-center justify-center h-8 w-8 rounded-full ${tint}`}>
          <Icon name={icon} tone="current" className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="font-display font-extrabold text-3xl text-[#1F3F5B]">{value}</div>
        {trend && <Sparkline data={trend} color={trendColor} testId={`${testId}-spark`} />}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function BreakdownTable({ testId, title, data }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div data-testid={testId} className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">{title}</div>
      <div className="space-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-sm">
            <span className="text-slate-700">{k}</span>
            <span className="font-bold text-[#1F3F5B]">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminAnalytics() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  const [rev, setRev] = useState(null);
  const [sending, setSending] = useState(false);

  const runDryRun = async () => {
    setSending(true);
    try {
      const { data } = await api.post("/admin/digest/send-now?dry_run=true");
      setDryRun(data);
      toast.success(`${data.would_send} user${data.would_send === 1 ? "" : "s"} would receive a digest right now.`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Dry-run failed"); }
    finally { setSending(false); }
  };
  const sendNow = async () => {
    if (!window.confirm(`Send the Sunday digest now to eligible members? This will email up to ${dryRun?.would_send ?? "?"} users.`)) return;
    setSending(true);
    try {
      const { data } = await api.post("/admin/digest/send-now?dry_run=false");
      toast.success(`Digest sent — ${data.sent_in_last_6d} total sent in the last 6 days.`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Send failed"); }
    finally { setSending(false); }
  };

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    if (user.platform_role !== "admin") { setErr("Admin access required."); return; }
    api.get("/admin/analytics").then(({ data }) => setData(data)).catch((e) => setErr(e?.response?.data?.detail || "Failed to load"));
    api.get("/admin/revenue").then(({ data }) => setRev(data)).catch(() => {});
  }, [user, loading, nav]);

  if (err) return <div className="max-w-3xl mx-auto p-10 text-red-500" data-testid="admin-analytics-error">{err}</div>;
  if (!data) return <div className="max-w-3xl mx-auto p-10 text-slate-500">Loading…</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="admin-analytics-page">
      <div className="flex items-center gap-3 mb-6">
        <Icon name="activity" tone="current" className="h-6 w-6 text-[#55B3AD]" />
        <div>
          <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl tracking-tight">Community pulse</h1>
          <div className="text-xs text-slate-500 mt-1">As of {new Date(data.as_of).toLocaleString()}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard testId="stat-users" label="Members" value={data.users.total}
                  sub={`${data.users.active_last_7d} active this week`} icon="crew" tint="bg-teal-100 text-teal-700"
                  trend={data.weekly?.users} trendColor="#55B3AD" />
        <StatCard testId="stat-posts" label="Feed posts" value={data.posts.total}
                  sub={`+${data.posts.last_7d} this week`} icon="message-square" tint="bg-orange-100 text-orange-700"
                  trend={data.weekly?.posts} trendColor="#F2A03B" />
        <StatCard testId="stat-events" label="Events" value={data.events.total}
                  sub={`${data.events.upcoming} upcoming`} icon="calendar" tint="bg-indigo-100 text-indigo-700"
                  trend={data.weekly?.events} trendColor="#1F3F5B" />
        <StatCard testId="stat-comments" label="Comments" value={data.comments.total}
                  sub={`+${data.comments.last_7d} this week`} icon="message-square" tint="bg-slate-100 text-slate-700"
                  trend={data.weekly?.comments} trendColor="#64748b" />
        <StatCard testId="stat-discussions" label="Discussions" value={data.discussions.total}
                  sub={`${data.discussions.pending} pending approval`} icon="clipboard-check" tint="bg-amber-100 text-amber-700"
                  trend={data.weekly?.discussions} trendColor="#f59e0b" />
        <StatCard testId="stat-reports" label="Open reports" value={data.reports.open}
                  sub={`${data.reports.total} lifetime`} icon="flag" tint="bg-red-100 text-red-700" />
        <StatCard testId="stat-digest" label="Digests sent" value={data.digest.sent_last_30d}
                  sub="last 30 days" icon="send" tint="bg-emerald-100 text-emerald-700"
                  trend={data.weekly?.digest} trendColor="#10b981" />
        <StatCard testId="stat-push" label="Push subscribers" value={data.push.subscribers}
                  sub="active browser devices" icon="bell-ring" tint="bg-purple-100 text-purple-700" />
      </div>

      {rev && (
        <div className="mt-6 bg-gradient-to-br from-[#1F3F5B] to-[#2A5A7A] rounded-2xl p-6 text-white" data-testid="revenue-snapshot">
          <div className="flex items-center gap-2">
            <Icon name="trending-up" tone="current" className="h-5 w-5 text-[#F2A03B]" />
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/70">Revenue snapshot</div>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="font-display font-extrabold text-3xl" data-testid="rev-mrr">${rev.mrr_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="text-xs text-white/60 mt-0.5">Est. monthly (MRR)</div>
            </div>
            <div>
              <div className="font-display font-extrabold text-3xl" data-testid="rev-arr">${rev.arr_total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              <div className="text-xs text-white/60 mt-0.5">Annualized (ARR)</div>
            </div>
            <div>
              <div className="font-display font-extrabold text-3xl" data-testid="rev-active">{rev.active_paid}</div>
              <div className="text-xs text-white/60 mt-0.5">Active paid subs</div>
            </div>
            <div>
              <div className="font-display font-extrabold text-3xl">{rev.total_users}</div>
              <div className="text-xs text-white/60 mt-0.5">Total members</div>
            </div>
          </div>
          {rev.trend && rev.trend.length > 1 && (() => {
            const vals = rev.trend.map((t) => t.amount);
            const max = Math.max(1, ...vals);
            const W = 260, H = 44, step = W / (rev.trend.length - 1);
            const pts = rev.trend.map((t, i) => `${(i * step).toFixed(1)},${(H - (t.amount / max) * (H - 6) - 3).toFixed(1)}`).join(" ");
            return (
              <div className="mt-5 pt-4 border-t border-white/15" data-testid="revenue-trend">
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Collected · last 6 months</div>
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" preserveAspectRatio="none">
                  <polyline points={pts} fill="none" stroke="#F2A03B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  {rev.trend.map((t, i) => (
                    <circle key={i} cx={(i * step).toFixed(1)} cy={(H - (t.amount / max) * (H - 6) - 3).toFixed(1)} r="2.5" fill="#fff" />
                  ))}
                </svg>
                <div className="flex justify-between mt-1">
                  {rev.trend.map((t, i) => <span key={i} className="text-[10px] text-white/50">{t.label}</span>)}
                </div>
              </div>
            );
          })()}
          {rev.by_tier.length > 0 && (
            <div className="mt-5 pt-4 border-t border-white/15 space-y-1.5">
              {rev.by_tier.map((t) => (
                <div key={`${t.account_type}-${t.tier}`} className="flex items-center justify-between text-sm" data-testid={`rev-tier-${t.account_type}-${t.tier}`}>
                  <span className="text-white/80 capitalize">{t.account_type.replace(/_/g, " ")} · {t.tier.replace(/_/g, " ")} <span className="text-white/50">× {t.count}</span></span>
                  <span className="font-semibold">${t.mrr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-3 mt-6">
        <BreakdownTable testId="breakdown-account-type" title="Members by account type" data={data.users.by_account_type} />
        <BreakdownTable testId="breakdown-subscription-tier" title="Members by subscription tier" data={data.users.by_subscription_tier} />
        <BreakdownTable testId="breakdown-events-source" title="Events by source" data={data.events.by_source} />
        <BreakdownTable testId="breakdown-events-market" title="Events by market" data={data.events.by_market} />
        <BreakdownTable testId="breakdown-discussions-kind" title="Discussions by kind" data={data.discussions.by_kind} />
      </div>

      {data.weekly && (
        <div className="grid md:grid-cols-2 gap-3 mt-6" data-testid="weekly-charts">
          {[
            { key: "users", label: "New members", color: "#55B3AD" },
            { key: "posts", label: "New posts", color: "#F2A03B" },
            { key: "events", label: "New events", color: "#1F3F5B" },
            { key: "comments", label: "New comments", color: "#94a3b8" },
            { key: "discussions", label: "New discussions", color: "#f59e0b" },
            { key: "digest", label: "Digests sent", color: "#10b981" },
          ].map((cfg) => (
            <div key={cfg.key} className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">{cfg.label} — last 8 weeks</div>
              <WeeklyChart data={data.weekly[cfg.key] || []} color={cfg.color}
                           emptyLabel={`No ${cfg.label.toLowerCase()} yet.`}
                           testId={`weekly-${cfg.key}`} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 bg-white rounded-2xl border border-slate-100 p-5" data-testid="digest-send-now">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Digest</div>
            <div className="text-lg font-bold text-[#1F3F5B]">Send this week's digest now</div>
            <div className="text-xs text-slate-500 mt-1">
              Dry-run counts eligible members (opt-in + followed markets with content) using the same 6-day dedupe as the Sunday cron.
              Send Now goes through the same claim guard so nobody gets a digest twice.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={runDryRun} disabled={sending} data-testid="digest-dry-run-btn"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#1F3F5B] hover:text-[#152a3d] rounded-full border border-slate-200 px-4 py-2 disabled:opacity-50">
              {sending ? "Working…" : "Dry-run count"}
            </button>
            <button onClick={sendNow} disabled={sending || !dryRun} data-testid="digest-send-btn"
                    className={`inline-flex items-center gap-1 text-xs font-bold rounded-full px-4 py-2 transition-colors ${!dryRun || sending
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                      : "text-white bg-[#F2A03B] hover:bg-[#d9852b]"}`}>
              <Icon name="send" tone="current" className="h-3.5 w-3.5" /> {sending ? "Sending…" : "Send now"}
            </button>
          </div>
        </div>
        {dryRun && (
          <div className="mt-3 text-sm text-slate-700 bg-slate-50 rounded-xl px-3 py-2" data-testid="digest-dry-run-result">
            <b>{dryRun.would_send}</b> user{dryRun.would_send === 1 ? "" : "s"} would receive a digest right now
            ({dryRun.markets_considered} market{dryRun.markets_considered === 1 ? "" : "s"} considered).
          </div>
        )}
        <DigestPreview markets={Object.keys(data.events?.by_market || {})} />
      </div>
      <AbusePanel />
    </div>
  );
}

function DigestPreview({ markets }) {
  const [market, setMarket] = useState(markets[0] || "");
  const [inline, setInline] = useState(false);
  useEffect(() => {
    if (!market && markets.length > 0) setMarket(markets[0]);
  }, [markets, market]);
  useEffect(() => {
    if (!inline) return;
    const onKey = (e) => { if (e.key === "Escape") setInline(false); };
    window.addEventListener("keydown", onKey);
    // Lock background scroll while modal is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [inline]);
  const iframeSrc = market
    ? `${process.env.REACT_APP_BACKEND_URL}/api/admin/digest/render?market=${encodeURIComponent(market)}`
    : "";
  return (
    <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 flex-wrap" data-testid="digest-preview">
      <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Preview email</span>
      <select value={market} onChange={(e) => setMarket(e.target.value)}
              data-testid="digest-preview-market"
              className="text-xs rounded-full border border-slate-200 px-3 py-1.5 bg-white focus:border-[#55B3AD] outline-none">
        {markets.length === 0 && <option value="">No markets yet</option>}
        {markets.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <button onClick={() => setInline(true)} disabled={!market} data-testid="digest-preview-inline-btn"
              className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#1F3F5B] hover:bg-[#152a3d] disabled:opacity-40 rounded-full px-4 py-1.5">
        <Icon name="visibility" tone="current" className="h-3.5 w-3.5" /> Preview inline
      </button>
      <button onClick={() => window.open(iframeSrc, "_blank", "noopener,noreferrer")} disabled={!market}
              data-testid="digest-preview-btn"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#1F3F5B] hover:text-[#152a3d] rounded-full border border-slate-200 px-4 py-1.5 disabled:opacity-40">
        Open in new tab
      </button>
      {inline && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" data-testid="digest-preview-modal"
             role="dialog" aria-modal="true" aria-label="Digest email preview"
             onClick={() => setInline(false)}>
          <div className="bg-white rounded-2xl overflow-hidden w-full max-w-3xl shadow-xl flex flex-col"
               style={{ height: "min(80vh, 720px)" }}
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Digest preview</div>
                <div className="text-sm font-bold text-[#1F3F5B]">{market}</div>
              </div>
              <button onClick={() => setInline(false)} data-testid="digest-preview-close"
                      className="text-slate-400 hover:text-red-500 p-2 rounded-full">
                <Icon name="close" tone="current" className="h-4 w-4" />
              </button>
            </div>
            <iframe title="Digest preview" src={iframeSrc} data-testid="digest-preview-iframe"
                    className="flex-1 w-full bg-slate-50" />
          </div>
        </div>
      )}
    </div>
  );
}
