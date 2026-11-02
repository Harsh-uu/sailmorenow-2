import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Icon } from "@/components/Icon";
import { useNavigate, Link } from "react-router-dom";
import Avatar from "@/components/Avatar";
import LogoCircle from "@/components/LogoCircle";
import CropModal from "@/components/CropModal";
import { compressImageToDataURL } from "@/lib/imageCompress";
import Modal from "@/components/Modal";
import PushPreferencesPanel from "@/components/PushPreferencesPanel";
import SavedSection from "@/components/SavedSection";
import DeleteListingButton from "@/components/DeleteListingButton";
import DeleteAccountSection from "@/components/DeleteAccountSection";
import { SAILING_ICONS } from "@/components/ProfilePhotoEditor";
import { api, TERMS_URL, PRIVACY_URL } from "@/lib/api";
import { toast } from "sonner";

function SupportContactForm({ user }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const valid = subject.trim().length > 0 && message.trim().length >= 10;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await api.post("/support/contact", { subject: subject.trim(), message: message.trim() });
      setSent(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send your message. Please try again.");
    } finally { setBusy(false); }
  };
  if (sent) return (
    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 text-center" data-testid="support-contact-sent">
      <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
        <Icon name="check" tone="current" className="h-6 w-6 text-emerald-600" />
      </div>
      <p className="text-slate-700 font-medium">Thank you for contacting us. We will respond to your inquiry within 48 hours.</p>
    </div>
  );
  return (
    <div data-testid="support-contact-form">
      <p className="text-xs text-slate-500 mb-3">Sending as <b className="text-[#1F3F5B]">{user.name}</b> ({user.email})</p>
      <div className="flex flex-wrap gap-2 mb-3" data-testid="support-subject-presets">
        {["Billing", "Bug", "Feedback", "Other"].map((p) => (
          <button key={p} type="button" onClick={() => setSubject(p)} data-testid={`support-preset-${p.toLowerCase()}`}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors ${subject === p ? "bg-[#1F3F5B] text-white border-[#1F3F5B]" : "bg-white border-slate-200 text-slate-600 hover:border-[#55B3AD]"}`}>
            {p}
          </button>
        ))}
      </div>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="support-subject"
             placeholder="Subject" maxLength={120}
             className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm" />
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} data-testid="support-message"
                rows={5} placeholder="How can we help? Share as much detail as you can…" maxLength={4000}
                className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm resize-none" />
      <button onClick={submit} disabled={!valid || busy} data-testid="support-submit"
              className="mt-3 inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] disabled:opacity-50 text-white rounded-full px-6 py-2.5 text-sm font-semibold">
        <Icon name="send" tone="current" className="h-4 w-4" /> {busy ? "Sending…" : "Send message"}
      </button>
    </div>
  );
}

function TestimonialForm({ user }) {
  const [quote, setQuote] = useState("");
  const [role, setRole] = useState((user.account_type || "").replace(/_/g, " "));
  const [market, setMarket] = useState(user.primary_market || "");
  const [showName, setShowName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const valid = quote.trim().length >= 10 && quote.trim().length <= 280;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await api.post("/testimonials", { quote: quote.trim(), role: role.trim(), market: market.trim(), show_name: showName });
      setSent(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't submit. Please try again.");
    } finally { setBusy(false); }
  };
  if (sent) return (
    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 text-center" data-testid="testimonial-sent">
      <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
        <Icon name="check" tone="current" className="h-6 w-6 text-emerald-600" />
      </div>
      <p className="text-slate-700 font-medium">Thanks for sharing! Your testimonial is pending review and will appear once approved.</p>
    </div>
  );
  return (
    <div data-testid="testimonial-form">
      <p className="text-xs text-slate-500 mb-3">Tell other sailors what you love about Sail More Now.</p>
      <textarea value={quote} onChange={(e) => setQuote(e.target.value.slice(0, 280))} data-testid="testimonial-quote"
                rows={3} placeholder="Share a short quote (up to 280 characters)…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm resize-none" />
      <div className="text-xs text-slate-400 text-right mt-1" data-testid="testimonial-count">{quote.trim().length}/280</div>
      <div className="grid sm:grid-cols-2 gap-3 mt-2">
        <input value={role} onChange={(e) => setRole(e.target.value)} data-testid="testimonial-role"
               placeholder="Your role (e.g. Sailor)" maxLength={60}
               className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm" />
        <input value={market} onChange={(e) => setMarket(e.target.value)} data-testid="testimonial-market"
               placeholder="Your market (e.g. Greater Seattle)" maxLength={80}
               className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm" />
      </div>
      <label className="flex items-center gap-2 mt-3 text-sm text-slate-600 cursor-pointer" data-testid="testimonial-showname-label">
        <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} data-testid="testimonial-showname"
               className="h-4 w-4 rounded border-slate-300 text-[#55B3AD] focus:ring-[#55B3AD]" />
        Okay to show my first name and last initial
      </label>
      <button onClick={submit} disabled={!valid || busy} data-testid="testimonial-submit"
              className="mt-3 inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] disabled:opacity-50 text-white rounded-full px-6 py-2.5 text-sm font-semibold">
        <Icon name="reviews" tone="current" className="h-4 w-4" /> {busy ? "Submitting…" : "Submit testimonial"}
      </button>
    </div>
  );
}

function MyListings() {
  const [items, setItems] = useState(null);
  const load = () => api.get("/posts/mine/for-sale").then(({ data }) => setItems(data)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const relist = async (id) => {
    try { await api.post(`/posts/${id}/sold`); toast.success("Relisted — live for another 30 days"); load(); }
    catch { toast.error("Couldn't relist"); }
  };
  if (items === null) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!items.length) return <p className="text-sm text-slate-500" data-testid="my-listings-empty">You have no marketplace listings yet.</p>;
  return (
    <div className="space-y-2" data-testid="my-listings">
      {items.map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3" data-testid={`my-listing-${p.id}`}>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[#1F3F5B] truncate">{p.title}{typeof p.price === "number" && <span className="ml-2 text-emerald-700">${p.price.toLocaleString()}</span>}</div>
            <div className="text-xs text-slate-500">{p.sold ? "Sold" : "Active"}{p.condition ? ` · ${p.condition}` : ""}</div>
          </div>
          <Link to={`/community/listing/${p.id}/edit`} data-testid={`edit-listing-${p.id}`} title="Edit listing"
            className="shrink-0 inline-flex items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 h-8 w-8">
            <Icon name="edit" tone="current" className="h-4 w-4" />
          </Link>
          <DeleteListingButton post={p} variant="icon" onDeleted={() => load()} />
          {p.sold ? (
            <button onClick={() => relist(p.id)} data-testid={`relist-${p.id}`} className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#2A7871] hover:bg-[#23635d] rounded-full px-4 py-1.5">Relist</button>
          ) : (
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">Live</span>
          )}
        </div>
      ))}
    </div>
  );
}

const SECTION = "mt-8 bg-white rounded-2xl p-8 border border-slate-100";
const LABEL = "text-xs font-bold uppercase tracking-[0.2em] text-[#55B3AD]";
const FIELD = "mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#55B3AD] outline-none";

function BioField({ value, onChange }) {
  const len = value.trim().length;
  return (
    <div className="sm:col-span-2" data-testid="account-bio-field">
      <label className="text-xs text-slate-500">Bio</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} data-testid="account-bio-input"
        rows={4} maxLength={2000} placeholder="Tell the community a little about yourself (optional)"
        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#55B3AD] outline-none resize-none" />
      <div className="text-xs text-right mt-1" data-testid="account-bio-count">
        <span className={len > 300 ? "text-red-500 font-semibold" : "text-slate-400"}>{len}/300</span>
      </div>
    </div>
  );
}

export default function Profile() {
  const { user, loading, refresh, logout } = useAuth();
  const nav = useNavigate();
  const photoInput = useRef(null);
  const [iconOpen, setIconOpen] = useState(false);
  const [logoCrop, setLogoCrop] = useState(null);
  const [newsletter, setNewsletter] = useState(true);
  const [savingNewsletter, setSavingNewsletter] = useState(false);
  const [acct, setAcct] = useState({ first_name: "", last_name: "", email: "", handle: "", org_name: "", website: "", bio: "" });
  const [savingAll, setSavingAll] = useState(false);
  const [proCompany, setProCompany] = useState("");
  const [proCompanyOrig, setProCompanyOrig] = useState("");
  const [proHasListing, setProHasListing] = useState(false);
  const [boat, setBoat] = useState({ boat_name: "", boat_make_model: "" });
  const [sub, setSub] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  useEffect(() => { api.get("/payments/subscription").then(({ data }) => setSub(data)).catch(() => setSub({ is_free: true })); }, []);
  useEffect(() => { if (!loading && !user) nav("/"); }, [user, loading, nav]);
  useEffect(() => { if (user) setNewsletter(!!user.newsletter_opt_in); }, [user]);
  useEffect(() => { if (user) setBoat({ boat_name: user.boat_name || "", boat_make_model: user.boat_make_model || "" }); }, [user]);
  useEffect(() => {
    if (user) setAcct({
      first_name: user.first_name || "", last_name: user.last_name || "", email: user.email || "",
      handle: user.handle || "", org_name: user.org_name || "", website: user.website || "", bio: user.bio || "",
    });
  }, [user]);
  useEffect(() => {
    if (user?.account_type !== "boat_pro") return;
    api.get("/boat-pros/mine").then(({ data }) => {
      const cn = data.company_name || "";
      setProCompany(cn); setProCompanyOrig(cn); setProHasListing(true);
    }).catch(() => {
      const cn = user.company_name || "";
      setProCompany(cn); setProCompanyOrig(cn); setProHasListing(false);
    });
  }, [user]);

  if (!user) return null;

  const isPartner = user.account_type === "partner";
  const isPro = user.account_type === "boat_pro";
  const isOwner = user.account_type === "boat_owner";
  const isSailorish = user.account_type === "sailor" || user.account_type === "boat_owner";

  const tierBadge = { free: "Free", basic: "Basic", featured: "Featured", premium: "Premium", community_partner: "Community Partner", founding_partner: "Founding Partner" }[user.subscription_tier] || "Free";

  // One Save for all Account Details fields (name, handle, role-specific, business name).
  const saveAll = async () => {
    if (acct.handle && !/^[A-Za-z0-9_]{3,20}$/.test(acct.handle)) { toast.error("Username must be 3-20 letters, numbers or _"); return; }
    if (!acct.first_name.trim() || !acct.last_name.trim()) { toast.error("First and last name are required"); return; }
    if (!acct.email.trim()) { toast.error("Email is required"); return; }
    if (isPro && proHasListing && !proCompany.trim()) { toast.error("Business name is required"); return; }
    if (!isPartner && acct.bio.trim().length > 300) { toast.error("Bio must be 300 characters or less"); return; }
    setSavingAll(true);
    try {
      const payload = { first_name: acct.first_name.trim(), last_name: acct.last_name.trim(), email: acct.email.trim() };
      if (!isPartner) payload.bio = acct.bio;
      if (isPartner) { payload.org_name = acct.org_name.trim(); payload.website = acct.website.trim(); }
      await api.patch("/auth/profile", payload);
      if (acct.handle && acct.handle !== (user.handle || "")) await api.patch("/auth/handle", { handle: acct.handle });
      if (isOwner) await api.patch("/auth/boat-details", boat);
      // Business name shares the listing's company_name. Write ONLY that field so a
      // profile save never touches other listing fields.
      if (isPro && proHasListing && proCompany.trim() !== proCompanyOrig.trim()) {
        await api.patch("/boat-pros/listing", { company_name: proCompany.trim() });
        setProCompanyOrig(proCompany.trim());
      }
      toast.success("Profile saved");
      refresh?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save");
    } finally { setSavingAll(false); }
  };

  const switchAccount = async () => {
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    window.location.href = "/login";
  };

  const swapAccountType = async () => {
    const next = user.account_type === "sailor" ? "boat_owner" : "sailor";
    try {
      await api.patch("/auth/account-type", { account_type: next });
      toast.success(`Switched to ${next === "boat_owner" ? "Boat Owner" : "Sailor / Crew"}`);
      window.location.reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const openPhotoMenu = () => {
    // Org/club accounts have ONE image (the directory logo): go straight to the
    // square logo crop, no emoji-avatar option.
    if (isPartner) { photoInput.current?.click(); return; }
    toast("Update your photo", {
      action: { label: "Change photo", onClick: () => photoInput.current?.click() },
      cancel: { label: "Add avatar", onClick: () => setIconOpen(true) },
    });
  };
  const uploadOrgImage = async (dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob();
    const ok = ["image/jpeg", "image/png", "image/webp"];
    const fd = new FormData();
    fd.append("file", new File([blob], "logo.jpg", { type: ok.includes(blob.type) ? blob.type : "image/jpeg" }));
    const res = await api.post("/org-listing/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
    return res.data.url;
  };
  const applyLogoCrop = async (cropped) => {
    const orig = logoCrop?.original || cropped;
    setLogoCrop(null);
    try {
      const logo_url = await uploadOrgImage(cropped);
      const logo_original_url = (orig.startsWith("/api/") || orig.startsWith("http")) ? orig : await uploadOrgImage(orig);
      await api.patch("/org-listing", { logo_url, logo_original_url });
      toast.success("Logo updated");
      refresh?.();
    } catch { toast.error("Could not save. Try again."); }
  };
  const onPhotoFile = async (e) => {
    const file = e.target.files?.[0];
    if (photoInput.current) photoInput.current.value = "";
    if (!file) return;
    if (isPartner) {
      // Same square logo crop (circle display) the listing editor uses.
      const res = await compressImageToDataURL(file);
      if (!res?.dataUrl) { toast.error("Couldn't read that image — try another file"); return; }
      setLogoCrop({ source: res.dataUrl, original: res.dataUrl });
      return;
    }
    const fd = new FormData();
    fd.append("file", file, "avatar.jpg");
    try {
      await api.post("/auth/avatar", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Photo updated");
      refresh?.();
    } catch { toast.error("Couldn't update photo"); }
  };
  const pickIcon = async (a) => {
    try { await api.patch("/profile/photo", { picture: null, avatar: a }); toast.success("Avatar updated"); setIconOpen(false); refresh?.(); }
    catch { toast.error("Couldn't update avatar"); }
  };

  const toggleNewsletter = async (next) => {
    setNewsletter(next);
    setSavingNewsletter(true);
    try {
      const { data } = await api.patch("/auth/newsletter", { newsletter_opt_in: next });
      if (data?.zoho?.status === "ok") {
        toast.success(next ? "Subscribed — please check your email to confirm." : "Unsubscribed from the newsletter.");
      } else if (data?.zoho?.status === "skipped") {
        toast.success(next ? "Newsletter preference saved." : "Preference saved.");
      } else {
        toast.warning("Preference saved locally; newsletter sync pending.");
      }
    } catch {
      setNewsletter(!next);
      toast.error("Could not update newsletter");
    } finally { setSavingNewsletter(false); }
  };

  const cancelPlan = async () => {
    if (!window.confirm("Cancel your plan? You'll keep access until the end of your current period.")) return;
    setCancelBusy(true);
    try {
      const { data } = await api.post("/payments/subscription/cancel");
      setSub((s) => ({ ...s, cancel_at_period_end: true, renews_at: data.renews_at }));
      toast.success("Plan will not renew");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not cancel"); }
    finally { setCancelBusy(false); }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="profile-page">
      <input ref={photoInput} type="file" accept="image/*" className="hidden" data-testid="photo-input" onChange={onPhotoFile} />
      {logoCrop && <CropModal image={logoCrop.source} aspect={1} cropShape="round" title="Crop logo" onCancel={() => setLogoCrop(null)} onSave={applyLogoCrop} />}

      <div className="bg-white rounded-2xl p-8 border border-slate-100">
        {/* Header */}
        <div className="flex items-start gap-4 justify-between flex-wrap">
          <div className="flex items-center gap-4">
            <button onClick={openPhotoMenu} data-testid="edit-photo-avatar" className="relative shrink-0 group" title="Tap to change your photo">
              {isPartner
                ? <LogoCircle src={user.logo_url || user.picture} size="h-16 w-16" alt={user.name || ""} testId="profile-org-logo"
                    fallback={<span className="h-full w-full flex items-center justify-center bg-[#55B3AD]/15"><Icon name="org" tone="current" className="h-7 w-7 text-[#2A7871]" /></span>} />
                : <Avatar src={user.picture || user.avatar} className="h-16 w-16" alt={user.name || "Profile photo"} fallback={user.avatar && user.avatar.length <= 8 ? user.avatar : "⛵"} fallbackClassName="text-2xl" testId="profile-avatar" />}
              <span className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-[#F2A03B] text-white flex items-center justify-center border-2 border-white shadow">
                <Icon name="camera" tone="current" className="h-3.5 w-3.5" />
              </span>
            </button>
            <div className="min-w-0">
              <h1 className="font-display font-extrabold text-2xl text-[#1F3F5B] break-words flex items-center gap-2 flex-wrap">{user.name}{user.identity_verified && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-[#55B3AD]/15 text-[#2A7871]" data-testid="profile-id-verified"><Icon name="verified" tone="current" className="h-3 w-3" /> ID Verified</span>}</h1>
              <div className="text-sm text-slate-500 break-all">{user.email}</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-[#F2A03B]/15 text-[#d98c30]">{tierBadge}</span>
                <span className="text-xs text-slate-500">{user.account_type?.replace("_", " ")} · {user.primary_market}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={switchAccount} data-testid="switch-account-btn"
                    className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-slate-200 text-[#1F3F5B] hover:border-[#55B3AD] transition-colors">
              <Icon name="repeat" size={16} tone="current" /> Switch account
            </button>
            <button onClick={logout} data-testid="profile-logout-btn"
                    className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
              <Icon name="logout" size={16} tone="current" /> Log out
            </button>
          </div>
        </div>

        {/* Account details - one Save for everything */}
        <div className="mt-6 pt-6 border-t border-slate-100" data-testid="profile-account-section">
          <div className={`${LABEL} mb-3`}>Account details</div>
          {isPartner && (
            <Link to="/org-listing" data-testid="edit-directory-listing-btn"
                  className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#55B3AD]/40 bg-[#55B3AD]/10 px-4 py-3 hover:bg-[#55B3AD]/20 transition-colors">
              <span className="flex items-center gap-2.5">
                <Icon name="anchor" tone="current" className="h-5 w-5 text-[#2A7871]" />
                <span>
                  <span className="block text-sm font-bold text-[#1F3F5B]">Edit Directory Listing</span>
                  <span className="block text-xs text-slate-500">Manage your public club/org profile — logo, categories, bio & contact</span>
                </span>
              </span>
              <Icon name="chevron-right" tone="current" className="h-5 w-5 text-[#2A7871]" />
            </Link>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {isPartner && (
              <>
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-500">Club / Organization name</label>
                  <input value={acct.org_name} onChange={(e) => setAcct({ ...acct, org_name: e.target.value })} data-testid="account-org-name-input" className={FIELD} />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-500">Website</label>
                  <input value={acct.website} onChange={(e) => setAcct({ ...acct, website: e.target.value })} placeholder="https://…" data-testid="account-website-input" className={FIELD} />
                </div>
              </>
            )}
            {isPro && (
              <div className="sm:col-span-2">
                <label className="text-xs text-slate-500">Business name</label>
                <input value={proCompany} onChange={(e) => setProCompany(e.target.value)} data-testid="account-business-input" maxLength={120} className={FIELD} />
                <div className="mt-1.5 flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs text-slate-400">Shown on your public listing and the directory. Editing it here updates both.</p>
                  {user.user_id && (
                    <Link to={`/directory/${user.user_id}`} data-testid="view-listing-card-link"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#55B3AD] hover:text-[#2A7871]">
                      <Icon name="external-link" tone="current" className="h-3.5 w-3.5" /> View listing card
                    </Link>
                  )}
                </div>
              </div>
            )}
            <div>
              <label className="text-xs text-slate-500">First name</label>
              <input value={acct.first_name} onChange={(e) => setAcct({ ...acct, first_name: e.target.value })} data-testid="account-first-name-input" className={FIELD} />
            </div>
            <div>
              <label className="text-xs text-slate-500">Last name</label>
              <input value={acct.last_name} onChange={(e) => setAcct({ ...acct, last_name: e.target.value })} data-testid="account-last-name-input" className={FIELD} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-slate-500">@-username</label>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-slate-400 font-mono select-none">@</span>
                <input value={acct.handle} onChange={(e) => setAcct({ ...acct, handle: e.target.value })} data-testid="handle-input"
                       placeholder="pnw_sailor" className="flex-1 rounded-xl border border-slate-200 px-3 py-2 outline-none font-mono text-sm focus:border-[#55B3AD]" />
              </div>
              <p className="text-xs text-slate-500 mt-1">People tag you as <b>@{acct.handle || "yourusername"}</b>. 3-20 letters, numbers or _.</p>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-slate-500">Email</label>
              <input value={acct.email} onChange={(e) => setAcct({ ...acct, email: e.target.value })} data-testid="account-email-input" className={FIELD} />
              <p className="text-xs text-amber-600 mt-1" data-testid="email-change-warning">Changing it may affect Google sign-in.</p>
            </div>
            {!isPartner && !isOwner && <BioField value={acct.bio} onChange={(v) => setAcct({ ...acct, bio: v })} />}
            {isOwner && (
              <>
                <div>
                  <label className="text-xs text-slate-500">Boat name</label>
                  <input value={boat.boat_name} maxLength={80} onChange={(e) => setBoat({ ...boat, boat_name: e.target.value })} data-testid="boat-name-input" className={FIELD} />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Boat make/model</label>
                  <input value={boat.boat_make_model} maxLength={80} onChange={(e) => setBoat({ ...boat, boat_make_model: e.target.value })} data-testid="boat-make-model-input" className={FIELD} />
                </div>
                <BioField value={acct.bio} onChange={(v) => setAcct({ ...acct, bio: v })} />
              </>
            )}
          </div>

          {/* Boat Pro: quick links to public profile and the business listing editor */}
          {isPro && (
            <div className="mt-4 space-y-3" data-testid="pro-profile-links">
              <Link to={`/u/${user.handle || ""}`} data-testid="view-public-profile-link"
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 hover:border-[#55B3AD] transition-colors">
                <span className="flex items-center gap-2.5">
                  <Icon name="profile" tone="current" className="h-5 w-5 text-[#2A7871]" />
                  <span>
                    <span className="block text-sm font-bold text-[#1F3F5B]">View public profile</span>
                    <span className="block text-xs text-slate-500">Your personal profile at @{user.handle}</span>
                  </span>
                </span>
                <Icon name="chevron-right" tone="current" className="h-5 w-5 text-[#2A7871]" />
              </Link>
              <Link to="/boat-pro-listing" data-testid="your-boat-pro-listing-link"
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#55B3AD]/40 bg-[#55B3AD]/10 px-4 py-3 hover:bg-[#55B3AD]/20 transition-colors">
                <span className="flex items-center gap-2.5">
                  <Icon name="anchor" tone="current" className="h-5 w-5 text-[#2A7871]" />
                  <span>
                    <span className="block text-sm font-bold text-[#1F3F5B]">Your Boat Pro Listing</span>
                    <span className="block text-xs text-slate-500">Business details, photos, categories, markets and credentials</span>
                  </span>
                </span>
                <Icon name="chevron-right" tone="current" className="h-5 w-5 text-[#2A7871]" />
              </Link>
            </div>
          )}

          {/* Account type (swap) for sailor / boat owner */}
          {isSailorish && (
            <div className="mt-6 pt-6 border-t border-slate-100" data-testid="account-swap-section">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className={LABEL}>Account type</div>
                  <p className="text-sm text-slate-600 mt-1 max-w-md">
                    You&apos;re a {isOwner ? "Boat Owner" : "Sailor / Crew"}. {user.account_type === "sailor"
                      ? "Just bought a boat? Switch to Boat Owner to post crew openings."
                      : "Sold your boat? Switch back to Sailor / Crew to find rides."}
                  </p>
                </div>
                <button onClick={swapAccountType} data-testid="swap-account-type-btn"
                        className="inline-flex items-center gap-2 border-2 border-[#1F3F5B] text-[#1F3F5B] hover:bg-slate-50 rounded-full px-5 py-2 font-semibold text-sm">
                  Switch to {user.account_type === "sailor" ? "Boat Owner" : "Sailor / Crew"}
                </button>
              </div>
            </div>
          )}

          <div className="mt-6">
            <button disabled={savingAll} onClick={saveAll} data-testid="account-save"
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#1F3F5B] hover:bg-[#152a3d] text-white px-6 py-2.5 text-sm font-semibold disabled:opacity-40">
              {savingAll ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {/* ID verification moved below the Subscription card (see Verification section) */}
      </div>

      {/* Subscription - directly under Account details */}
      <section className={SECTION} data-testid="subscription-section">
        <div className={LABEL}>Subscription</div>
        {!sub ? (
          <p className="text-sm text-slate-500 mt-2">Loading…</p>
        ) : sub.is_free ? (
          <>
            <h2 className="font-display font-bold text-xl text-[#1F3F5B] mt-1">You're on the free plan</h2>
            <p className="text-sm text-slate-600 mt-1">Upgrade to unlock posting, messaging, reviews and more.</p>
            <a href="/pricing" data-testid="subscription-upgrade-btn" className="mt-4 inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-2.5 font-semibold">Upgrade</a>
          </>
        ) : (
          <>
            <h2 className="font-display font-bold text-xl text-[#1F3F5B] mt-1 capitalize" data-testid="subscription-plan">{sub.tier} plan</h2>
            <div className="mt-2 text-sm text-slate-600 space-y-1">
              <div>Billing interval: <span className="font-semibold text-[#1F3F5B]" data-testid="subscription-interval">{sub.interval || "Recurring"}</span></div>
              {sub.renews_at && (
                <div>{sub.cancel_at_period_end ? "Access until" : "Renews"}: <span className="font-semibold text-[#1F3F5B]" data-testid="subscription-renewal">{new Date(sub.renews_at).toLocaleDateString()}</span></div>
              )}
              {sub.cancel_at_period_end && <div className="text-amber-600 font-semibold" data-testid="subscription-canceled-note">Set to cancel at period end</div>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href="/pricing" data-testid="subscription-change-btn" className="inline-flex items-center gap-2 border-2 border-[#1F3F5B] text-[#1F3F5B] hover:bg-slate-50 rounded-full px-5 py-2 font-semibold text-sm">Change plan</a>
              {!sub.cancel_at_period_end && (
                <button onClick={cancelPlan} disabled={cancelBusy} data-testid="subscription-cancel-btn" className="inline-flex items-center gap-2 border-2 border-red-200 text-red-600 hover:bg-red-50 rounded-full px-5 py-2 font-semibold text-sm disabled:opacity-50">{cancelBusy ? "Canceling…" : "Cancel plan"}</button>
              )}
            </div>
          </>
        )}
      </section>

      {/* Verification - ID verification; individuals only (disabled during trial), removed for Club/Org */}
      {!isPartner && (
        <section className={SECTION} data-testid="profile-identity-section">
          <div className={`${LABEL} mb-2`}>Identity verification</div>
          <div data-testid="identity-disabled" className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 opacity-70">
            <Icon name="lock" tone="current" className="h-4 w-4 text-slate-400" />
            <p className="text-sm text-slate-500">Not available during free trial period</p>
          </div>
        </section>
      )}

      {/* Your activity - my listings, following, saved */}
      <section className={SECTION} data-testid="my-listings-section">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className={LABEL}>My listings</div>
          <a href="/my-crew-listings" data-testid="profile-my-crew-listings-link"
             className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-[#1F3F5B] hover:border-[#55B3AD]">
            <Icon name="crew" tone="current" className="h-4 w-4" /> My Crew Listings
          </a>
        </div>
        <MyListings />
      </section>

      <section className={SECTION} data-testid="profile-following-section">
        <div className={`${LABEL} mb-3`}>Following</div>
        <a href="/following" data-testid="profile-following-link"
           className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-[#1F3F5B] hover:border-[#55B3AD]">
          <Icon name="crew" tone="current" className="h-4 w-4" /> Manage who you follow
        </a>
      </section>

      <SavedSection />

      {/* Help and feedback - testimonial + contact */}
      <section className={SECTION} data-testid="testimonial-section">
        <div className={LABEL}>Share your story</div>
        <h2 className="font-display font-bold text-xl text-[#1F3F5B] mt-1 mb-4">Leave a testimonial</h2>
        <TestimonialForm user={user} />
      </section>

      <section className={SECTION} data-testid="support-contact-section">
        <div className={LABEL}>Contact us</div>
        <h3 className="font-display font-bold text-lg text-[#1F3F5B] mt-1 mb-4">Questions? Reach our support team</h3>
        <SupportContactForm user={user} />
      </section>

      {/* Notifications and email - newsletter + push */}
      <section className={SECTION} data-testid="newsletter-section">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="max-w-md">
            <div className={LABEL}>Newsletter</div>
            <h2 className="font-display font-bold text-xl text-[#1F3F5B] mt-1">Sail More Now, the monthly digest</h2>
            <p className="text-slate-600 text-sm mt-2">Sailing and community events, educational information, and featured Boat Pros. One email a quarter, unsubscribe any time.</p>
          </div>
          <label className="inline-flex items-center gap-3 cursor-pointer select-none">
            <span className="text-sm font-semibold text-slate-700">{newsletter ? "Subscribed" : "Off"}</span>
            <span onClick={() => !savingNewsletter && toggleNewsletter(!newsletter)} data-testid="newsletter-toggle"
                  className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors ${newsletter ? "bg-[#55B3AD]" : "bg-slate-300"} ${savingNewsletter ? "opacity-60" : ""}`}>
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${newsletter ? "translate-x-5" : "translate-x-0.5"}`} />
            </span>
          </label>
        </div>
      </section>

      <section className={SECTION} data-testid="profile-push-section">
        <div className={`${LABEL} mb-3`}>Push notifications</div>
        <PushPreferencesPanel testId="profile-push-preferences" />
      </section>

      {/* Legal */}
      <section className={SECTION} data-testid="profile-legal-section">
        <div className={`${LABEL} mb-3`}>Legal</div>
        <div className="flex flex-col gap-2">
          <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" data-testid="legal-terms-link" className="text-sm font-semibold text-[#55B3AD] hover:underline">Terms and Conditions</a>
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" data-testid="legal-privacy-link" className="text-sm font-semibold text-[#55B3AD] hover:underline">Privacy Policy</a>
          <Link to="/community-guidelines" data-testid="legal-coc-link" className="text-sm font-semibold text-[#55B3AD] hover:underline">Code of Conduct</Link>
        </div>
      </section>

      <DeleteAccountSection />

      <Modal open={iconOpen} onClose={() => setIconOpen(false)} title="Pick an avatar" testId="avatar-icon-modal">
        <div className="p-5 flex flex-wrap gap-2 justify-center">
          {SAILING_ICONS.map((a) => (
            <button key={a} onClick={() => pickIcon(a)} data-testid={`icon-${a}`} title={a}
              className={`h-11 w-11 rounded-full text-xl flex items-center justify-center border ${!user.picture && user.avatar === a ? "border-[#F2A03B] bg-[#F2A03B]/15" : "border-slate-200 hover:border-[#55B3AD]"}`}>{a}</button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
