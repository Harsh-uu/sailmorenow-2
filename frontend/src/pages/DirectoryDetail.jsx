import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Stars } from "@/components/ReviewRatings";
import Modal from "@/components/Modal";
import LogoCircle from "@/components/LogoCircle";
import PhotoGallery from "@/components/PhotoGallery";
import ImageLightbox from "@/components/ImageLightbox";
import ShareButton from "@/components/ShareButton";
import InviteBanner from "@/components/InviteBanner";
import ReviewButton from "@/components/ReviewButton";
import ReviewsSection from "@/components/ReviewsSection";
import { canInteract } from "@/lib/plan";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export default function DirectoryDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [hired, setHired] = useState(false);
  const [hireCount, setHireCount] = useState(0);
  const [hireBusy, setHireBusy] = useState(false);
  const [hirePromptOpen, setHirePromptOpen] = useState(false);
  const [reviewSignal, setReviewSignal] = useState(0);
  const [reviewsKey, setReviewsKey] = useState(0);

  const load = () => api.get(`/boat-pros/${id}`).then(({ data }) => {
    setData(data);
    setHired(!!data.pro.viewer_hired);
    setHireCount(data.pro.hire_count || 0);
  });
  useEffect(() => { load(); }, [id]);

  const toggleHire = async () => {
    if (!user) return toast.error("Please sign in to hire");
    setHireBusy(true);
    try {
      const { data: res } = await api.post(`/boat-pros/${id}/hire`);
      setHired(res.hired);
      setHireCount(res.count);
      // Post-Hired review prompt: paid, non-pro accounts only. Free accounts can
      // mark Hired and simply see no prompt.
      if (res.hired) { toast.success("You hired this pro"); if (canInteract(user) && user.account_type !== "boat_pro") setHirePromptOpen(true); }
    } catch (e) { /* 402/403 upgrade handled by interceptor */ }
    finally { setHireBusy(false); }
  };

  const openDM = () => {
    if (!user) return toast.error("Please sign in to message");
    nav(`/messages?to=${id}&as=business`);
  };

  if (!data) return <div className="max-w-4xl mx-auto p-10 text-slate-500">Loading…</div>;
  const { pro } = data;
  const tier = pro.tier || "basic";
  const isOwner = !!user && user.user_id === id;
  const isPremium = tier === "premium";
  const hasCreds = (pro.certifications || []).length > 0 || (pro.licenses || []).length > 0 || (pro.insurance || []).length > 0;
  const backToDirectory = () => {
    if (location.state?.from === "directory" && (window.history.state?.idx ?? 0) > 0) nav(-1);
    else nav("/directory");
  };
  // Same viewer sequence as the org page: cover, gallery 1-5, then logo. The
  // viewer shows the full uncropped ORIGINAL (falls back to the crop).
  const proCover = pro.cover_url || pro.photo_url;
  const proMedia = [];
  if (proCover) proMedia.push({ src: pro.cover_original_url || proCover, alt: `${pro.company_name} cover` });
  (pro.photos || []).forEach((p, i) => { const s = typeof p === "string" ? p : (p?.original || p?.url); if (s) proMedia.push({ src: s, alt: `${pro.company_name} photo ${i + 1}` }); });
  if (pro.logo_url) proMedia.push({ src: pro.logo_original_url || pro.logo_url, alt: `${pro.company_name} logo` });
  const proGalleryStart = proCover ? 1 : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="pro-detail-page">
      <ImageLightbox open={!!lightbox} images={lightbox?.images || []} index={lightbox?.index || 0}
        onClose={() => setLightbox(null)} onIndexChange={(i) => setLightbox((l) => (l ? { ...l, index: i } : l))} />
      <button onClick={backToDirectory} data-testid="pro-detail-back" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#1F3F5B]">
        <Icon name="arrow-left" tone="current" className="h-4 w-4" /> Back to directory
      </button>

      {!user && <InviteBanner blurb={`Sign up free to message ${pro.company_name}, read verified reviews, and find trusted Boat Pros across the PNW.`} />}

      <div className={`mt-4 rounded-3xl overflow-hidden break-words [overflow-wrap:anywhere] ${tier === "premium" ? "bg-[#1F3F5B] text-white" : "bg-white border border-slate-200"}`}>
        {proCover && (
          <button type="button" onClick={() => setLightbox({ images: proMedia, index: 0 })} className="block w-full" data-testid="pro-hero-photo-btn" aria-label="View cover photo">
            <img src={proCover} alt={`${pro.company_name} cover`} data-testid="pro-hero-photo" className="w-full aspect-[3.5/1] object-cover" loading="lazy" />
          </button>
        )}
        {Array.isArray(pro.photos) && pro.photos.length > 0 && (
          <PhotoGallery photos={pro.photos} max={5}
            onTileClick={(i) => setLightbox({ images: proMedia, index: proGalleryStart + i })}
            containerTestId="pro-photos-gallery" testIdPrefix="pro-photo"
            altFor={(i) => `${pro.company_name} photo ${i + 1}`} bgClass="bg-slate-100" />
        )}
        <div className="p-8">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-start gap-4 min-w-0">
              {pro.logo_url && (
                <LogoCircle src={pro.logo_url} size="h-16 w-16" alt={pro.company_name}
                  testId="pro-logo" className="ring-4 ring-white/20"
                  fallback={<span className="font-display font-bold text-xl text-[#1F3F5B]">{pro.company_name?.[0] || "P"}</span>} />
              )}
              <div className="min-w-0">
                <h1 className={`font-display font-extrabold text-3xl sm:text-4xl ${tier === "premium" ? "text-white" : "text-[#1F3F5B]"}`}>{pro.company_name}</h1>
                {pro.business_handle && <div className={`mt-1 text-sm font-mono ${tier === "premium" ? "text-slate-300" : "text-slate-500"}`} data-testid="pro-handle">@{pro.business_handle}</div>}
                <div className={`mt-2 text-sm ${tier === "premium" ? "text-slate-200" : "text-slate-500"}`}>{pro.markets?.join(" · ")}</div>
                <div className="mt-3 flex items-center gap-2 flex-wrap" data-testid="pro-rating">
                  <Stars value={data.rating || 0} />
                  {data.rating != null && <span className={`text-sm font-semibold ${tier === "premium" ? "text-white" : "text-[#1F3F5B]"}`}>{Number(data.rating).toFixed(1)}</span>}
                  <span className={`text-sm ${tier === "premium" ? "text-slate-300" : "text-slate-500"}`} data-testid="pro-review-count">{data.review_count || 0} review{data.review_count === 1 ? "" : "s"}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
            {isOwner && (
              <Link to="/boat-pro-listing" state={{ from: "directory" }} data-testid="pro-edit-listing-btn"
                className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-semibold border-2 ${tier === "premium" ? "border-white/40 text-white hover:bg-white/10" : "border-[#1F3F5B] text-[#1F3F5B] hover:bg-slate-50"}`}>
                <Icon name="edit" tone="current" className="h-4 w-4" /> Edit listing
              </Link>
            )}
            {(
              <button onClick={openDM} data-testid="dm-btn" className="inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2.5 font-semibold">
                <Icon name="message-square" tone="current" className="h-4 w-4" /> Direct message
              </button>
            )}
            {user && user.user_id !== id && user.active_identity !== "business" && (
              <button onClick={toggleHire} disabled={hireBusy} data-testid="hire-btn"
                className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-semibold border-2 ${hired ? "bg-[#55B3AD] text-white border-[#55B3AD]" : (tier === "premium" ? "border-white/40 text-white hover:bg-white/10" : "border-[#1F3F5B] text-[#1F3F5B] hover:bg-slate-50")}`}>
                <Icon name={hired ? "check" : "anchor"} tone="current" className="h-4 w-4" /> {hired ? "You hired this pro" : "Hired?"}
              </button>
            )}
            {(user && user.user_id === id) && (
              <span data-testid="hire-count" className={`inline-flex items-center gap-1.5 text-sm font-semibold ${tier === "premium" ? "text-slate-200" : "text-slate-600"}`}><Icon name="anchor" tone="current" className="h-4 w-4 text-[#55B3AD]" /> {hireCount} hire{hireCount === 1 ? "" : "s"}</span>
            )}
            <ShareButton
              path={`/directory/${id}`}
              title={pro.company_name}
              text={`Check out ${pro.company_name} on Sail More Now`}
              label="Share"
              testId="pro-share-btn"
              className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 font-semibold text-sm transition-colors ${tier === "premium" ? "border-white/30 text-white hover:bg-white/10" : "border-slate-200 text-slate-600 hover:border-[#55B3AD]"}`}
            />
            </div>
          </div>

          {(tier === "featured" || tier === "premium") && pro.short_bio && (
            <p className={`mt-6 text-base leading-relaxed ${tier === "premium" ? "text-slate-100" : "text-slate-700"}`}>{pro.short_bio}</p>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            {(pro.categories || []).map((c) => (
              <span key={c} className={`px-3 py-1 rounded-full text-xs font-medium ${tier === "premium" ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700"}`}>{c}</span>
            ))}
          </div>

          <div className="mt-6 grid sm:grid-cols-3 gap-4 text-sm break-words [overflow-wrap:anywhere]">
            {pro.contact_locked ? (
              <Link to="/login" data-testid="contact-locked" className="inline-flex items-center gap-2 font-semibold text-[#55B3AD]"><Icon name="lock" tone="current" className="h-4 w-4" /> Sign in to see contact details</Link>
            ) : (
              <>
                {pro.contact_email && <a href={`mailto:${pro.contact_email}`} className="inline-flex items-center gap-2 [overflow-wrap:anywhere]"><Icon name="mail" tone="current" className="h-4 w-4 shrink-0" /> {pro.contact_email}</a>}
                {pro.contact_phone && <a href={`tel:${pro.contact_phone}`} className="inline-flex items-center gap-2"><Icon name="phone" tone="current" className="h-4 w-4 shrink-0" /> {pro.contact_phone}</a>}
                {pro.website && <a href={pro.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2"><Icon name="globe" tone="current" className="h-4 w-4 shrink-0" /> Website</a>}
              </>
            )}
          </div>

          {isPremium && hasCreds && (
            <div className={`mt-6 pt-6 border-t ${tier === "premium" ? "border-white/15" : "border-slate-100"}`} data-testid="pro-credentials">
              <div className={`text-xs font-bold uppercase tracking-widest mb-3 ${tier === "premium" ? "text-[#F2A03B]" : "text-[#55B3AD]"}`}>Trust and credentials</div>
              <div className="grid sm:grid-cols-3 gap-4">
                {(pro.certifications || []).length > 0 && (
                  <div>
                    <div className={`text-xs font-semibold flex items-center gap-1.5 ${tier === "premium" ? "text-slate-200" : "text-slate-700"}`}><Icon name="award" tone="current" className="h-3.5 w-3.5" /> Certifications</div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {pro.certifications.map((c, i) => <li key={i} className={tier === "premium" ? "text-slate-100" : "text-slate-700"}>• {c}</li>)}
                    </ul>
                  </div>
                )}
                {(pro.licenses || []).length > 0 && (
                  <div>
                    <div className={`text-xs font-semibold flex items-center gap-1.5 ${tier === "premium" ? "text-slate-200" : "text-slate-700"}`}><Icon name="file-check" tone="current" className="h-3.5 w-3.5" /> Licenses</div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {pro.licenses.map((c, i) => <li key={i} className={tier === "premium" ? "text-slate-100" : "text-slate-700"}>• {c}</li>)}
                    </ul>
                  </div>
                )}
                {(pro.insurance || []).length > 0 && (
                  <div>
                    <div className={`text-xs font-semibold flex items-center gap-1.5 ${tier === "premium" ? "text-slate-200" : "text-slate-700"}`}><Icon name="file-check" tone="current" className="h-3.5 w-3.5" /> Insurance</div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {pro.insurance.map((c, i) => <li key={i} className={tier === "premium" ? "text-slate-100" : "text-slate-700"}>• {c}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
          {isOwner && !isPremium && (
            <div className={`mt-6 pt-6 border-t ${tier === "premium" ? "border-white/15" : "border-slate-100"}`} data-testid="pro-credentials-locked">
              <div className="rounded-2xl border border-[#F2A03B]/40 bg-[#F2A03B]/[0.07] p-4 flex items-center gap-3">
                <span className="h-10 w-10 shrink-0 rounded-full bg-[#F2A03B]/20 flex items-center justify-center">
                  <Icon name="lock" tone="current" className="h-5 w-5 text-[#F2A03B]" />
                </span>
                <p className={`flex-1 text-sm font-semibold leading-snug ${tier === "premium" ? "text-white" : "text-slate-700"}`}>Trust and credentials is part of Premium. Upgrade to show yours on your listing.</p>
                <Link to="/pricing?audience=boat_pro" data-testid="pro-credentials-upgrade"
                  className="shrink-0 inline-flex items-center min-h-[44px] rounded-full bg-[#F2A03B] hover:bg-[#d98c30] text-white px-4 text-sm font-bold">Upgrade</Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Business-identity activity only (personal posts never appear here) */}
      {Array.isArray(data.recent_posts) && data.recent_posts.length > 0 && (
        <div className="mt-8 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 sm:p-8" data-testid="pro-activity-card">
          <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] mb-3">Recent activity</div>
          <ul className="space-y-2">
            {data.recent_posts.map((p) => {
              const isDisc = p.type === "forum" || p.type === "blog";
              return (
                <li key={p.id} className="flex items-center justify-between gap-3" data-testid={`pro-activity-${p.id}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold smn-heading truncate flex items-center gap-2">
                      {isDisc && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#55B3AD]/15 text-[#2A7871]">{p.type}</span>}
                      <span className="truncate">{p.title || "(untitled)"}</span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{p.market} · {(p.created_at || "").slice(0, 10)}</div>
                  </div>
                  <Link to={isDisc ? `/community-hub/${p.id}` : "/feed"} className="text-xs font-semibold text-[#F2A03B] hover:underline shrink-0">Open →</Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Single reviews section (two-way, from /api/reviews/list) */}
      <div className="mt-10 flex items-center justify-end gap-3" data-testid="pro-review-cta">
        <ReviewButton targetId={id} targetName={pro.company_name} targetIdentity="business" openSignal={reviewSignal} onPosted={() => setReviewsKey((k) => k + 1)} />
      </div>
      <div className="mt-4">
        <ReviewsSection targetId={id} kind="member" identity="business" canReply={!!user && user.user_id === id} refreshKey={reviewsKey} />
      </div>

      <Modal open={hirePromptOpen} onClose={() => setHirePromptOpen(false)}
             title="Want to leave a review?" testId="hire-review-prompt" size="sm">
        <div className="p-5">
          <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed">You hired {pro.company_name}. Your review helps other boat owners.</p>
          <div className="mt-5 flex flex-col sm:flex-row-reverse gap-2">
            <button data-testid="hire-review-write"
                    onClick={() => { setHirePromptOpen(false); setReviewSignal((n) => n + 1); }}
                    className="inline-flex items-center justify-center gap-2 bg-[#1F3F5B] hover:bg-[#152a3d] text-white rounded-full px-5 min-h-[44px] font-semibold text-sm">
              <Icon name="reviews" tone="current" className="h-4 w-4" /> Write a review
            </button>
            <button data-testid="hire-review-not-now"
                    onClick={() => setHirePromptOpen(false)}
                    className="inline-flex items-center justify-center text-slate-600 dark:text-slate-300 rounded-full px-5 min-h-[44px] font-semibold text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
              Not now
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
