import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import ProfileCardEditor from "@/components/ProfileCardEditor";
import MultiSelectPicker from "@/components/MultiSelectPicker";
import SectionEyebrow from "@/components/SectionEyebrow";

export default function OrgListing() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cats, setCats] = useState([]);
  const [marketsAll, setMarketsAll] = useState([]);
  const [maxPhotos, setMaxPhotos] = useState(1);
  const [isCP, setIsCP] = useState(false);
  const [status, setStatus] = useState("free");
  const [form, setForm] = useState(null);

  useEffect(() => {
    api.get("/org-listing/mine").then(({ data }) => {
      const l = data.listing;
      setForm({
        org_name: l.org_name || l.name || "",
        handle: l.handle || "",
        website: l.website || "",
        public_email: l.public_email || "",
        public_phone: l.public_phone || "",
        bio: l.bio || "",
        logo_url: l.logo_url || "",
        logo_original_url: l.logo_original_url || "",
        cover_url: l.cover_url || "",
        cover_original_url: l.cover_original_url || "",
        org_categories: l.org_categories || [],
        primary_market: l.primary_market || "",
        markets: l.markets || [],
        photos: l.photos || [],
      });
      setCats(data.org_categories_all || []);
      setMarketsAll(data.markets_all || []);
      setMaxPhotos(data.max_photos || 1);
      setIsCP(!!data.is_community_partner);
      setStatus(data.status || "free");
    }).catch((e) => {
      toast.error(e?.response?.data?.detail || "Couldn't load your listing");
      navigate("/profile");
    }).finally(() => setLoading(false));
  }, [navigate]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // "Contact us" for the gallery upsell: use the in-app contact form.
  const handleContact = () => {
    navigate("/contact");
  };

  // Auto-save a single image action (logo / cover / gallery) immediately, independent
  // of the text-field Save button. Throws on failure so the card shows Try again.
  const onImageChange = async (partial) => {
    const { data } = await api.put("/org-listing", partial);
    const l = data.listing;
    setForm((f) => ({
      ...f,
      logo_url: l.logo_url || "",
      logo_original_url: l.logo_original_url || "",
      cover_url: l.cover_url || "",
      cover_original_url: l.cover_original_url || "",
      photos: l.photos || [],
    }));
    if (refresh) refresh();
  };

  const save = async () => {
    if (!form.org_name.trim()) { toast.error("Organization name is required"); return; }
    setSaving(true);
    try {
      const { data } = await api.put("/org-listing", form);
      toast.success("Directory listing updated");
      if (refresh) await refresh();
      const h = data?.listing?.handle || form.handle;
      if (h) navigate(`/u/${h}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save listing");
    } finally { setSaving(false); }
  };

  if (user && user.account_type !== "partner") {
    return <div className="max-w-2xl mx-auto p-10 text-slate-500">Only Club/Org accounts have a directory listing.</div>;
  }
  if (loading || !form) return <div className="max-w-2xl mx-auto p-10 text-slate-500">Loading…</div>;

  const inputCls = "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none";

  const accent = isCP ? "#1F3F5B" : "#2A7871";

  return (
    <div className="bg-[var(--smn-bg)] dark:bg-slate-950 min-h-screen" data-testid="org-listing-page">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex items-center justify-between mb-2">
          <SectionEyebrow>Directory listing</SectionEyebrow>
          {form.handle && <Link to={`/u/${form.handle}`} className="text-sm font-semibold text-[#55B3AD] hover:underline" data-testid="org-listing-view-public">View public profile →</Link>}
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-[#1F3F5B] dark:text-slate-100">Edit your public directory listing</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Tap the logo, banner, or a gallery slot below to edit your photos. Changes save automatically.</p>

        <div className="mt-6">
          <ProfileCardEditor
            data={{ ...form, isCP }}
            maxPhotos={maxPhotos}
            accent={accent}
            onImageChange={onImageChange}
            coverAspect={3.5}
            cropObjectFit="cover"
            galleryLocked={!isCP}
            badgeLabel={status === "founding_partner" ? "Founding Partner" : status === "community_partner" ? "Community Partner" : "Club / Org"}
            onContactUs={handleContact}
          />
        </div>

        <div className="mt-6 space-y-5">

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Organization / club name <span className="text-slate-400 normal-case">(linked to your account)</span></label>
            <input className={inputCls} value={form.org_name} onChange={(e) => set("org_name", e.target.value)} data-testid="org-form-name" maxLength={120} />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Username</label>
              <div className="flex items-center gap-1">
                <span className="text-slate-400 font-mono">@</span>
                <input className={inputCls} value={form.handle} onChange={(e) => set("handle", e.target.value.replace(/[^A-Za-z0-9_]/g, ""))} data-testid="org-form-handle" maxLength={20} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Website</label>
              <input className={inputCls} value={form.website} onChange={(e) => set("website", e.target.value)} data-testid="org-form-website" placeholder="https://…" />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Public email</label>
              <input className={inputCls} value={form.public_email} onChange={(e) => set("public_email", e.target.value)} data-testid="org-form-email" placeholder="hello@club.org" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Public phone</label>
              <input className={inputCls} value={form.public_phone} onChange={(e) => set("public_phone", e.target.value)} data-testid="org-form-phone" placeholder="(206) 555-0100" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Categories</label>
              <MultiSelectPicker
                label="Categories"
                title="Choose categories"
                testId="org-form-categories"
                placeholder="Select categories"
                options={cats.map((c) => ({ value: c, label: c }))}
                value={form.org_categories}
                onChange={(next) => set("org_categories", next)}
                ariaLabel="Organization categories"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Primary market</label>
              <MultiSelectPicker
                single
                label="Primary market"
                title="Primary market"
                testId="org-form-primary-market"
                placeholder="Select…"
                options={marketsAll.map((m) => ({ value: m, label: m }))}
                value={form.primary_market ? [form.primary_market] : []}
                onChange={(next) => set("primary_market", next[0] || "")}
                ariaLabel="Primary market"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Markets served</label>
              <MultiSelectPicker
                label="Markets"
                title="Markets served"
                testId="org-form-markets"
                placeholder="Select markets"
                options={marketsAll.map((m) => ({ value: m, label: m }))}
                value={form.markets}
                onChange={(next) => set("markets", next)}
                ariaLabel="Markets served"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Bio / description</label>
            <textarea className={`${inputCls} resize-none`} rows={5} value={form.bio} onChange={(e) => set("bio", e.target.value)} data-testid="org-form-bio" maxLength={2000} placeholder="Tell visitors about your club or organization…" />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button onClick={save} disabled={saving} data-testid="org-form-save"
                    className="inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] disabled:opacity-50 text-white rounded-full px-6 py-2.5 text-sm font-semibold">
              <Icon name="check" tone="current" className="h-4 w-4" /> {saving ? "Saving…" : "Save listing"}
            </button>
            <Link to="/profile" className="text-sm font-semibold text-slate-500 hover:text-[#1F3F5B]">Cancel</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
