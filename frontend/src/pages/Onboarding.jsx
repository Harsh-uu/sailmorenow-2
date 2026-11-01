import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { LOGO_MARK, TERMS_URL, PRIVACY_URL } from "@/lib/api";

function HandleAvailability({ handle, onSuggest, autofill }) {
  const [state, setState] = useState({ status: "idle" });
  const raw = (handle || "").replace(/^@/, "");
  useEffect(() => {
    if (!raw) { setState({ status: "idle" }); return; }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(raw)) { setState({ status: "invalid" }); return; }
    let cancelled = false;
    setState({ status: "checking" });
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/handle/available?q=${encodeURIComponent(raw)}`);
        if (cancelled) return;
        setState({ status: data.ok ? "available" : (data.reason || "taken"), suggestions: data.suggestions });
      } catch (e) {
        if (cancelled) return;
        // 429 = we've burned the per-IP throttle. Surface it so the user
        // doesn't stare at a blank field wondering if the check hung.
        if (e?.response?.status === 429) setState({ status: "throttled" });
        else setState({ status: "idle" });
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [raw]);
  // Empty state: offer name-derived autofill suggestions so first-time users
  // don't have to think up a handle from scratch.
  if (state.status === "idle") {
    if (!raw && Array.isArray(autofill) && autofill.length > 0) {
      return (
        <div className="mt-1 flex flex-wrap gap-1 items-center" data-testid="handle-autofill">
          <span className="text-[11px] font-semibold text-slate-500 mr-1">Try:</span>
          {autofill.map((s, i) => (
            <button key={s} type="button" onClick={() => onSuggest?.(s)}
                    data-testid={`handle-autofill-${i}`}
                    className="text-[11px] font-mono bg-teal-50 hover:bg-teal-100 text-teal-800 rounded-full px-2 py-0.5">
              @{s}
            </button>
          ))}
        </div>
      );
    }
    return null;
  }
  const map = {
    invalid: { cls: "text-slate-500", text: "3-20 letters, numbers or _" },
    checking: { cls: "text-slate-400", text: "Checking availability…" },
    available: { cls: "text-emerald-600", text: `@${raw} is available ✓` },
    taken: { cls: "text-red-500", text: `@${raw} is already taken` },
    throttled: { cls: "text-amber-600", text: "Too many checks — try again in a moment." },
  };
  const m = map[state.status] || map.invalid;
  return (
    <>
      <span className={`mt-1 block text-[11px] font-semibold ${m.cls}`} data-testid={`handle-availability-${state.status}`}>{m.text}</span>
      {state.status === "taken" && Array.isArray(state.suggestions) && state.suggestions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1" data-testid="handle-suggestions">
          {state.suggestions.map((s, i) => (
            <button key={s} type="button" onClick={() => onSuggest?.(s)}
                    data-testid={`handle-suggestion-${i}`}
                    className="text-[11px] font-mono bg-teal-50 hover:bg-teal-100 text-teal-800 rounded-full px-2 py-0.5">
              @{s}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const AVATARS = ["⛵", "🧭", "🌊", "🛥️", "⚓", "🐋", "🦭", "🏝️", "☀️", "🌤️"];
const TYPES = [
  { id: "boat_owner", label: "Boat Owner", desc: "I have a boat and want to sail more." },
  { id: "sailor", label: "Sailor / Crew", desc: "I want to sail on other boats and meet the community." },
  { id: "boat_pro", label: "Boat Pro", desc: "I offer marine services (rigging, sails, engines, etc.)." },
  { id: "partner", label: "Community Partner", desc: "Club, non-profit, or sailing organization." },
];

export default function Onboarding() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const [markets, setMarkets] = useState([]);
  const [reasonsList, setReasonsList] = useState([]);
  const [form, setForm] = useState({
    account_type: "sailor", primary_market: "", markets: [], reasons: [],
    avatar: "⛵", username: "", bio: "", newsletter_opt_in: true, policies_agreed: false,
  });
  const [saving, setSaving] = useState(false);
  const [autofillHandles, setAutofillHandles] = useState([]);

  // Generate 3 handle candidates from the user's name and confirm they're
  // free with the backend. Runs once when the user object loads so the
  // suggestions are ready before the user tabs into the field.
  useEffect(() => {
    const name = (user?.name || "").trim();
    if (!name) return;
    const base = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14);
    if (!base || base.length < 3) return;
    const first = name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, "").slice(0, 14);
    const seeds = Array.from(new Set([
      base,
      first && first.length >= 3 ? `${first}_pnw` : null,
      `sail_${first || base}`.slice(0, 20),
      `${base}${Math.floor(Math.random() * 89) + 10}`,
    ].filter((x) => x && /^[A-Za-z0-9_]{3,20}$/.test(x))));
    let cancelled = false;
    (async () => {
      const free = [];
      for (const s of seeds) {
        if (free.length >= 3) break;
        try {
          const { data } = await api.get(`/handle/available?q=${encodeURIComponent(s)}`);
          if (cancelled) return;
          if (data?.ok) free.push(s);
          else if (Array.isArray(data?.suggestions)) {
            for (const alt of data.suggestions) {
              if (free.length >= 3) break;
              if (!free.includes(alt)) free.push(alt);
            }
          }
        } catch (e) {
          // Stop probing on 429 so we don't burn the user's throttle budget
          // before they can even type their own handle.
          if (e?.response?.status === 429) break;
        }
      }
      if (!cancelled) setAutofillHandles(free.slice(0, 3));
    })();
    return () => { cancelled = true; };
  }, [user?.name]);

  useEffect(() => {
    api.get("/markets").then(({ data }) => { setMarkets(data.markets); setReasonsList(data.reasons); });
  }, []);
  useEffect(() => { if (user?.onboarding_complete) nav("/dashboard"); }, [user, nav]);

  const toggle = (key, val) => setForm((f) => ({
    ...f, [key]: f[key].includes(val) ? f[key].filter((x) => x !== val) : [...f[key], val],
  }));

  const submit = async () => {
    if (!form.primary_market) return toast.error("Please pick a primary market");
    if (!form.policies_agreed) return toast.error("Please agree to the policies");
    setSaving(true);
    try {
      await api.patch("/auth/onboarding", form);
      await refresh();
      toast.success("Welcome aboard!");
      nav("/dashboard");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally { setSaving(false); }
  };

  return (
    <div className="min-h-screen bg-white" data-testid="onboarding-page">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="flex items-center gap-3">
          <img src={LOGO_MARK} alt="" className="h-10 w-10" />
          <span className="font-display font-extrabold text-[#1F3F5B] text-xl">Sail More Now</span>
        </div>
        <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl mt-8 tracking-tight">Welcome aboard{user?.name ? `, ${user.name.split(" ")[0]}` : ""}.</h1>
        <p className="text-slate-600 mt-2">Tell us a bit about you so we can tailor the community to your waters.</p>

        <section className="mt-10">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">Account type</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setForm((f) => ({ ...f, account_type: t.id }))}
                data-testid={`account-type-${t.id}`}
                className={`text-left p-4 rounded-2xl border-2 transition-colors ${form.account_type === t.id ? "border-[#55B3AD] bg-teal-50/40" : "border-slate-200 hover:border-slate-300"}`}
              >
                <div className="font-display font-bold text-[#1F3F5B]">{t.label}</div>
                <div className="text-sm text-slate-600 mt-1">{t.desc}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">Primary market</div>
          <div className="flex flex-wrap gap-2">
            {markets.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setForm((f) => ({ ...f, primary_market: m }))}
                data-testid={`market-chip-${m}`}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${form.primary_market === m ? "bg-[#1F3F5B] text-white border-[#1F3F5B]" : "bg-white text-slate-700 border-slate-200 hover:border-[#55B3AD]"}`}
              >{m}</button>
            ))}
          </div>
        </section>

        {(form.account_type === "sailor" || form.account_type === "boat_owner") && (
          <section className="mt-8">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">Why are you here?</div>
            <div className="flex flex-wrap gap-2">
              {reasonsList.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggle("reasons", r)}
                  data-testid={`reason-${r}`}
                  className={`px-3 py-1.5 rounded-full text-sm border ${form.reasons.includes(r) ? "bg-[#55B3AD] text-white border-[#55B3AD]" : "bg-white text-slate-700 border-slate-200 hover:border-[#55B3AD]"}`}
                >{r}</button>
              ))}
            </div>
          </section>
        )}

        <section className="mt-8">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">Pick an avatar</div>
          <div className="flex flex-wrap gap-2">
            {AVATARS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setForm((f) => ({ ...f, avatar: a }))}
                data-testid={`avatar-${a}`}
                className={`h-11 w-11 rounded-full text-xl flex items-center justify-center border-2 transition-colors ${form.avatar === a ? "border-[#F2A03B] bg-orange-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
              >{a}</button>
            ))}
          </div>
        </section>

        <section className="mt-8 grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Username (optional)</span>
            <input
              data-testid="username-input"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] focus:ring-2 focus:ring-[#55B3AD]/20 outline-none"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="e.g. captainjane"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">@-username</span>
            <input
              data-testid="handle-input"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] focus:ring-2 focus:ring-[#55B3AD]/20 outline-none font-mono"
              value={form.handle || ""}
              onChange={(e) => setForm({ ...form, handle: e.target.value.replace(/^@/, "") })}
              placeholder="captainjane"
            />
            <HandleAvailability handle={form.handle} onSuggest={(s) => setForm({ ...form, handle: s })} autofill={autofillHandles} />
            <span className="mt-1 block text-[11px] text-slate-500">People will tag you as <b>@{(form.handle || "yourusername").replace(/^@/, "")}</b>. 3-20 letters, numbers or _.</span>
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Short bio (optional)</span>
            <input
              data-testid="bio-input"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] focus:ring-2 focus:ring-[#55B3AD]/20 outline-none"
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              placeholder="e.g. Weekend cruiser on Puget Sound"
            />
          </label>
        </section>

        <section className="mt-8 space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              data-testid="newsletter-checkbox"
              className="mt-1 h-4 w-4 accent-[#55B3AD]"
              checked={form.newsletter_opt_in}
              onChange={(e) => setForm({ ...form, newsletter_opt_in: e.target.checked })}
            />
            <span className="text-sm text-slate-700">
              <span className="block font-semibold text-[#1F3F5B]">Sail More Now — the quarterly digest</span>
              <span className="block text-slate-600 mt-0.5">Sailing and community events, educational information, and featured Boat Pros. One email a quarter, unsubscribe any time.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              data-testid="policies-checkbox"
              className="mt-1 h-4 w-4 accent-[#F2A03B]"
              checked={form.policies_agreed}
              onChange={(e) => setForm({ ...form, policies_agreed: e.target.checked })}
            />
            <span className="text-sm text-slate-700">I agree to the <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#55B3AD] hover:underline">Terms and Conditions</a>, <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#55B3AD] hover:underline">Privacy Policy</a> and <a href="/community-guidelines" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#55B3AD] hover:underline">Code of Conduct</a>.</span>
          </label>
        </section>

        <div className="mt-10 flex justify-end">
          <button
            onClick={submit}
            disabled={saving}
            data-testid="onboarding-submit-btn"
            className="bg-[#F2A03B] hover:bg-[#d98c30] disabled:opacity-50 text-white rounded-full px-8 py-3 font-semibold"
          >{saving ? "Saving…" : "Finish sign-up"}</button>
        </div>
      </div>
    </div>
  );
}
