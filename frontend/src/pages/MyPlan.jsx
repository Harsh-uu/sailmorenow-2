import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Icon } from "@/components/Icon";
import PlanComparison, { MissingList } from "@/components/PlanComparison";
import { loadMatrix, accountTypeKey, findType } from "@/lib/planMatrix";

const TIER_LABEL = { basic: "Basic", featured: "Featured", premium: "Premium" };
const label = (t) => TIER_LABEL[(t || "").toLowerCase()] || (t || "Plan");
const fmtDate = (iso) => {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return "-"; }
};

function MyPlanRow() { return null; }

export default function MyPlan() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [sub, setSub] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [matrix, setMatrix] = useState(null);
  const [pkgs, setPkgs] = useState([]);

  const load = () => api.get("/payments/subscription").then(({ data }) => setSub(data)).catch(() => setSub(null));

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    load();
    loadMatrix().then(setMatrix).catch(() => setMatrix(null));
    api.get("/payments/packages").then(({ data }) => setPkgs(data || [])).catch(() => setPkgs([]));
  }, [user, loading, nav]);

  const [confirmCancel, setConfirmCancel] = useState(false);

  const act = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Something went wrong."); }
    finally { setBusy(false); }
  };
  const doCancel = () => { setConfirmCancel(false); act(() => api.post("/payments/subscription/cancel"), null); };
  const doResume = () => act(() => api.post("/payments/subscription/resume"), "Auto-renewal is back on."); 
  const doUndo = () => act(() => api.post("/payments/subscription/undo-change"), `Kept on your current plan.`);

  const chooseTerm = async (pid, months, price, freeUntil) => {
    if (months === 1) {
      await act(() => api.post("/payments/subscription/choose-term", { package_id: pid }), "Kept on the monthly plan.");
      return;
    }
    const msg = `Start a ${months}-month plan on ${fmtDate(freeUntil)}? You'll be charged $${Number(price).toFixed(2)} once on that date (nothing now), then it renews every ${months} months. You can change or undo this before ${fmtDate(freeUntil)}.`;
    if (!window.confirm(msg)) return;
    await act(() => api.post("/payments/subscription/choose-term", { package_id: pid }), `Set: a ${months}-month plan starts ${fmtDate(freeUntil)}.`);
  };
  const doUndoTerm = () => act(() => api.post("/payments/subscription/undo-term"), "Back to the monthly default.");
  const openPortal = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/payments/portal", { origin_url: window.location.origin });
      if (data.url) window.location.href = data.url;
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not open billing."); }
    finally { setBusy(false); }
  };

  if (!user) return null;

  const typeKey = accountTypeKey(user);
  const type = findType(matrix, typeKey);
  const userTier = (user.subscription_tier || "free").toLowerCase();
  const levelKey = typeKey === "member" ? (userTier === "free" ? "free" : "premium")
    : typeKey === "boat_pro" ? (["basic", "featured", "premium"].includes(userTier) ? userTier : null)
    : (["community_partner", "founding_partner"].includes(userTier) ? userTier : "free");
  const isOrg = typeKey === "organization";
  const isFreeMember = typeKey === "member" && levelKey === "free";

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10" data-testid="my-plan-page">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-full bg-[#55B3AD]/15 text-[#1F3F5B] dark:text-[#7fcac4] flex items-center justify-center">
          <Icon name="rocket" tone="current" className="h-5 w-5" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold smn-heading">My plan</h1>
      </div>

      {sub === undefined ? (
        <div className="mt-8 text-slate-500 dark:text-slate-400" data-testid="plan-loading">Loading...</div>
      ) : (
        <>
          {sub && sub.comp ? (
            <div className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 sm:p-6" data-testid="plan-comp">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD]">Your plan</div>
                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-[#1F3F5B]/10 text-[#1F3F5B] dark:bg-[#F2A03B]/15 dark:text-[#F2A03B]">{label(sub.tier)}</span>
              </div>
              <h2 className="mt-1 text-xl font-extrabold smn-heading" data-testid="plan-comp-name">Complimentary plan</h2>
              <p className="mt-2 text-sm smn-heading font-semibold" data-testid="plan-comp-status">
                You have complimentary {label(sub.tier)} access{sub.end_at ? ` until ${fmtDate(sub.end_at)}` : ", with no end date"}. There is nothing to pay.
              </p>
            </div>
          ) : (!sub || sub.is_free) ? (
            <div className="mt-8 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 sm:p-8 text-center" data-testid="plan-free">
              <p className="smn-heading font-semibold text-lg">
                {isOrg ? "Your organization is on the free plan." : "You're on the free plan."}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
                {isOrg
                  ? "Community Partner and Founding Partner are arranged with our team. See what you unlock below."
                  : "Free is limited. See what Premium unlocks below."}
              </p>
              {isOrg ? (
                <Link to="/contact?topic=community-partner" data-testid="plan-org-contact" className="inline-flex items-center gap-2 mt-5 px-5 py-2.5 rounded-full bg-[#1F3F5B] dark:bg-[#F2A03B] text-white font-semibold">
                  <Icon name="messages" tone="current" className="h-4 w-4" /> Contact us to become a Community Partner
                </Link>
              ) : (
                <Link to="/pricing" data-testid="plan-see-pricing" className="inline-flex items-center gap-2 mt-5 px-5 py-2.5 rounded-full bg-[#1F3F5B] dark:bg-[#F2A03B] text-white font-semibold">
                  <Icon name="sparkles" tone="current" className="h-4 w-4" /> See Premium plans
                </Link>
              )}
            </div>
          ) : (
            <>
              {/* Current plan (Stripe subscription) */}
              <div className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 sm:p-6" data-testid="plan-current">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD]">Your plan</div>
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-[#1F3F5B]/10 text-[#1F3F5B] dark:bg-[#F2A03B]/15 dark:text-[#F2A03B]" data-testid="plan-tier">{label(sub.tier)}</span>
                </div>
                <h2 className="mt-1 text-xl font-extrabold smn-heading" data-testid="plan-name">
                  {user.account_type === "boat_pro" ? `Boat Pro ${label(sub.tier)}` : isOrg ? label(sub.tier) : `${label(sub.tier)} membership`}
                </h2>
                <p className="mt-2 text-sm smn-heading font-semibold" data-testid="plan-status-line">
                  {sub.status === "past_due"
                    ? `We couldn't take your last payment. Update your card to keep ${label(sub.tier)}.`
                    : sub.in_free_period
                    ? `Free until ${fmtDate(sub.free_until)}, first payment $${Number(sub.term_choice ? sub.term_choice.price : sub.price).toFixed(2)} on ${fmtDate(sub.free_until)}.`
                    : sub.status === "trialing"
                    ? `Free trial - your first payment is on ${fmtDate(sub.renews_at)}`
                    : sub.cancel_at_period_end
                    ? `Cancels on ${fmtDate(sub.renews_at)} - you keep ${label(sub.tier)} until then`
                    : sub.scheduled_change
                    ? `Changes to ${sub.scheduled_change.label} on ${fmtDate(sub.scheduled_change.at)}`
                    : `Renews automatically on ${fmtDate(sub.renews_at)}`}
                </p>
                {sub.price != null && !sub.in_free_period && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1" data-testid="plan-price-line">
                    ${Number(sub.price).toFixed(2)} every {sub.interval_months === 1 ? "month" : `${sub.interval_months} months`}
                  </p>
                )}

                {/* Plan-length chooser during the free period (trial or promo) */}
                {sub.in_free_period && (
                  <div className="mt-4 rounded-xl border border-[#55B3AD]/30 bg-[#55B3AD]/5 p-4" data-testid="plan-term-chooser">
                    <div className="text-sm font-bold smn-heading">Your first payment is on {fmtDate(sub.free_until)}. Choose your plan length:</div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Monthly auto-renew is the default if you do nothing. A longer plan has a built-in discount and is charged once on that date. No charge now.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {pkgs.filter((p) => p.audience === user.account_type && p.tier === sub.tier)
                        .sort((a, b) => a.months - b.months)
                        .map((p) => {
                          const chosen = sub.term_choice ? sub.term_choice.package_id === p.package_id
                            : p.months === 1;
                          const save = p.discount ? ` · save ${Math.round(p.discount * 100)}%` : "";
                          return (
                            <button key={p.package_id} disabled={busy}
                              onClick={() => chooseTerm(p.package_id, p.months, p.total, sub.free_until)}
                              data-testid={`plan-term-${p.months}`}
                              className={`px-3 py-2 rounded-xl border text-sm font-semibold disabled:opacity-50 ${chosen ? "bg-[#1F3F5B] dark:bg-[#F2A03B] text-white border-transparent" : "border-slate-200 dark:border-slate-700 smn-heading"}`}>
                              {p.months === 1 ? "Monthly" : `${p.months} months`} · ${Number(p.total).toFixed(2)}{save}
                            </button>
                          );
                        })}
                    </div>
                    {sub.term_choice && (
                      <div className="mt-3 text-sm smn-heading" data-testid="plan-term-chosen">
                        Starting {fmtDate(sub.term_choice.at)}: a {sub.term_choice.months}-month plan at ${Number(sub.term_choice.price).toFixed(2)}.
                        <button onClick={doUndoTerm} disabled={busy} data-testid="plan-term-undo" className="ml-2 underline text-[#1F3F5B] dark:text-[#F2A03B] disabled:opacity-50">Undo</button>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                {sub.provider === "stripe" && sub.can_manage && (
                  <div className="mt-4 flex flex-wrap gap-2" data-testid="plan-actions">
                    {user.account_type === "boat_pro" && sub.tier !== "premium" && (
                      <Link to="/pricing" data-testid="plan-upgrade" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1F3F5B] dark:bg-[#F2A03B] text-white text-sm font-semibold">
                        <Icon name="sparkles" tone="current" className="h-4 w-4" /> Upgrade
                      </Link>
                    )}
                    <Link to="/pricing" data-testid="plan-change" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 smn-heading text-sm font-semibold">
                      <Icon name="refresh" tone="current" className="h-4 w-4 text-[#55B3AD]" /> Change plan
                    </Link>
                    {sub.cancel_at_period_end ? (
                      <button onClick={doResume} disabled={busy} data-testid="plan-resume" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">
                        <Icon name="refresh" tone="current" className="h-4 w-4" /> Resume auto-renewal
                      </button>
                    ) : (
                      <button onClick={() => setConfirmCancel(true)} disabled={busy} data-testid="plan-cancel" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-red-200 text-red-600 text-sm font-semibold disabled:opacity-50">
                        <Icon name="close" tone="current" className="h-4 w-4" /> Cancel plan
                      </button>
                    )}
                    <button onClick={openPortal} disabled={busy} data-testid="plan-portal" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 smn-heading text-sm font-semibold disabled:opacity-50">
                      <Icon name="mail" tone="current" className="h-4 w-4 text-[#55B3AD]" /> {sub.status === "past_due" ? "Update payment method" : "Manage billing"}
                    </button>
                  </div>
                )}

                {/* Cancel confirm */}
                {confirmCancel && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 p-4" data-testid="plan-cancel-confirm">
                    <p className="text-sm smn-heading">Cancel auto-renewal? You'll keep {label(sub.tier)} until {fmtDate(sub.renews_at)}, then move to the free plan. No further charges.</p>
                    <div className="mt-3 flex gap-2">
                      <button onClick={doCancel} disabled={busy} data-testid="plan-cancel-confirm-btn" className="px-4 py-2 rounded-full bg-red-600 text-white text-sm font-semibold disabled:opacity-50">Cancel auto-renewal</button>
                      <button onClick={() => setConfirmCancel(false)} data-testid="plan-cancel-keep" className="px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 smn-heading text-sm font-semibold">Keep {label(sub.tier)}</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Scheduled downgrade banner */}
              {sub.scheduled_change && (
                <div className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-[#55B3AD]/5 p-4 sm:p-5" data-testid="plan-scheduled">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 text-sm font-semibold smn-heading">
                      <Icon name="clock" tone="current" className="h-4 w-4 text-[#55B3AD]" />
                      Scheduled: changes to {sub.scheduled_change.label} on {fmtDate(sub.scheduled_change.at)}.
                    </div>
                    <button onClick={doUndo} disabled={busy} data-testid="plan-undo-change" className="text-sm font-semibold text-[#1F3F5B] dark:text-[#F2A03B] underline disabled:opacity-50">Undo change</button>
                  </div>
                </div>
              )}
            </>

          )}

          {/* What's included - matrix comparison for EVERY account type */}
          {matrix && type && (
            <div className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 sm:p-6" data-testid="plan-included">
              {isFreeMember && (
                <div className="mb-4 rounded-xl bg-[#F2A03B]/[0.08] border border-[#F2A03B]/30 p-4" data-testid="plan-free-reminder">
                  <div className="text-sm font-bold smn-heading">Free is limited. Here's what Premium adds:</div>
                  <div className="mt-2"><MissingList type={type} currentLevel="free" compareLevel="premium" /></div>
                </div>
              )}
              <PlanComparison type={type} currentLevel={levelKey} />
              {isOrg && (
                <div className="mt-4 border-t border-slate-100 dark:border-slate-700 pt-4" data-testid="plan-org-footer">
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    Organizations cannot buy in app. Community Partner and Founding Partner are arranged by our team. Founding Partner is limited to the first 5 organizations in Portland/Vancouver and the first 5 in Greater Seattle.
                  </p>
                  {levelKey !== "founding_partner" && (
                    <Link to="/contact?topic=community-partner" data-testid="plan-org-contact-footer" className="inline-flex items-center gap-2 mt-3 px-5 py-2.5 rounded-full bg-[#1F3F5B] dark:bg-[#F2A03B] text-white font-semibold text-sm">
                      <Icon name="messages" tone="current" className="h-4 w-4" /> Contact us to become a Community Partner
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
