import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useNavigate, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import WeeklyChart from "@/components/WeeklyChart";
import Sparkline from "@/components/Sparkline";

const STATUSES = ["open", "resolved", "dismissed", "all"];
const TARGET_LABEL = { post: "Post", comment: "Comment", discussion: "Discussion", event: "Event" };

export default function AdminReports() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [reports, setReports] = useState([]);
  const [status, setStatus] = useState("open");
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => api.get(`/admin/reports?status=${status}`)
    .then(({ data }) => { setReports(data.reports || []); setInsights(data.insights || null); })
    .catch((e) => setErr(e?.response?.data?.detail || "Failed to load"));

  const [insights, setInsights] = useState(null);
  const [threshold, setThreshold] = useState(0);
  const [thresholdSaved, setThresholdSaved] = useState(0);
  const [savingT, setSavingT] = useState(false);

  useEffect(() => {
    api.get("/admin/moderation-settings")
      .then(({ data }) => { setThreshold(data.inaccurate_auto_hide_threshold || 0); setThresholdSaved(data.inaccurate_auto_hide_threshold || 0); })
      .catch(() => {});
  }, []);

  const saveThreshold = async () => {
    setSavingT(true);
    try {
      const n = Math.max(0, parseInt(threshold, 10) || 0);
      const { data } = await api.put("/admin/moderation-settings", { inaccurate_auto_hide_threshold: n });
      setThresholdSaved(data.inaccurate_auto_hide_threshold);
      setThreshold(data.inaccurate_auto_hide_threshold);
      toast.success(data.inaccurate_auto_hide_threshold ? `Auto-hide after ${data.inaccurate_auto_hide_threshold} inaccurate reports` : "Inaccurate auto-hide turned off");
    } catch { toast.error("Couldn't save"); }
    finally { setSavingT(false); }
  };

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    if (user.platform_role !== "admin") { setErr("Admin access required."); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, nav, status]);

  const resolve = async (r, opts) => {
    setBusyId(r.id);
    try {
      await api.patch(`/admin/reports/${r.id}`, opts);
      toast.success(opts.status === "resolved" && opts.delete_target
        ? "Resolved and target removed." : (opts.status === "resolved" ? "Resolved." : "Dismissed."));
      load();
    } catch { toast.error("Failed"); }
    finally { setBusyId(null); }
  };

  if (err) return <div className="max-w-3xl mx-auto p-10 text-red-500" data-testid="admin-reports-error">{err}</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="admin-reports-page">
      <div className="flex items-center gap-3 mb-2">
        <Icon name="shield-alert" tone="current" className="h-6 w-6 text-red-500" />
        <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl tracking-tight">Reports queue</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">Member-submitted abuse reports. Resolving with "Remove content" deletes the target and auto-closes duplicate reports.</p>

      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 mb-6" data-testid="moderation-threshold-card">
        <div className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-1">Auto-hide rules</div>
        <p className="text-sm text-slate-600 mb-3">
          <b>Inappropriate</b> reports always hide content immediately. Set how many <b>inaccurate</b> reports should auto-hide an item pending review (0 = never).
        </p>
        <div className="flex items-center gap-3">
          <input type="number" min="0" max="100" value={threshold}
                 onChange={(e) => setThreshold(e.target.value)} data-testid="threshold-input"
                 className="w-24 rounded-xl border border-amber-200 px-3 py-2 text-sm focus:border-amber-400 outline-none" />
          <span className="text-sm text-slate-500">inaccurate reports</span>
          <button onClick={saveThreshold} disabled={savingT || String(threshold) === String(thresholdSaved)} data-testid="threshold-save"
                  className="rounded-full bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white px-5 py-2 text-sm font-semibold">
            {savingT ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {insights && (
        <div className="grid md:grid-cols-2 gap-3 mb-6" data-testid="reports-insights">
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1">Weekly report volume
                {insights.weekly?.some((w) => w.count > 0) && (
                  <Sparkline data={insights.weekly} width={60} height={14} color="#ef4444"
                             testId="reports-weekly-spark" />
                )}
                {(() => {
                  const w = insights.weekly || [];
                  if (w.length < 4) return null;
                  const recent = w.slice(-2).reduce((s, x) => s + x.count, 0);
                  const prior = w.slice(-4, -2).reduce((s, x) => s + x.count, 0);
                  if (recent === 0 && prior === 0) return null;
                  const climbing = recent > prior;
                  return (
                    <span data-testid="reports-trend-badge"
                          className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${climbing ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                      <Icon name="trending-up" tone="current" className={`h-3 w-3 ${climbing ? "" : "rotate-180"}`} /> {climbing ? "climbing" : "cooling"}
                    </span>
                  );
                })()}
              </span>
              <span className="text-slate-400 normal-case tracking-normal font-medium">open · {insights.open_total}</span>
            </div>
            <WeeklyChart data={insights.weekly} color="#ef4444"
                         emptyLabel="No reports in the last 8 weeks."
                         testId="reports-weekly-chart" />
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Most-flagged targets</div>
            <div className="space-y-2" data-testid="reports-top-targets">
              {insights.top_targets.length === 0 && <div className="text-sm text-slate-400">No repeat targets yet.</div>}
              {insights.top_targets.map((t) => (
                <div key={`${t.target_type}-${t.target_id}`} className="flex items-start gap-3 text-sm">
                  <div className="text-xs font-bold text-red-600 shrink-0 w-8">×{t.count}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t.target_type}</div>
                    <div className="text-slate-700 truncate">{t.preview}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} data-testid={`reports-tab-${s}`}
                  className={`text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full border ${status === s ? "bg-[#1F3F5B] text-white border-[#1F3F5B]" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            {s}
          </button>
        ))}
      </div>

      {reports.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center text-slate-500" data-testid="reports-empty">
          Nothing here — nice and quiet.
        </div>
      )}

      <div className="space-y-3">
        {reports.map((r) => {
          const t = r.target;
          const targetLink = r.target_type === "discussion" && t?.id ? `/community-hub/${t.id}` : null;
          const fullText = t ? [t.title, t.body].filter(Boolean).join("\n\n") : "[deleted]";
          return (
            <article key={r.id} data-testid={`report-${r.id}`} className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-red-50 text-red-600 inline-flex items-center gap-1">
                      <Icon name="flag" tone="current" className="h-3 w-3" /> {TARGET_LABEL[r.target_type] || r.target_type}
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${r.status === "open" ? "bg-orange-100 text-orange-700" : r.status === "resolved" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{r.status}</span>
                    {r.category && (
                      <span data-testid={`report-category-${r.id}`} className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${r.category === "inappropriate" ? "bg-red-100 text-red-700" : r.category === "inaccurate" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{r.category}</span>
                    )}
                    {t?.hidden_pending_review && (
                      <span data-testid={`report-hidden-${r.id}`} className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-slate-800 text-white inline-flex items-center gap-1"><Icon name="visibilityOff" tone="current" className="h-3 w-3" /> Hidden</span>
                    )}
                    <span className="text-slate-400">by <b className="text-slate-700">{r.reporter_name || r.reporter_id}</b></span>
                    <span className="text-slate-400">· {new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-[#1F3F5B]">Reason: {r.reason}</div>
                  {r.target_type === "comment" && (
                    <div className="mt-1.5 text-xs text-slate-500" data-testid={`report-parent-${r.id}`}>
                      {r.parent_title
                        ? <>On {r.parent_type || "discussion"}: <b className="text-slate-700">{r.parent_title}</b></>
                        : "Comment text only (parent not found)"}
                    </div>
                  )}
                  <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap break-words" data-testid={`report-body-${r.id}`}>
                    {targetLink ? <Link to={targetLink} className="text-[#1F3F5B] underline">{fullText}</Link> : fullText}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-slate-500">
                    {t?.market !== undefined && <span data-testid={`report-market-${r.id}`}>Market: <b className="text-slate-700">{t?.market || "All markets"}</b></span>}
                    {t?.created_at && <span data-testid={`report-posted-${r.id}`}>· Posted {new Date(t.created_at).toLocaleDateString()}</span>}
                  </div>
                  {t?.author_name && (
                    <div className="mt-1.5 text-xs text-slate-500" data-testid={`report-author-${r.id}`}>
                      Author: <b className="text-slate-700">{t.author_name}</b>
                      {t.author_identity === "business" && t.author_holder_name && (
                        <span className="text-slate-500"> · account holder <b className="text-slate-700">{t.author_holder_name}</b>{t.author_holder_handle ? ` (@${t.author_holder_handle})` : ""}</span>
                      )}
                    </div>
                  )}
                </div>
                {r.status === "open" && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button disabled={busyId === r.id} onClick={() => resolve(r, { status: "dismissed" })}
                            data-testid={`dismiss-${r.id}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-full border border-slate-200 px-3 py-1.5">
                      <Icon name="close" tone="current" className="h-3.5 w-3.5" /> Dismiss
                    </button>
                    <button disabled={busyId === r.id} onClick={() => resolve(r, { status: "resolved" })}
                            data-testid={`resolve-${r.id}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 rounded-full border border-emerald-200 px-3 py-1.5 bg-emerald-50">
                      <Icon name="check" tone="current" className="h-3.5 w-3.5" /> Resolve
                    </button>
                    <button disabled={busyId === r.id || !r.target}
                            onClick={() => window.confirm("Delete the reported content?") && resolve(r, { status: "resolved", delete_target: true })}
                            data-testid={`remove-${r.id}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-full px-3 py-1.5">
                      <Icon name="delete" tone="current" className="h-3.5 w-3.5" /> Remove content
                    </button>
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
