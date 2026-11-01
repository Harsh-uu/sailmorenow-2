import { useEffect, useState, useRef } from "react";
import { Icon } from "@/components/Icon";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { api, errMsg, LOGO_COLOR, LOGO_WHITE, TERMS_URL, PRIVACY_URL } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { loadPackages, pricing, packageIdFor, audienceForAccountType, termOptionsFor } from "@/lib/plans";

const ACCOUNT_TYPES = [
  { key: "sailor", label: "Sailor" },
  { key: "boat_owner", label: "Boat Owner" },
  { key: "boat_pro", label: "Boat Pro" },
  { key: "partner", label: "Club/Org" },
];
const EXTRA = {
  boat_owner: { key: "boat_name", label: "Boat name (optional)" },
  boat_pro: { key: "company_name", label: "Company name" },
  partner: { key: "org_name", label: "Organization / club name" },
};

// Labels + notes only. Prices come from the backend via @/lib/plans.
const PRO_PLANS = [
  { key: "basic", label: "Basic", note: "Basic listing, 1 market, no reviews" },
  { key: "featured", label: "Featured", note: "2 markets, plus company logo" },
  { key: "premium", label: "Premium", note: "Unlimited markets, plus photos, credentials" },
];

const PW_RULES = [
  { key: "len", label: "At least 8 characters", test: (p) => p.length >= 8 },
  { key: "upper", label: "One uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { key: "num", label: "One number", test: (p) => /[0-9]/.test(p) },
  { key: "special", label: "One special character", test: (p) => /[^A-Za-z0-9]/.test(p) },
];
const pwStrong = (p) => PW_RULES.every((r) => r.test(p));

const inputCls =
  "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-[#55B3AD]";

export default function Login() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState(
    params.get("mode") === "register" || (typeof window !== "undefined" && window.location.pathname === "/register")
      ? "register"
      : "login",
  );
  const [markets, setMarkets] = useState([]);
  const [pkgs, setPkgs] = useState([]);
  const [payMode, setPayMode] = useState(null);
  const [promo, setPromo] = useState(params.get("promo") || "");
  const [busy, setBusy] = useState(false);
  const [hp, setHp] = useState("");
  const formStart = useRef(Date.now());
  const [error, setError] = useState(null);
  const [emailError, setEmailError] = useState(null);
  const [checkoutError, setCheckoutError] = useState(false);
  const [show, setShow] = useState(false);
  const initRole = params.get("role") || "";
  const initPlan = initRole === "partner" ? "free"
    : initRole === "boat_pro" ? (["basic", "featured", "premium"].includes(params.get("tier")) ? params.get("tier") : "featured")
      : (initRole === "sailor" || initRole === "boat_owner") ? "premium" : "";
  const paramMonths = Number(params.get("months"));
  const [months, setMonths] = useState([1, 3, 6, 12].includes(paramMonths) ? paramMonths : 1);
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", password: "",
    primary_market: "", account_type: initRole, extra: "", boat_make_model: "",
    newsletter_opt_in: true, agreed_to_guidelines: false, plan: initPlan,
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e?.target ? e.target.value : e });
  const pickType = (key) => {
    const plan = key === "boat_pro" ? "featured" : (key === "sailor" || key === "boat_owner") ? "premium" : "free";
    setForm({ ...form, account_type: key, plan });
  };

  useEffect(() => {
    api.get("/markets").then(({ data }) => setMarkets(data.markets || [])).catch(() => {});
    loadPackages().then(setPkgs).catch(() => setPkgs([]));
    api.get("/payments/mode").then(({ data }) => setPayMode(data)).catch(() => {});
  }, []);

  // Boat Pro has no 3 month term; clamp if we arrived with one.
  useEffect(() => { if (form.account_type === "boat_pro" && months === 3) setMonths(1); }, [form.account_type, months]);

  const planAudience = audienceForAccountType(form.account_type);
  const planTier = form.account_type === "boat_pro" ? form.plan : "premium";
  const isPaidChoice = (form.account_type === "boat_pro" && ["basic", "featured", "premium"].includes(form.plan))
    || ((form.account_type === "sailor" || form.account_type === "boat_owner") && form.plan === "premium");
  const hasCheckoutIntent = !!params.get("months");
  const pricingTarget = () => {
    const qs = new URLSearchParams();
    qs.set("audience", params.get("role") === "boat_pro" ? "boat_pro" : "sailor");
    const t = params.get("tier"); if (t) qs.set("tier", t);
    const m = params.get("months"); if (m) qs.set("months", m);
    return `/pricing?${qs.toString()}`;
  };
  const formPricingTarget = () => {
    const qs = new URLSearchParams();
    qs.set("audience", form.account_type === "boat_pro" ? "boat_pro" : "sailor");
    if (form.account_type === "boat_pro") qs.set("tier", form.plan);
    qs.set("months", String(months));
    return `/pricing?${qs.toString()}`;
  };

  const googleLogin = () => {
    // Remember the chosen plan + term so we return to Pricing pre-selected.
    if (hasCheckoutIntent) { try { sessionStorage.setItem("smn_post_auth", pricingTarget()); } catch {} }
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  // Term chooser (shown once a paid plan is selected). Mirrors the mobile sign-up:
  // monthly price after discount, the term total and the % off for each term.
  const renderTermChooser = () => (
    <div className="space-y-1.5" data-testid="reg-term-chooser">
      <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Choose your term</div>
      {termOptionsFor(planAudience).map((m) => {
        const p = pricing(pkgs, planAudience, planTier, m);
        const sel = months === m;
        return (
          <button type="button" key={m} onClick={() => setMonths(m)} data-testid={`reg-term-${m}`}
            className={`w-full flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left ${sel ? "border-[#F2A03B] bg-[#F2A03B]/10" : "border-slate-200 dark:border-slate-700"}`}>
            <span className="text-sm font-semibold text-[#1F3F5B] dark:text-white">
              {m} month{m > 1 ? "s" : ""}
              {p && p.pct > 0 && <span className="ml-2 text-[11px] font-bold uppercase tracking-wide bg-[#55B3AD] text-white rounded-full px-2 py-0.5">save {p.pct}%</span>}
            </span>
            <span className="text-right text-sm font-extrabold text-[#1F3F5B] dark:text-white shrink-0">
              {p ? `$${p.perMonth.toFixed(2)}` : "—"}<span className="text-[11px] font-normal text-slate-400">/mo</span>
              <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">{p ? `$${p.total.toFixed(2)} total` : ""}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const renderTrialPromo = () => (
    <div className="space-y-2" data-testid="reg-trial-promo">
      {payMode?.trial_enabled && months === 1 && (
        <div className="rounded-xl bg-[#55B3AD]/[0.08] border border-[#55B3AD]/30 p-3">
          <span data-testid="reg-trial-badge" className="inline-block rounded-full bg-[#55B3AD]/15 text-[#2b7f79] dark:text-[#7fd3cd] px-2.5 py-1 text-[11px] font-bold">{payMode.trial_days || 30} days free</span>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2" data-testid="reg-card-explanation">
            We ask for a card so your plan continues if you don't cancel. You won't be charged today. We'll email you 3 days before, and you can cancel anytime.
          </p>
        </div>
      )}
      {months === 1 && (
        <div data-testid="reg-promo-box">
          <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Have a promo code?</label>
          <input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="Enter code" data-testid="reg-promo-input" className={inputCls + " mt-1"} />
          <p className="text-[11px] text-slate-400 mt-1" data-testid="reg-promo-note">We'll apply this when your account is created. Monthly plans only.</p>
        </div>
      )}
    </div>
  );

  const submit = async (e) => {
    e?.preventDefault?.();
    setError(null);
    if (mode === "login") {
      if (!form.email || !form.password) return setError("Enter your email and password");
    } else {
      if (!form.first_name || !form.last_name) return setError("Enter your first and last name");
      if (!form.email) return setError("Enter your email");
      if (!pwStrong(form.password)) return setError("Please choose a stronger password (see the checklist).");
      if (!form.account_type) return setError("Choose an account type");
      if (!form.primary_market) return setError("Choose your home market");
      if (!form.agreed_to_guidelines) return setError("Please confirm you are 18+ and agree to the Code of Conduct.");
    }
    setBusy(true);
    setCheckoutError(false);
    try {
      if (mode === "login") {
        await api.post("/auth/login", { email: form.email.trim(), password: form.password }, { withCredentials: true });
      } else {
        const payload = {
          first_name: form.first_name.trim(), last_name: form.last_name.trim(),
          email: form.email.trim(), password: form.password,
          primary_market: form.primary_market, account_type: form.account_type,
          newsletter_opt_in: form.newsletter_opt_in,
          agreed_to_guidelines: form.agreed_to_guidelines,
          company_website: hp,
          form_elapsed_ms: Date.now() - formStart.current,
        };
        const ex = EXTRA[form.account_type];
        if (ex && form.extra.trim()) payload[ex.key] = form.extra.trim();
        if (form.account_type === "boat_owner" && form.boat_make_model.trim()) payload.boat_make_model = form.boat_make_model.trim();
        const ref = params.get("ref");
        if (ref) payload.referred_by = ref;
        await api.post("/auth/register", payload, { withCredentials: true });
      }
      await refresh();
      toast.success(mode === "login" ? "Welcome back!" : "Welcome aboard!");
      const next = params.get("next") || (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("smn_post_auth") : null);
      const cleanupNext = () => { try { sessionStorage.removeItem("smn_post_auth"); } catch {} };
      if (mode === "register" && isPaidChoice) {
        // Paid sign-up goes STRAIGHT to Stripe for the chosen plan + term. The
        // account type decides the package id; the account is free until paid.
        const pkgId = packageIdFor(planAudience, planTier, months);
        const checkoutBody = { package_id: pkgId, origin_url: window.location.origin };
        if (months === 1 && promo.trim()) checkoutBody.promo_code = promo.trim();
        try {
          const { data } = await api.post("/payments/checkout", checkoutBody);
          cleanupNext();
          window.location.href = data.url;
          return;
        } catch (errc) {
          cleanupNext();
          setCheckoutError(errc?.response?.data?.detail || true);
          setBusy(false);
          return;
        }
      }
      if (mode === "login" && hasCheckoutIntent) {
        // Existing account arriving from the checkout path: return to Pricing
        // with the plan + term pre-selected so one click continues.
        cleanupNext();
        nav(pricingTarget());
        return;
      }
      cleanupNext();
      nav(next && next.startsWith("/") ? next : "/dashboard");
    } catch (e2) {
      if (mode === "register" && e2?.response?.status === 409) {
        setEmailError("An account with this email already exists. Sign in or reset your password.");
      } else {
        setError(errMsg(e2, "Something went wrong"));
      }
    } finally {
      setBusy(false);
    }
  };

  const ex = EXTRA[form.account_type];

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12" data-testid="login-page">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img src={LOGO_COLOR} alt="Sail More Now" className="h-16 sm:h-20 mx-auto object-contain block dark:hidden" />
          <img src={LOGO_WHITE} alt="Sail More Now" className="h-16 sm:h-20 mx-auto object-contain hidden dark:block" />
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm p-6 sm:p-8">
          <div className="flex rounded-full bg-slate-100 dark:bg-slate-800 p-1 mb-6" data-testid="auth-tabs">
            {["login", "register"].map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(null); setEmailError(null); }} data-testid={`auth-tab-${m}`}
                className={`flex-1 py-2 rounded-full text-sm font-semibold transition-colors ${mode === m ? "bg-[#1F3F5B] text-white" : "text-slate-500 dark:text-slate-300"}`}>
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
          <input
            type="text" tabIndex={-1} autoComplete="off" value={hp}
            onChange={(e) => setHp(e.target.value)} name="company_website"
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
          />
            {mode === "register" && (
              <div className="grid grid-cols-2 gap-3">
                <input className={inputCls} placeholder="First name" value={form.first_name} onChange={set("first_name")} data-testid="reg-first-input" />
                <input className={inputCls} placeholder="Last name" value={form.last_name} onChange={set("last_name")} data-testid="reg-last-input" />
              </div>
            )}
            <input className={inputCls + (emailError ? " border-red-400" : "")} type="email" placeholder="Email" value={form.email} onChange={(e) => { set("email")(e); if (emailError) setEmailError(null); }} data-testid="auth-email-input" autoComplete="email" />
            {emailError && <p data-testid="reg-email-error" className="text-xs text-red-500 -mt-1">{emailError}</p>}
            <div className="relative">
              <input className={inputCls + " pr-10"} type={show ? "text" : "password"} placeholder={mode === "register" ? "Password (8+ chars)" : "Password"} value={form.password} onChange={set("password")} data-testid="auth-password-input" autoComplete={mode === "login" ? "current-password" : "new-password"} />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" tabIndex={-1}>
                {show ? <Icon name="visibilityOff" tone="current" className="h-4 w-4" /> : <Icon name="visibility" tone="current" className="h-4 w-4" />}
              </button>
            </div>
            {mode === "login" && (
              <div className="text-right -mt-1">
                <Link to="/forgot-password" data-testid="forgot-password-link" className="text-xs font-semibold text-[#2A7871] dark:text-[#7fcac4] hover:underline">Forgot password?</Link>
              </div>
            )}
            {mode === "register" && (
              <ul className="grid grid-cols-2 gap-1" data-testid="pw-checklist">
                {PW_RULES.map((r) => {
                  const ok = r.test(form.password);
                  return (
                    <li key={r.key} data-testid={`pw-rule-${r.key}`} className={`flex items-center gap-1.5 text-xs ${ok ? "text-[#2A7871] dark:text-[#7fcac4]" : "text-slate-400"}`}>
                      <Icon name={ok ? "success" : "circle"} tone="current" className="h-3.5 w-3.5 shrink-0" /> {r.label}
                    </li>
                  );
                })}
              </ul>
            )}

            {mode === "register" && (
              <>
                <div className="grid grid-cols-2 gap-2" data-testid="reg-type-group">
                  {ACCOUNT_TYPES.map((t) => (
                    <button type="button" key={t.key} onClick={() => pickType(t.key)} data-testid={`reg-type-${t.key}`}
                      className={`rounded-xl border px-3 py-2.5 text-sm font-semibold whitespace-nowrap ${form.account_type === t.key ? "border-[#55B3AD] bg-[#55B3AD]/10 text-[#1F3F5B] dark:text-white" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {form.account_type === "boat_pro" && (
                  <div className="space-y-2" data-testid="reg-plan-pro">
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Choose your listing plan</div>
                    {PRO_PLANS.map((p) => {
                      const mo = pricing(pkgs, "boat_pro", p.key, 1);
                      return (
                        <button type="button" key={p.key} onClick={() => setForm({ ...form, plan: p.key })} data-testid={`reg-plan-${p.key}`}
                          className={`w-full flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left ${form.plan === p.key ? "border-[#F2A03B] bg-[#F2A03B]/10" : "border-slate-200 dark:border-slate-700"}`}>
                          <span className="text-sm font-semibold text-[#1F3F5B] dark:text-white">{p.label}<span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">{p.note}</span></span>
                          <span className="text-sm font-extrabold text-[#1F3F5B] dark:text-white">{mo ? `$${mo.monthly.toFixed(2)}` : "—"}<span className="text-[11px] font-normal text-slate-400">/mo</span></span>
                        </button>
                      );
                    })}
                    {isPaidChoice && renderTermChooser()}
                    <button type="button" onClick={() => setForm({ ...form, plan: "free" })} data-testid="reg-plan-free"
                      className={`text-xs font-semibold ${form.plan === "free" ? "text-[#55B3AD] underline" : "text-slate-500 hover:text-[#55B3AD]"}`}>
                      Or continue with a free account (no business listing)
                    </button>
                  </div>
                )}

                {(form.account_type === "sailor" || form.account_type === "boat_owner") && (
                  <div className="space-y-2" data-testid="reg-plan-sailor">
                    {(() => { const mo = pricing(pkgs, planAudience, "premium", 1); return (
                    <button type="button" onClick={() => setForm({ ...form, plan: "premium" })} data-testid="reg-plan-premium"
                      className={`w-full flex items-center justify-between rounded-xl border px-3.5 py-3 text-left ${form.plan === "premium" ? "border-[#F2A03B] bg-[#F2A03B]/10" : "border-slate-200 dark:border-slate-700"}`}>
                      <span className="text-sm font-semibold text-[#1F3F5B] dark:text-white">Premium<span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">Posting, messaging, Crew Bank & full access</span></span>
                      <span className="text-sm font-extrabold text-[#1F3F5B] dark:text-white">{mo ? `$${mo.monthly.toFixed(2)}` : "—"}<span className="text-[11px] font-normal text-slate-400">/mo</span></span>
                    </button>
                    ); })()}
                    {isPaidChoice && renderTermChooser()}
                    <button type="button" onClick={() => setForm({ ...form, plan: "free" })} data-testid="reg-plan-free"
                      className={`text-xs font-semibold ${form.plan === "free" ? "text-[#55B3AD] underline" : "text-slate-500 hover:text-[#55B3AD]"}`}>
                      Or continue with a free account
                    </button>
                  </div>
                )}

                {form.account_type === "partner" && (
                  <div className="rounded-xl border border-[#55B3AD]/40 bg-[#55B3AD]/5 px-3.5 py-3" data-testid="reg-plan-partner">
                    <div className="text-sm font-semibold text-[#1F3F5B] dark:text-white">Clubs & Orgs join free</div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Become a Community Partner to unlock unlimited postings, direct messaging, priority placement, and more. Upgrade anytime.</p>
                  </div>
                )}
                {isPaidChoice && renderTrialPromo()}
                {ex && (
                  <input className={inputCls} placeholder={ex.label} value={form.extra} onChange={set("extra")} data-testid="reg-extra-input" />
                )}
                {form.account_type === "boat_owner" && (
                  <input className={inputCls} placeholder="Boat make/model (optional)" maxLength={80} value={form.boat_make_model} onChange={set("boat_make_model")} data-testid="reg-boat-make-model-input" />
                )}
                <select className={inputCls} value={form.primary_market} onChange={set("primary_market")} data-testid="reg-market-select">
                  <option value="">Home market…</option>
                  {markets.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 pt-1">
                  <input type="checkbox" checked={form.newsletter_opt_in} onChange={(e) => setForm({ ...form, newsletter_opt_in: e.target.checked })} data-testid="reg-newsletter" />
                  Email me community updates
                </label>
                <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300 pt-1">
                  <input type="checkbox" checked={form.agreed_to_guidelines} onChange={(e) => setForm({ ...form, agreed_to_guidelines: e.target.checked })} data-testid="reg-guidelines" className="mt-0.5" />
                  <span>I am 18 or older and agree to the <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#55B3AD] hover:underline">Terms and Conditions</a>, <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#55B3AD] hover:underline">Privacy Policy</a> and <Link to="/community-guidelines" target="_blank" className="font-semibold text-[#55B3AD] hover:underline">Code of Conduct</Link>.</span>
                </label>
              </>
            )}

            {error && <div className="text-sm text-red-600 font-medium" data-testid="auth-error">{error}</div>}

            {checkoutError && (
              <div data-testid="reg-checkout-error" className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200">
                {typeof checkoutError === "string" ? checkoutError : "Your account is ready, but we could not start checkout just now. Your account stays free for now."}
                <a href={formPricingTarget()} data-testid="reg-checkout-error-btn" className="mt-2 inline-flex items-center gap-1 font-semibold text-[#2A7871] dark:text-[#7fcac4] hover:underline">
                  Go to Pricing to try again <Icon name="arrow-right" tone="current" className="h-4 w-4" />
                </a>
              </div>
            )}

            <button type="submit" disabled={busy} data-testid="auth-submit-btn"
              className="w-full bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full py-3 font-semibold disabled:opacity-60">
              {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
            <span className="text-xs text-slate-400">OR</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
          </div>
          <button onClick={googleLogin} data-testid="auth-google-btn"
            className="w-full inline-flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700 rounded-full py-3 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            <Icon name="anchor" tone="current" className="h-4 w-4 text-[#55B3AD]" /> Continue with Google
          </button>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">
          <Link to="/" className="hover:text-[#55B3AD]">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
