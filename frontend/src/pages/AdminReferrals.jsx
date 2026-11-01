import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const TIER_LABEL = { free: "Free", basic: "Basic", featured: "Featured", premium: "Premium" };

const rewardMailto = (t) => {
  const name = t.referrer_name || "there";
  const subject = "🎉 You've earned a free month on Sail More Now";
  const body = `Hi ${name},\n\nThank you for championing Sail More Now! ${t.paid} of the members you referred upgraded to a paid plan, so you've earned a free month on us — we'll apply the credit to your next invoice.\n\nKeep sharing your link and keep sailing!\n\nFair winds,\nThe Sail More Now Team`;
  return `mailto:${t.referrer_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

export default function AdminReferrals() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [period, setPeriod] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState({});

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    if (user.platform_role !== "admin") { setErr("Admin access required."); return; }
    setExpanded(null);
    setDetail({});
    api.get(`/admin/referrals?period=${period}`)
      .then(({ data }) => setData(data))
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load"));
  }, [user, loading, nav, period]);

  const openDetail = async (ref) => {
    if (expanded === ref) { setExpanded(null); return; }
    setExpanded(ref);
    if (!detail[ref]) {
      try {
        const { data: d } = await api.get(`/admin/referrals/detail?ref=${encodeURIComponent(ref)}&period=${period}`);
        setDetail((m) => ({ ...m, [ref]: d.members || [] }));
      } catch { setDetail((m) => ({ ...m, [ref]: [] })); }
    }
  };

  if (err) return <div className="max-w-5xl mx-auto p-10 text-center text-slate-500 dark:text-slate-400" data-testid="referrals-error">{err}</div>;
  if (!data) return <div className="max-w-5xl mx-auto p-10 text-slate-500 dark:text-slate-400">Loading…</div>;

  const top = data.top || [];
  const recent = data.recent || [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="admin-referrals-page">
      <div className="flex items-center gap-3">
        <Icon name="trophy" tone="current" className="h-7 w-7 text-[#F2A03B]" />
        <div>
          <h1 className="font-display font-extrabold smn-heading text-3xl">Referral leaderboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Ranked by invites that upgraded to a paid plan.</p>
        </div>
      </div>

      <div className="mt-4 inline-flex rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1" data-testid="period-toggle">
        {[["all", "All-time"], ["month", "This month"]].map(([k, label]) => (
          <button key={k} onClick={() => setPeriod(k)} data-testid={`period-${k}`}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${period === k ? "bg-[#1F3F5B] dark:bg-[#F2A03B] text-white" : "text-slate-600 dark:text-slate-300"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5" data-testid="stat-total">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 inline-flex items-center gap-1"><Icon name="crew" tone="current" className="h-3 w-3" /> Referred signups</div>
          <div className="text-3xl font-extrabold smn-heading mt-1">{data.total}</div>
        </div>
        <div className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 p-5" data-testid="stat-paid">
          <div className="text-[10px] font-bold uppercase tracking-widest text-teal-800 dark:text-teal-300 inline-flex items-center gap-1"><Icon name="trending-up" tone="current" className="h-3 w-3" /> Paid conversions</div>
          <div className="text-3xl font-extrabold text-teal-900 dark:text-teal-200 mt-1">{data.paid_conversions}</div>
        </div>
        <div className="rounded-2xl border border-orange-200 dark:border-orange-900 bg-orange-50 dark:bg-orange-950/30 p-5" data-testid="stat-advocates">
          <div className="text-[10px] font-bold uppercase tracking-widest text-orange-800 dark:text-orange-300 inline-flex items-center gap-1"><Icon name="gift" tone="current" className="h-3 w-3" /> Reward-eligible advocates</div>
          <div className="text-3xl font-extrabold text-orange-900 dark:text-orange-200 mt-1">{top.filter((t) => t.reward_eligible).length}</div>
        </div>
      </div>

      <section className="mt-8">
        <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] mb-3">Top advocates</div>
        <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden" data-testid="leaderboard">
          {top.length === 0 && <div className="p-6 text-slate-500 dark:text-slate-400">No referrals recorded yet.</div>}
          {top.map((t, i) => (
            <div key={`${t.ref}-${i}`}>
              <div className="flex items-stretch">
                <button type="button" onClick={() => openDetail(t.ref)} className="flex-1 min-w-0 flex items-center gap-4 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40" data-testid={`leader-${i}`}>
                  <div className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-sm font-extrabold ${i === 0 ? "bg-[#F2A03B] text-[#10233A]" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200"}`}>
                    {i === 0 ? <Icon name="crown" tone="current" className="h-4 w-4" /> : i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold smn-heading truncate flex items-center gap-2">
                      {t.referrer_name || t.ref || "Unknown"}
                      {t.reward_eligible && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-orange-100 text-orange-900" data-testid={`reward-badge-${i}`}>
                          <Icon name="gift" tone="current" className="h-3 w-3" /> Reward
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">ref: {t.ref || "—"}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-extrabold text-teal-900 dark:text-teal-300" data-testid={`leader-paid-${i}`}>{t.paid}</div>
                    <div className="text-[10px] uppercase tracking-widest text-slate-400">paid · {t.count} total</div>
                  </div>
                  <Icon name="chevron-down" tone="current" className={`h-4 w-4 text-slate-400 transition-transform ${expanded === t.ref ? "rotate-180" : ""}`} />
                </button>
                {t.referrer_email && (
                  <a href={rewardMailto(t)} onClick={(e) => e.stopPropagation()} data-testid={`email-reward-${i}`}
                    title={`Email ${t.referrer_name || "advocate"} their reward`}
                    className="shrink-0 px-4 flex items-center gap-2 border-l border-slate-100 dark:border-slate-700 text-[#1F3F5B] dark:text-[#F2A03B] hover:bg-slate-50 dark:hover:bg-slate-700/40 font-semibold text-sm">
                    <Icon name="mail" tone="current" className="h-4 w-4" /> <span className="hidden sm:inline">Email reward</span>
                  </a>
                )}
              </div>
              {expanded === t.ref && (
                <div className="px-4 pb-3 bg-slate-50 dark:bg-slate-900/40" data-testid={`leader-detail-${i}`}>
                  {(detail[t.ref] || []).length === 0 ? (
                    <div className="py-3 text-sm text-slate-500 dark:text-slate-400">{detail[t.ref] ? "No referred members in this window." : "Loading…"}</div>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-700">
                      {(detail[t.ref] || []).map((m, mi) => (
                        <div key={mi} className="flex items-center gap-3 py-2" data-testid={`detail-member-${i}-${mi}`}>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium smn-heading truncate">{m.referred_name || m.referred_email || "Member"}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">{(m.created_at || "").slice(0, 10)}</div>
                          </div>
                          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${m.upgraded ? "bg-teal-100 text-teal-900" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-200"}`}>
                            {m.upgraded ? `Upgraded · ${TIER_LABEL[m.referred_tier] || m.referred_tier}` : "Free"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] mb-3">Recent referred signups</div>
        <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden" data-testid="recent-referrals">
          {recent.length === 0 && <div className="p-6 text-slate-500 dark:text-slate-400">Nothing yet.</div>}
          {recent.map((r, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3" data-testid={`recent-${i}`}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold smn-heading truncate">{r.referred_name || r.referred_email || "New member"}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  invited by {r.referrer_name || r.ref || "someone"} · {(r.created_at || "").slice(0, 10)}
                </div>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full shrink-0 ${r.upgraded ? "bg-teal-100 text-teal-900" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200"}`} data-testid={`recent-tier-${i}`}>
                {r.upgraded ? `Upgraded · ${TIER_LABEL[r.referred_tier] || r.referred_tier}` : "Free"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
