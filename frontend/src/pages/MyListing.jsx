import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Icon } from "@/components/Icon";
import Sparkline from "@/components/Sparkline";
import LogoCircle from "@/components/LogoCircle";

function Delta({ arr }) {
  const [open, setOpen] = useState(false);
  if (!arr || arr.length < 2) return null;
  const d = arr[arr.length - 1].count - arr[arr.length - 2].count;
  const up = d > 0;
  const cls = d === 0 ? "text-slate-400" : up ? "text-emerald-600 dark:text-emerald-400" : "text-red-500";
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen((o) => !o)} data-testid="compare-toggle" className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${cls}`}>
        {d !== 0 && (up ? <Icon name="arrow-up" tone="current" className="h-3 w-3" /> : <Icon name="arrow-down" tone="current" className="h-3 w-3" />)}
        {d === 0 ? "no change" : Math.abs(d)} vs last month
      </button>
      {open && (
        <div className="mt-1 flex flex-wrap gap-1.5" data-testid="compare-breakdown">
          {arr.map((b, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{b.month} {b.count}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MyListing() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [pro, setPro] = useState(undefined); // undefined=loading, null=none
  const [err, setErr] = useState(false);
  const [insights, setInsights] = useState(null);
  const [months, setMonths] = useState(6);

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    setErr(false);
    api.get("/boat-pros/mine")
      .then(({ data }) => setPro(data))
      .catch((e) => { if (e?.response?.status === 404) setPro(null); else { setErr(true); setPro(null); } });
  }, [user, loading, nav]);

  useEffect(() => {
    if (!user) return;
    api.get(`/boat-pros/insights?months=${months}`).then(({ data }) => setInsights(data)).catch(() => {});
  }, [user, months]);

  const tier = pro?.tier || user?.subscription_tier || "basic";
  const done = pro ? [pro.company_name, pro.short_bio, (pro.categories || []).length, (pro.markets || []).length, (pro.photos || []).length >= 3].filter(Boolean).length : 0;
  const pct = Math.round((done / 5) * 100);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8" data-testid="my-listing-page">
      <div className="flex items-center gap-3">
        <LogoCircle
          src={pro?.logo_url}
          size="h-12 w-12"
          alt={pro?.company_name || "Your listing"}
          testId="listing-logo"
          className="border border-slate-200 dark:border-slate-700"
          fallback={<span className="font-display font-bold text-lg smn-heading">{(pro?.company_name || user?.name || "P")[0]}</span>}
        />
        <div>
          <h1 className="text-2xl font-extrabold smn-heading">My Listing</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="listing-tier">Boat Pro · {String(tier).toUpperCase()} plan</p>
        </div>
      </div>

      {/* Insights */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">Performance</h2>
        <div className="inline-flex rounded-full border border-slate-200 dark:border-slate-700 p-1" data-testid="range-toggle">
          {[6, 12].map((m) => (
            <button key={m} onClick={() => setMonths(m)} data-testid={`range-${m}`} className={`px-3 py-1 rounded-full text-xs font-bold transition ${months === m ? "bg-[#1F3F5B] dark:bg-[#F2A03B] text-white" : "text-slate-500 dark:text-slate-400"}`}>{m}M</button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5" data-testid="insight-views">
          <Icon name="visibility" tone="current" className="h-5 w-5 text-teal-600 dark:text-teal-300" />
          <div className="mt-2 text-3xl font-extrabold smn-heading">{insights?.views_this_month ?? "—"}</div>
          <div className="text-xs uppercase tracking-widest text-slate-400 mt-1">Views this month</div>
          <Delta arr={insights?.views_by_month} />
          <div className="mt-2"><Sparkline data={insights?.views_by_month || []} width={120} height={28} testId="views-sparkline" /></div>
          <div className="text-[10px] text-slate-400 mt-0.5">Last {months} months</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5" data-testid="insight-contacts">
          <Icon name="message-square" tone="current" className="h-5 w-5 text-[#F2A03B]" />
          <div className="mt-2 text-3xl font-extrabold smn-heading">{insights?.contacts_this_month ?? "—"}</div>
          <div className="text-xs uppercase tracking-widest text-slate-400 mt-1">People contacted you</div>
          <Delta arr={insights?.contacts_by_month} />
          <div className="mt-2"><Sparkline data={insights?.contacts_by_month || []} color="#F2A03B" width={120} height={28} testId="contacts-sparkline" /></div>
          <div className="text-[10px] text-slate-400 mt-0.5">Last {months} months</div>
        </div>
      </div>

      {pro === undefined && !err ? (
        <div className="mt-6 text-slate-500 dark:text-slate-400" data-testid="listing-loading">Loading…</div>
      ) : err ? (
        <div className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 text-center" data-testid="listing-error">
          <p className="smn-heading font-semibold">We couldn&apos;t load your listing.</p>
          <button onClick={() => { setPro(undefined); setErr(false); api.get("/boat-pros/mine").then(({ data }) => setPro(data)).catch((e) => { if (e?.response?.status === 404) setPro(null); else { setErr(true); setPro(null); } }); }}
                  data-testid="listing-retry" className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#1F3F5B] dark:bg-[#F2A03B] text-white font-semibold">Retry</button>
        </div>
      ) : pro === null ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-8 text-center" data-testid="listing-none">
          <p className="smn-heading font-semibold text-lg">Your listing is created after your plan is active.</p>
          <Link to="/pricing" data-testid="choose-plan-link" className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-full bg-[#1F3F5B] dark:bg-[#F2A03B] text-white font-semibold">
            <Icon name="rocket" size={16} tone="current" /> Choose a plan
          </Link>
        </div>
      ) : (
        <>
          {String(tier).toLowerCase() !== "premium" && (
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-[#F2A03B]/40 bg-[#F2A03B]/5 p-4" data-testid="listing-upgrade-nudge">
              <Icon name="sparkles" tone="current" className="h-5 w-5 text-[#F2A03B] mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold smn-heading">
                  {String(tier).toLowerCase() === "basic" ? "Add a logo, cover photo, gallery and credentials" : "Unlock your photo gallery and credentials"}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Upgrade your tier to stand out in the directory. Pay only the difference for the time left.</p>
                <Link to="/my-plan" data-testid="listing-see-included" className="inline-flex items-center gap-1 mt-2 text-sm font-semibold text-[#1F3F5B] dark:text-[#F2A03B]">
                  See what&apos;s included <Icon name="chevron-right" tone="current" className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          )}
          {pct < 100 && (
            <div className="mt-6 flex items-center gap-3 text-sm" data-testid="completeness-line">
              <span className="text-slate-500 dark:text-slate-400">Profile completeness</span>
              <div className="flex-1 h-1.5 max-w-[160px] rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className="h-full rounded-full bg-[#55B3AD]" style={{ width: `${pct}%` }} />
              </div>
              <span className="font-bold text-[#1F3F5B] dark:text-[#F2A03B]" data-testid="completeness-pct">{pct}%</span>
              <Link to="/profile" data-testid="completeness-finish" className="font-semibold text-[#1F3F5B] dark:text-[#F2A03B] inline-flex items-center gap-0.5">Finish <Icon name="chevron-right" tone="current" className="h-3.5 w-3.5" /></Link>
            </div>
          )}
          <div className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6" data-testid="listing-card">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-extrabold smn-heading">{pro.company_name}</h2>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-orange-100 text-orange-900">{String(tier)}</span>
            </div>
            {pro.short_bio && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{pro.short_bio}</p>}
            <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <div className="flex items-center gap-2"><Icon name="tag" tone="current" className="h-4 w-4 text-teal-600 dark:text-teal-300" /> {(pro.categories || []).join(", ") || "No specialties yet"}</div>
              <div className="flex items-center gap-2"><Icon name="location" tone="current" className="h-4 w-4 text-teal-600 dark:text-teal-300" /> {(pro.markets || []).join(", ") || "No markets yet"}</div>
              <div className="flex items-center gap-2"><Icon name="images" tone="current" className="h-4 w-4 text-teal-600 dark:text-teal-300" /> {(pro.photos || []).length} photos</div>
            </div>
          </div>

          <div className="mt-4 grid sm:grid-cols-2 gap-3">
            <Link to={`/directory/${pro.user_id || user.user_id}`} data-testid="view-public-listing-link" className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#1F3F5B] dark:bg-slate-700 text-white font-semibold"><Icon name="external-link" tone="current" className="h-4 w-4" /> View public listing</Link>
            <Link to="/my-plan" data-testid="manage-plan-link" className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 smn-heading font-semibold"><Icon name="rocket" tone="current" className="h-4 w-4 text-[#F2A03B]" /> Manage plan</Link>
          </div>
        </>
      )}
    </div>
  );
}
