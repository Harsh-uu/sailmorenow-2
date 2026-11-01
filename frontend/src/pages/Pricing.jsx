import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { PRO_IMG, ICON_BOAT_PROS } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import WaveDivider from "@/components/WaveDivider";
import SectionEyebrow from "@/components/SectionEyebrow";
import TestimonialsStrip from "@/components/TestimonialsStrip";
import { loadPackages, pricing, intervalLabel } from "@/lib/plans";
import { loadMatrix, findType, bulletsFor, upgradeBulletsFor, featureRows, isTruthy, valueLabel } from "@/lib/planMatrix";

// Tier order/labels come from the matrix at render; this is only the fallback order.
const PRO_TIER_ORDER = ["basic", "featured", "premium"];

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [pkgs, setPkgs] = useState([]);
  const [audience, setAudience] = useState(params.get("audience") === "boat_pro" ? "boat_pro" : "sailor");
  const paramMonths = Number(params.get("months"));
  const [months, setMonths] = useState([1, 3, 6, 12].includes(paramMonths) ? paramMonths : 1);
  const [selectedTier, setSelectedTier] = useState(
    ["basic", "featured", "premium"].includes(params.get("tier")) ? params.get("tier") : "featured",
  );
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [sub, setSub] = useState(null);
  const [promo, setPromo] = useState("");
  const [promoResult, setPromoResult] = useState(null);
  const [promoBusy, setPromoBusy] = useState(false);

  // Signed-in users see ONLY the packages for their account_type. boat_owner uses
  // the same "sailor" panel (it renders the Boat Owner Premium card). partner and
  // signed-out visitors are not locked — they keep the full audience toggle.
  const lockedAudience = user
    ? ({ sailor: "sailor", boat_owner: "sailor", boat_pro: "boat_pro" }[user.account_type] || null)
    : null;
  useEffect(() => { if (lockedAudience) setAudience(lockedAudience); }, [lockedAudience]);

  useEffect(() => {
    api.get("/payments/mode").then(({ data }) => setMode(data)).catch(() => setMode({ mode: "unknown" }));
    loadPackages().then(setPkgs).catch(() => setPkgs([]));
    loadMatrix().then(setMatrix).catch(() => setMatrix(null));
  }, []);

  useEffect(() => {
    if (!user) { setSub(null); return; }
    api.get("/payments/subscription").then(({ data }) => setSub(data)).catch(() => setSub(null));
  }, [user]);

  // Boat Pro has no 3 month term; clamp if we arrived with one.
  useEffect(() => { if (audience === "boat_pro" && months === 3) setMonths(1); }, [audience, months]);

  const proMonthOptions = [1, 6, 12];
  const sailorMonthOptions = [1, 3, 6, 12];
  const HEADLINES = {
    sailor: "More Sailing. More Often.",
    boat_pro: "Get listed. Get hired.",
    orgs: "Get listed. Gain members.",
  };

  // The pricing audience the backend package list uses (owner is distinct from sailor).
  const pricingAudience = audience === "boat_pro"
    ? "boat_pro"
    : (user?.account_type === "boat_owner" ? "boat_owner" : "sailor");

  const cur = pricing(pkgs, pricingAudience, selectedTier, months);
  const pctForMonth = (m) => { const p = pricing(pkgs, pricingAudience, selectedTier, m); return p ? p.pct : 0; };
  const tierMonthly = (tier) => { const p = pricing(pkgs, "boat_pro", tier, 1); return p ? p.monthly : null; };
  const sailorMonthly = () => { const p = pricing(pkgs, pricingAudience, "premium", 1); return p ? p.monthly : null; };

  const perMonth = cur ? cur.perMonth : null;
  const total = cur ? cur.total : null;
  const discountPct = cur ? cur.pct : 0;
  const intervalLbl = intervalLabel(months);
  const premiumLabel = user?.account_type === "boat_owner" ? "Boat Owner Premium" : "Sailor Premium";

  // Feature bullets come from the matrix (single source of truth), never hardcoded.
  const proType = findType(matrix, "boat_pro");
  const BOAT_PRO_TIERS = (proType?.levels || PRO_TIER_ORDER.map((t) => ({ key: t, label: t })))
    .map((l) => ({ tier: l.key, label: l.label, features: bulletsFor(matrix, "boat_pro", l.key) }));
  // Fixed-order full feature rows (single source of truth) so Basic / Featured /
  // Premium line up row-by-row, with "Not included" where a tier lacks a feature.
  const PRO_ROWS = featureRows(matrix, "boat_pro");
  const SAILOR_FEATURES = upgradeBulletsFor(matrix, "member", "premium", "free");

  // Current-plan awareness for logged-in users.
  const userTier = (user?.subscription_tier || "free").toLowerCase();
  const hasLiveSub = !!(user && sub && !sub.is_free && ["active", "trialing", "past_due"].includes(sub.status));
  const isPremiumMember = ["sailor", "boat_owner", "crew"].includes(user?.account_type) && userTier !== "free";
  // With a live sub we compare the exact package (tier + term) so a term change
  // still shows the switch button; without one we fall back to tier-only.
  const isCurrentSelection = hasLiveSub
    ? !!(cur && cur.packageId === sub.package_id)
    : user && (
      user.account_type === "boat_pro" ? (audience === "boat_pro" && selectedTier === userTier)
        : (audience !== "boat_pro" && audience !== "orgs" && isPremiumMember)
    );
  const currentPlanText = !user ? null
    : user.account_type === "boat_pro" ? (userTier === "free" ? "Boat Pro (free, browse only)" : `Boat Pro ${userTier.charAt(0).toUpperCase()}${userTier.slice(1)}`)
    : user.account_type === "partner" ? ({ community_partner: "Community Partner", founding_partner: "Founding Partner" }[userTier] || "Free organization")
    : (userTier === "free" ? "Free" : "Premium");

  const checkout = async () => {
    if (!user) {
      // Signed-out: send to Create account with the chosen plan + term carried in
      // the URL. The register page finishes sign-up and goes straight to Stripe.
      const qs = new URLSearchParams();
      if (audience === "boat_pro") { qs.set("role", "boat_pro"); qs.set("tier", selectedTier); }
      else { qs.set("role", "sailor"); }
      qs.set("months", String(months));
      if (promo.trim()) qs.set("promo", promo.trim());
      navigate(`/register?${qs.toString()}`);
      return;
    }
    if (!cur) return;
    // Existing subscriber: switch the live subscription (upgrade or scheduled
    // change) instead of opening a second Checkout.
    if (hasLiveSub) { await doSwitch(); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/payments/checkout", {
        package_id: cur.packageId,
        origin_url: window.location.origin,
        promo_code: promoResult && promoResult.valid ? promo.trim() : undefined,
      });
      if (data.promo) {
        window.location.href = data.url;
        return;
      }
      if (data.trial) {
        const price = cur.monthly ? `$${Number(cur.monthly).toFixed(2)}` : "the plan price";
        const disc = `Free for ${data.trial_days} days, then ${price} per month, renews monthly until cancelled. Cancel anytime before your first charge to avoid being charged. By continuing you agree to the Terms.`;
        if (!window.confirm(disc)) { setBusy(false); return; }
      }
      window.location.href = data.url;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Checkout failed");
      setBusy(false);
    }
  };

  const validatePromo = async () => {
    if (!promo.trim() || !cur) return;
    setPromoBusy(true); setPromoResult(null);
    try {
      const { data } = await api.post("/payments/promo/validate", { package_id: cur.packageId, code: promo.trim() });
      setPromoResult({ ...data, valid: true });
    } catch (e) {
      setPromoResult({ valid: false, reason: e?.response?.data?.detail || "That code is not valid." });
    } finally { setPromoBusy(false); }
  };

  const doSwitch = async () => {
    setBusy(true);
    try {
      const { data: pv } = await api.post("/payments/subscription/preview", { package_id: cur.packageId });
      const msg = pv.kind === "upgrade"
        ? `Upgrade to ${pv.to_label}. You'll be charged $${Number(pv.amount_today).toFixed(2)} today, prorated for the rest of this period. Your plan then renews automatically at the new rate. Continue?`
        : `Change to ${pv.to_label}. No charge today. It takes effect on ${pv.effective_at}, when your current plan renews. You keep what you have until then. Continue?`;
      if (!window.confirm(msg)) { setBusy(false); return; }
      const path = pv.kind === "upgrade" ? "/payments/subscription/upgrade" : "/payments/subscription/change";
      await api.post(path, { package_id: cur.packageId });
      toast.success(pv.kind === "upgrade" ? `You're now on ${pv.to_label}.` : `Scheduled: changes to ${pv.to_label} on ${pv.effective_at}.`);
      navigate("/my-plan");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not change your plan.");
      setBusy(false);
    }
  };

  const money = (n) => (n == null ? " - " : `$${n.toFixed(2)}`);

  return (
    <div data-testid="pricing-page" className="bg-[var(--smn-bg)] dark:bg-slate-950">
      <section className="smn-hero text-white -mt-16 pt-24 sm:pt-28 pb-20 relative overflow-hidden">
        <img src="/icon-512.png" alt="" aria-hidden="true" className="hidden sm:block absolute -left-20 -bottom-16 w-[360px] opacity-10 pointer-events-none select-none" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <SectionEyebrow tone="white" className="!text-[#55B3AD] justify-center flex">Pricing</SectionEyebrow>
          <h1 className="font-display font-extrabold text-3xl sm:text-5xl mt-3 tracking-tight" data-testid="pricing-headline">{HEADLINES[audience] || HEADLINES.sailor}</h1>
          <p className="text-slate-200 mt-4 max-w-2xl mx-auto">{audience === "orgs" ? "Free to list your club or organization - upgrade to a Community Partner for more reach." : "Longer commitments unlock better pricing. Cancel any time."}</p>
          {mode?.mode === "test" && (
            <div data-testid="stripe-mode-banner"
                 className="mx-auto max-w-2xl mt-8 rounded-full bg-amber-500/15 border border-amber-300/40 text-amber-100 text-xs font-semibold px-4 py-2 text-center">
              Stripe test mode - no real charges. Use card 4242 4242 4242 4242, any future date, any CVC.
            </div>
          )}
        </div>
      </section>
      <WaveDivider className="text-[#17324a] dark:text-slate-950" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">

      {user && (
        <div data-testid="pricing-loggedin-banner"
             className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#55B3AD]/40 bg-[#55B3AD]/[0.08] dark:bg-[#55B3AD]/[0.12] px-5 py-4">
          <div className="flex items-center gap-2.5 text-sm">
            <Icon name="rocket" tone="current" className="h-5 w-5 text-[#55B3AD]" />
            <span className="smn-heading font-semibold" data-testid="pricing-current-plan">You are on {currentPlanText}.</span>
          </div>
          <Link to="/my-plan" data-testid="pricing-manage-plan"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#1F3F5B] dark:bg-[#F2A03B] text-white px-4 py-2 text-sm font-semibold">
            Manage your plan <Icon name="arrow-right" tone="current" className="h-4 w-4" />
          </Link>
        </div>
      )}

      {!lockedAudience && (
      <div className="mt-8 flex justify-center">
        <div className="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 p-1">
          {["sailor", "boat_pro", "orgs"].map((a) => (
            <button
              key={a}
              onClick={() => { setAudience(a); setMonths(1); }}
              data-testid={`audience-${a}`}
              className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${audience === a ? "bg-[#1F3F5B] dark:bg-[#F2A03B] text-white" : "text-slate-600 dark:text-slate-300"}`}
            >{a === "boat_pro" ? "Boat Pros" : a === "orgs" ? "Clubs & Orgs" : "Sailors & Owners"}</button>
          ))}
        </div>
      </div>
      )}

      {audience === "orgs" ? (
        <div className="mt-10 max-w-2xl mx-auto" data-testid="orgs-panel">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 border-2 border-[#55B3AD] shadow-md text-center">
            <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD]">Clubs & Organizations</div>
            <div className="mt-2 font-display font-extrabold text-4xl smn-heading">Free to join</div>
            <p className="mt-3 text-slate-600 dark:text-slate-300">List your club or org, post events & volunteer opportunities, and grow your membership. Become a Community Partner for messaging, unlimited event posts, and more reach.</p>
            <ul className="mt-6 space-y-2 text-left max-w-sm mx-auto">
              {bulletsFor(matrix, "organization", "free").map((f) => (
                <li key={f} className="text-sm text-slate-700 dark:text-slate-300 flex items-start gap-2"><Icon name="check" tone="current" className="h-4 w-4 mt-0.5 text-[#55B3AD]" /> {f}</li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              {!user && (
                <a href="/register?role=partner" data-testid="orgs-free-signup-btn"
                   className="inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-7 py-3 font-semibold">
                  Sign up free <Icon name="arrow-right" tone="current" className="h-4 w-4" />
                </a>
              )}
              <Link to="/contact?topic=community-partner" data-testid="orgs-contact-btn"
                 className="inline-flex items-center gap-2 border-2 border-[#1F3F5B] dark:border-[#F2A03B] text-[#1F3F5B] dark:text-[#F2A03B] hover:bg-[#1F3F5B]/5 rounded-full px-7 py-3 font-semibold">
                <Icon name="messages" size={16} tone="current" /> Contact us to become a Community Partner
              </Link>
            </div>
          </div>
        </div>
      ) : audience === "boat_pro" ? (
        <>
          <div className="mt-10 grid md:grid-cols-3 gap-6">
            {BOAT_PRO_TIERS.map((t) => {
              const isSel = selectedTier === t.tier;
              const isPremium = t.tier === "premium";
              const base = isPremium ? "bg-[#1F3F5B] text-white border-[#1F3F5B]"
                : `bg-white dark:bg-slate-800 border ${isSel ? "border-[#F2A03B]" : "border-slate-200 dark:border-slate-700"}`;
              const mo = tierMonthly(t.tier);
              return (
                <button
                  key={t.tier}
                  onClick={() => setSelectedTier(t.tier)}
                  data-testid={`tier-${t.tier}`}
                  className={`relative rounded-2xl p-6 text-left transition-all ${base} ${isSel ? "shadow-xl -translate-y-1 ring-4 ring-[#F2A03B] border-[#F2A03B]" : "shadow-sm"}`}
                >
                  <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${isPremium ? "text-[#F2A03B]" : "text-[#55B3AD]"}`}>
                    {t.label}
                    {isSel && (
                      <span data-testid={`tier-selected-${t.tier}`} className="inline-flex items-center gap-1 rounded-full bg-[#F2A03B] text-white px-2 py-0.5 text-[9px]"><Icon name="check" tone="current" className="h-3 w-3" /> Selected</span>
                    )}
                    {user?.account_type === "boat_pro" && t.tier === userTier && (
                      <span data-testid={`tier-current-${t.tier}`} className="rounded-full bg-white/90 text-[#1F3F5B] px-2 py-0.5 text-[9px]">Current</span>
                    )}
                  </div>
                  {months === 1 && mode?.trial_enabled && (
                    <div data-testid={`trial-badge-${t.tier}`} className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[11px] font-bold ${isPremium ? "bg-[#F2A03B] text-white" : "bg-[#55B3AD]/15 text-[#2b7f79] dark:text-[#7fd3cd]"}`}>30 days free</div>
                  )}
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className={`font-display font-extrabold text-4xl ${isPremium ? "text-white" : "smn-heading"}`}>{money(mo)}</span>
                    <span className={`text-sm ${isPremium ? "text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>/mo</span>
                  </div>
                  <ul className="mt-6 space-y-2" data-testid={`tier-features-${t.tier}`}>
                    {PRO_ROWS.map((row) => {
                      const v = row.values[t.tier];
                      const on = isTruthy(v);
                      const offColor = isPremium ? "text-slate-400" : "text-slate-400 dark:text-slate-500";
                      const onColor = isPremium ? "text-slate-100" : "text-slate-700 dark:text-slate-300";
                      return (
                        <li key={row.key} data-testid={`tier-row-${t.tier}-${row.key}`}
                            className={`text-sm flex items-start gap-2 ${on ? onColor : offColor}`}>
                          <Icon name={on ? "check" : "close"} tone="current"
                                className={`h-4 w-4 mt-0.5 ${on ? (isPremium ? "text-[#F2A03B]" : "text-[#55B3AD]") : "opacity-40"}`} />
                          {on
                            ? <span>{v === true ? row.label : `${row.label}: ${valueLabel(v)}`}</span>
                            : <span>{row.label} <span className="opacity-70">- Not included</span></span>}
                        </li>
                      );
                    })}
                  </ul>
                </button>
              );
            })}
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {proMonthOptions.map((m) => (
              <button key={m} onClick={() => setMonths(m)} data-testid={`months-${m}`}
                className={`px-4 py-2 rounded-full text-sm font-semibold border ${months === m ? "bg-[#F2A03B] text-white border-[#F2A03B]" : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-[#F2A03B]"}`}>
                {m} month{m > 1 ? "s" : ""}{pctForMonth(m) > 0 && ` · save ${pctForMonth(m)}%`}
              </button>
            ))}
          </div>

          <div className="mt-8 max-w-3xl mx-auto grid sm:grid-cols-2 gap-4" data-testid="boatpro-comparison-copy">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
              <div className="flex items-start gap-2">
                <Icon name="profile" tone="current" className="h-5 w-5 mt-0.5 text-[#55B3AD]" />
                <div>
                  <div className="font-bold smn-heading text-sm">One login, two sides</div>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">Keep a personal account and a business account under one login, and switch between them any time.</p>
                </div>
              </div>
              <div className="flex items-start gap-2 mt-4">
                <Icon name="activity" tone="current" className="h-5 w-5 mt-0.5 text-[#55B3AD]" />
                <div>
                  <div className="font-bold smn-heading text-sm">Performance stats, every tier</div>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">See your views and contacts on Basic, Featured and Premium.</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border-2 border-[#F2A03B]/50 bg-[#F2A03B]/[0.06] p-5" data-testid="what-premium-adds">
              <div className="text-xs font-bold uppercase tracking-widest text-[#F2A03B]">What Premium adds</div>
              <ul className="mt-3 space-y-2">
                {["Show up first in your category", "Show your work: 5 photos", "List in unlimited markets", "Enhanced listing card", "Trust and credentials"].map((f) => (
                  <li key={f} className="text-sm text-slate-700 dark:text-slate-200 flex items-start gap-2"><Icon name="check" tone="current" className="h-4 w-4 mt-0.5 text-[#F2A03B]" /> {f}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-8 max-w-4xl mx-auto" data-testid="boatpro-card-previews">
            <div className="text-center text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">How your listing looks</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { logo: false, cover: false, gallery: 0, creds: false },
                { logo: true, cover: true, gallery: 0, creds: false },
                { logo: true, cover: true, gallery: 3, creds: true },
              ].map((p, i) => (
                <div key={i} data-testid={`listing-preview-${i}`}
                     className="rounded-2xl overflow-hidden bg-white dark:bg-slate-800 ring-1 ring-black/5 shadow-sm">
                  <div className="w-full bg-[#1F3F5B]" style={{ aspectRatio: "3.5" }}>
                    {p.cover
                      ? <img src={PRO_IMG} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-slate-100 dark:bg-slate-700" />}
                  </div>
                  <div className="p-3 flex items-center gap-3 -mt-6">
                    <div className="h-12 w-12 shrink-0 rounded-full ring-2 ring-white dark:ring-slate-800 overflow-hidden bg-[#55B3AD]/15 flex items-center justify-center">
                      {p.logo
                        ? <img src={ICON_BOAT_PROS} alt="" className="h-8 w-8 object-contain" />
                        : <span className="font-display font-extrabold text-[#2A7871]">HR</span>}
                    </div>
                    <div className="min-w-0 pt-5">
                      <div className="font-display font-bold text-sm smn-heading truncate">Harbor Rigging Co.</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Rigging and repair - Seattle</div>
                    </div>
                  </div>
                  {p.gallery > 0 && (
                    <div className="px-3 pb-2 grid grid-cols-3 gap-1.5">
                      {Array.from({ length: p.gallery }).map((_, g) => (
                        <div key={g} className="rounded-md overflow-hidden" style={{ aspectRatio: "1" }}>
                          <img src={PRO_IMG} alt="" className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                  {p.creds && (
                    <div className="px-3 pb-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#F2A03B]/15 text-[#9a5a12] dark:text-[#F2A03B] text-[10px] font-bold px-2 py-0.5">
                        <Icon name="award" tone="current" className="h-3 w-3" /> Trust and credentials
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="mt-10 max-w-2xl mx-auto">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 border-2 border-[#55B3AD] shadow-md">
            <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD]">{premiumLabel}</div>
            {months === 1 && mode?.trial_enabled && (
              <div data-testid="trial-badge-sailor" className="mt-2 inline-block rounded-full bg-[#55B3AD]/15 text-[#2b7f79] dark:text-[#7fd3cd] px-2.5 py-1 text-[11px] font-bold">30 days free</div>
            )}
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-display font-extrabold text-4xl smn-heading">{money(sailorMonthly())}</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">/month</span>
            </div>
            <ul className="mt-6 space-y-2">
              {SAILOR_FEATURES.map((f) => (
                <li key={f} className="text-sm text-slate-700 dark:text-slate-300 flex items-start gap-2"><Icon name="check" tone="current" className="h-4 w-4 mt-0.5 text-[#55B3AD]" /> {f}</li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-2">
              {sailorMonthOptions.map((m) => (
                <button key={m} onClick={() => setMonths(m)} data-testid={`sailor-months-${m}`}
                  className={`px-4 py-2 rounded-full text-sm font-semibold border ${months === m ? "bg-[#F2A03B] text-white border-[#F2A03B]" : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-[#F2A03B]"}`}>
                  {m} month{m > 1 ? "s" : ""}{pctForMonth(m) > 0 && ` · save ${pctForMonth(m)}%`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {audience !== "orgs" && (
      <div className="mt-10 max-w-xl mx-auto bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-100 dark:border-slate-700 shadow-sm text-center" data-testid="checkout-summary">
        {discountPct > 0 ? (
          <>
            <div className="flex items-center justify-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Your price</span>
              <span data-testid="discount-badge" className="text-[11px] font-bold uppercase tracking-wide bg-[#55B3AD] text-white rounded-full px-2.5 py-0.5">Save {discountPct}%</span>
            </div>
            <div className="mt-2 font-display font-extrabold text-4xl smn-heading" data-testid="per-month-price">{money(perMonth)}<span className="text-base font-bold text-slate-500 dark:text-slate-400">/mo</span></div>
            <div className="text-sm text-slate-500 dark:text-slate-400 mt-1" data-testid="billed-note">billed {money(total)} {intervalLbl}</div>
          </>
        ) : (
          <>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">You'll be charged</div>
            <div className="mt-2 font-display font-extrabold text-4xl smn-heading" data-testid="per-month-price">{money(total)}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">for {months} month{months > 1 ? "s" : ""} of {audience === "boat_pro" ? `Boat Pro ${selectedTier}` : premiumLabel}</div>
          </>
        )}
        {months === 1 && mode?.trial_enabled && !hasLiveSub && !isCurrentSelection && (!promoResult || !promoResult.valid) && (
          <div className="mt-4 rounded-xl bg-[#55B3AD]/[0.08] border border-[#55B3AD]/30 p-3 text-left" data-testid="trial-note">
            <p className="text-sm font-bold smn-heading">30 days free, then {money(total)} per month.</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1" data-testid="card-explanation">
              We ask for a card so your plan continues if you don't cancel. You won't be charged today. We'll email you 3 days before, and you can cancel anytime.
            </p>
          </div>
        )}
        {(user ? (!hasLiveSub && !isCurrentSelection) : true) && months === 1 && (
          <div className="mt-5 text-left border-t border-slate-100 dark:border-slate-700 pt-4" data-testid="promo-box">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Have a promo code?</label>
            <div className="mt-2 flex gap-2">
              <input value={promo} onChange={(e) => { setPromo(e.target.value); setPromoResult(null); }}
                placeholder="Enter code" data-testid="promo-input"
                className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm smn-heading" />
              {user && (
                <button onClick={validatePromo} disabled={promoBusy || !promo.trim()} data-testid="promo-apply"
                  className="px-4 py-2 rounded-xl bg-[#1F3F5B] dark:bg-[#F2A03B] text-white text-sm font-semibold disabled:opacity-50">
                  {promoBusy ? "Checking…" : "Apply"}
                </button>
              )}
            </div>
            {!user && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" data-testid="promo-signup-note">We'll apply this when you create your account. Monthly plans only.</p>
            )}
            {user && promoResult && promoResult.valid && (
              <p className="mt-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400" data-testid="promo-ok">
                Code applied. Free for {promoResult.free_months} months, then ${Number(promoResult.price).toFixed(2)} per month, renews monthly until cancelled. Cancel anytime before {new Date(promoResult.first_charge_date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} to avoid being charged.
              </p>
            )}
            {user && promoResult && !promoResult.valid && (
              <p className="mt-2 text-sm font-semibold text-red-600" data-testid="promo-err">{promoResult.reason}</p>
            )}
          </div>
        )}
        {isCurrentSelection ? (
          <Link to="/my-plan" data-testid="checkout-current-plan"
                className="mt-6 inline-flex items-center gap-2 bg-[#1F3F5B] dark:bg-[#F2A03B] text-white rounded-full px-8 py-3 font-semibold">
            <Icon name="check" tone="current" className="h-4 w-4" /> Current plan - manage
          </Link>
        ) : (
          <button
            onClick={checkout}
            disabled={busy || (!!user && !cur)}
            data-testid="checkout-btn"
            className="mt-6 inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] disabled:opacity-50 text-white rounded-full px-8 py-3 font-semibold"
          >
            <Icon name="sparkles" tone="current" className="h-4 w-4" /> {busy ? "Please wait…" : hasLiveSub ? "Change my plan" : "Checkout with Stripe"}
          </button>
        )}
        {mode?.mode === "test" && (
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-3" data-testid="stripe-test-hint">Test mode - no real charges.</div>
        )}
        {!!user && (
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2" data-testid="pricing-stack-note">Plans auto-renew. Cancel anytime from Your plan.</div>
        )}
      </div>
      )}

      {audience !== "orgs" && !user && (
        <div className="mt-6 text-center" data-testid="free-browse-cta">
          <a href={`/register${audience === "boat_pro" ? "?role=boat_pro" : ""}`} className="inline-flex items-center gap-2 text-sm font-semibold text-[#2A7871] dark:text-[#7fcac4] hover:underline">
            Just want to browse? Sign up for free today <Icon name="arrow-right" tone="current" className="h-4 w-4" />
          </a>
          {audience === "boat_pro" && (
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Free Boat Pro accounts are browse-only - no public directory listing until you pick a plan.</div>
          )}
        </div>
      )}
      </div>
      <TestimonialsStrip />
    </div>
  );
}
