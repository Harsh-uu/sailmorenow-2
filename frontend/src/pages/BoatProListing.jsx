import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import ProfileCardEditor from "@/components/ProfileCardEditor";
import MultiSelectPicker from "@/components/MultiSelectPicker";
import SectionEyebrow from "@/components/SectionEyebrow";

const TIER_MAX_MARKETS = { basic: 1, featured: 2, premium: 999 };
const fmtPhone = (v) => {
  const d = (v || "").replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
};

const CRED_GROUPS = [
  { key: "certifications", label: "Certifications", icon: "award" },
  { key: "licenses", label: "Licenses", icon: "file-check" },
  { key: "insurance", label: "Insurance", icon: "file-check" },
];

// Editable list of short text entries for one credential group (Premium only).
function CredList({ group, items, onChange, inputCls }) {
  const set = (i, v) => onChange(items.map((x, idx) => (idx === i ? v : x)));
  const add = () => onChange([...items, ""]);
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  return (
    <div data-testid={`cred-group-${group.key}`}>
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">
        <Icon name={group.icon} tone="current" className="h-3.5 w-3.5 text-[#55B3AD]" /> {group.label}
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={inputCls} value={it} maxLength={120}
              onChange={(e) => set(i, e.target.value)}
              data-testid={`cred-${group.key}-${i}`}
              placeholder={`Add ${group.label.toLowerCase().replace(/s$/, "")}`} />
            <button type="button" onClick={() => remove(i)} aria-label={`Remove ${group.label} ${i + 1}`}
              data-testid={`cred-${group.key}-remove-${i}`}
              className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">
              <Icon name="delete" tone="current" className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button type="button" onClick={add} data-testid={`cred-${group.key}-add`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2A7871] dark:text-[#7fcac4] hover:underline min-h-[44px]">
          <Icon name="add" tone="current" className="h-4 w-4" /> Add {group.label.toLowerCase().replace(/s$/, "")}
        </button>
      </div>
    </div>
  );
}

export default function BoatProListing() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, refresh } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cats, setCats] = useState([]);
  const [marketsAll, setMarketsAll] = useState([]);
  const [caps, setCaps] = useState({ can_logo: false, can_cover: false, max_photos: 0 });
  const [tier, setTier] = useState("basic");
  const [otherText, setOtherText] = useState("");
  const [emailFallback, setEmailFallback] = useState("");
  const [form, setForm] = useState(null);
  // null = loaded, "pending" = plan active but listing still being set up,
  // "choose" = no plan yet.
  const [noListing, setNoListing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/boat-pros/mine").then(({ data }) => {
      setForm({
        company_name: data.company_name || "",
        business_handle: data.business_handle || "",
        business_email: data.business_email || "",
        contact_email: data.contact_email || "",
        short_bio: data.short_bio || "",
        website: data.website || "",
        contact_phone: data.contact_phone || "",
        categories: data.categories || [],
        markets: data.markets || [],
        certifications: data.certifications || [],
        licenses: data.licenses || [],
        insurance: data.insurance || [],
        logo_url: data.logo_url || "",
        logo_original_url: data.logo_original_url || "",
        cover_url: data.cover_url || "",
        cover_original_url: data.cover_original_url || "",
        photos: data.photos || [],
      });
      setCats(data.categories_all || []);
      setMarketsAll(data.markets_all || []);
      setCaps({ can_logo: !!data.can_logo, can_cover: !!data.can_cover, max_photos: data.max_photos || 0 });
      setTier(data.tier || "basic");
      setEmailFallback(data.business_email_effective || user?.email || "");
    }).catch(async (e) => {
      // No listing yet. Distinguish "plan still activating" (webhook/return-page
      // reconcile in flight) from "no plan chosen", so a paying Boat Pro sees a
      // reassuring setup state with a retry instead of a "choose a plan" gate.
      if (e?.response?.status === 404) {
        try {
          const { data } = await api.get("/payments/subscription");
          setNoListing(data?.is_free ? "choose" : "pending");
        } catch {
          setNoListing("choose");
        }
      } else {
        toast.error(e?.response?.data?.detail || "Couldn't load your listing");
        navigate("/profile");
      }
    }).finally(() => setLoading(false));
  }, [navigate, user]);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const backToDirectory = () => {
    if (location.state?.from === "directory" && (window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate("/directory");
  };

  const onImageChange = async (partial) => {
    const { data } = await api.patch("/boat-pros/listing", partial);
    setForm((f) => ({
      ...f,
      logo_url: data.logo_url || "",
      logo_original_url: data.logo_original_url || "",
      cover_url: data.cover_url || "",
      cover_original_url: data.cover_original_url || "",
      photos: data.photos || [],
    }));
    if (refresh) refresh();
  };

  const save = async () => {
    if (!form.company_name.trim()) { toast.error("Business name is required"); return; }
    const hasOther = form.categories.includes("Other");
    if (hasOther && !otherText.trim()) { toast.error("Describe your category"); return; }
    const categoriesOut = hasOther
      ? form.categories.map((c) => (c === "Other" ? otherText.trim().slice(0, 60) : c))
      : form.categories;
    const payload = {
      company_name: form.company_name, short_bio: form.short_bio, website: form.website,
      business_handle: form.business_handle, business_email: form.business_email,
      contact_email: form.contact_email, contact_phone: form.contact_phone, categories: categoriesOut, markets: form.markets,
    };
    // Credentials are Premium-only; only send them when editable so a lower tier
    // save never trips the server's Premium guard.
    if (isPremium) {
      payload.certifications = (form.certifications || []).map((s) => s.trim()).filter(Boolean);
      payload.licenses = (form.licenses || []).map((s) => s.trim()).filter(Boolean);
      payload.insurance = (form.insurance || []).map((s) => s.trim()).filter(Boolean);
    }
    setSaving(true);
    try {
      await api.patch("/boat-pros/listing", payload);
      toast.success("Saved");
      if (refresh) await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail?.message || e?.response?.data?.detail || "Couldn't save listing");
    } finally { setSaving(false); }
  };

  if (user && user.account_type !== "boat_pro") {
    return <div className="max-w-2xl mx-auto p-10 text-slate-500">Only Boat Pro accounts have a directory listing.</div>;
  }
  if (noListing === "pending") {
    return (
      <div className="bg-[var(--smn-bg)] dark:bg-slate-950 min-h-screen" data-testid="boat-pro-listing-page">
        <div className="max-w-md mx-auto px-6 py-24 text-center" data-testid="pro-listing-setup-state">
          <Icon name="spinner" tone="current" className="mx-auto h-14 w-14 text-[#55B3AD] animate-spin" />
          <h1 className="mt-6 font-display font-extrabold text-2xl text-[#1F3F5B] dark:text-slate-100">Setting up your plan...</h1>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Your payment went through and we're getting your listing ready. This usually takes a few seconds.</p>
          <button onClick={load} data-testid="pro-setup-retry-btn" className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#F2A03B] px-6 py-3 text-sm font-bold text-[#1F3F5B] hover:brightness-105">
            <Icon name="refresh" tone="current" className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>
    );
  }
  if (noListing === "choose") {
    return (
      <div className="bg-[var(--smn-bg)] dark:bg-slate-950 min-h-screen" data-testid="boat-pro-listing-page">
        <div className="max-w-md mx-auto px-6 py-24 text-center" data-testid="pro-no-listing-state">
          <h1 className="font-display font-extrabold text-2xl text-[#1F3F5B] dark:text-slate-100">Your listing is created after your plan is active</h1>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Choose a Boat Pro plan to publish your directory listing. Your business name carries over, and you can fill in the rest here once your plan is active.</p>
          <button onClick={() => navigate("/pricing")} data-testid="pro-choose-plan-btn" className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#F2A03B] px-6 py-3 text-sm font-bold text-[#1F3F5B] hover:brightness-105">
            Choose a plan <Icon name="arrow-right" tone="current" className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }
  if (loading || !form) return <div className="max-w-2xl mx-auto p-10 text-slate-500">Loading…</div>;

  const inputCls = "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none";
  const isPremium = tier === "premium";
  const maxM = TIER_MAX_MARKETS[tier] || 1;

  return (
    <div className="bg-[var(--smn-bg)] dark:bg-slate-950 min-h-screen" data-testid="boat-pro-listing-page">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <button onClick={backToDirectory} data-testid="pro-edit-back" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-[#1F3F5B] dark:hover:text-slate-200 mb-4">
          <Icon name="arrow-left" tone="current" className="h-4 w-4" /> Back to directory
        </button>
        <div className="flex items-center justify-between mb-2">
          <SectionEyebrow>Boat Pro listing</SectionEyebrow>
          {user?.user_id && <Link to={`/directory/${user.user_id}`} className="text-sm font-semibold text-[#55B3AD] hover:underline" data-testid="pro-listing-view-public">View public listing →</Link>}
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-[#1F3F5B] dark:text-slate-100">Edit your public listing</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {caps.can_logo
            ? "Tap the logo, cover, or a gallery slot below to edit your photos. Changes save automatically."
            : "Upgrade to Featured or Premium to add a logo and cover photo to your listing."}
        </p>

        <div className="mt-6">
          <ProfileCardEditor
            data={{
              org_name: form.company_name, handle: form.business_handle || user?.handle,
              logo_url: form.logo_url, logo_original_url: form.logo_original_url,
              cover_url: form.cover_url, cover_original_url: form.cover_original_url,
              photos: form.photos, isCP: false,
            }}
            badgeLabel={String(tier).toUpperCase()}
            showLogo={caps.can_logo}
            showCover={caps.can_cover}
            maxPhotos={caps.max_photos}
            coverAspect={3.5}
            cropObjectFit="cover"
            accent="#1F3F5B"
            onImageChange={onImageChange}
            entityKind="boat_pro"
          />
          {tier === "featured" && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" data-testid="gallery-upgrade-hint">Upgrade to Premium to add a 5-photo work gallery.</p>
          )}
          {tier === "basic" && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" data-testid="photos-upgrade-hint">Upgrade to Featured for a logo and cover photo, or Premium to also add a 5-photo gallery.</p>
          )}
        </div>

        <div className="mt-6 space-y-5">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Business name</label>
            <input className={inputCls} value={form.company_name} onChange={(e) => set("company_name", e.target.value)} data-testid="pro-form-name" maxLength={120} />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Business username</label>
              <div className="flex items-center gap-1">
                <span className="text-slate-400 font-mono">@</span>
                <input className={inputCls} value={form.business_handle} onChange={(e) => set("business_handle", e.target.value.replace(/[^A-Za-z0-9_]/g, ""))} data-testid="pro-form-handle" maxLength={20} placeholder="yourbusiness" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Website</label>
              <input className={inputCls} value={form.website} onChange={(e) => set("website", e.target.value)} data-testid="pro-form-website" placeholder="https://…" />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Public contact email</label>
              <input className={inputCls} value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} data-testid="pro-form-contact-email" placeholder="you@business.com" />
              <p className="mt-1 text-xs text-slate-400" data-testid="pro-form-contact-email-helper">Shown on your public listing. Leave blank to show no email.</p>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Contact phone</label>
              <input className={inputCls} value={form.contact_phone} onChange={(e) => set("contact_phone", fmtPhone(e.target.value))} data-testid="pro-form-phone" placeholder="000-000-0000" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Business email</label>
            <input className={inputCls} value={form.business_email} onChange={(e) => set("business_email", e.target.value)} data-testid="pro-form-email" placeholder={emailFallback || "you@business.com"} />
            <p className="mt-1 text-xs text-slate-400" data-testid="pro-form-email-helper">Private. Reserved for your business identity and not shown on your public listing.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Categories</label>
              <MultiSelectPicker
                label="Categories"
                title="Choose categories"
                testId="pro-form-categories"
                placeholder="Select categories"
                options={cats.map((c) => ({ value: c, label: c }))}
                value={form.categories}
                onChange={(next) => set("categories", next)}
                ariaLabel="Business categories"
              />
              {form.categories.includes("Other") && (
                <input className={`${inputCls} mt-2`} value={otherText} maxLength={60} onChange={(e) => setOtherText(e.target.value)} data-testid="pro-form-other" placeholder="Describe your specialty…" />
              )}
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Markets served</label>
              <MultiSelectPicker
                label="Markets"
                title="Markets served"
                testId="pro-form-markets"
                placeholder="Select markets"
                options={marketsAll.map((m) => ({ value: m, label: m }))}
                value={form.markets}
                onChange={(next) => set("markets", next)}
                max={isPremium ? undefined : maxM}
                limitMessage={`Your plan includes ${maxM} market${maxM !== 1 ? "s" : ""}. Upgrade to add more.`}
                onUpgrade={() => navigate("/pricing?audience=boat_pro")}
                ariaLabel="Markets served"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Short bio</label>
            <textarea className={`${inputCls} resize-none`} rows={5} value={form.short_bio} onChange={(e) => set("short_bio", e.target.value)} data-testid="pro-form-bio" maxLength={2000} placeholder="What you do and where…" />
          </div>

          {/* Trust and credentials — Premium only */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Trust and credentials</label>
            {isPremium ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-5" data-testid="pro-form-credentials">
                {CRED_GROUPS.map((g) => (
                  <CredList key={g.key} group={g} items={form[g.key] || []} inputCls={inputCls}
                    onChange={(next) => set(g.key, next)} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-[#F2A03B]/40 bg-[#F2A03B]/[0.07] p-4 flex items-center gap-3" data-testid="pro-form-credentials-locked">
                <span className="h-10 w-10 shrink-0 rounded-full bg-[#F2A03B]/20 flex items-center justify-center">
                  <Icon name="lock" tone="current" className="h-5 w-5 text-[#F2A03B]" />
                </span>
                <p className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200 leading-snug">Trust and credentials is part of Premium. Upgrade to show yours on your listing.</p>
                <button type="button" onClick={() => navigate("/pricing?audience=boat_pro")} data-testid="pro-credentials-upgrade"
                  className="shrink-0 inline-flex items-center min-h-[44px] rounded-full bg-[#F2A03B] hover:bg-[#d98c30] text-white px-4 text-sm font-bold">Upgrade</button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button onClick={save} disabled={saving} data-testid="pro-form-save"
                    className="inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] disabled:opacity-50 text-white rounded-full px-6 py-2.5 text-sm font-semibold">
              <Icon name="check" tone="current" className="h-4 w-4" /> {saving ? "Saving…" : "Save listing"}
            </button>
            {user?.user_id && (
              <Link to={`/directory/${user.user_id}`} data-testid="pro-form-view-listing"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[#55B3AD] hover:underline">
                View listing <Icon name="arrow-right" tone="current" className="h-4 w-4" />
              </Link>
            )}
            <button onClick={backToDirectory} data-testid="pro-form-cancel" className="text-sm font-semibold text-slate-500 hover:text-[#1F3F5B]">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
