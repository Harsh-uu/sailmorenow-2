import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { PartnerBadge } from "@/components/PartnerBadge";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { api, ICON_VERIFIED } from "@/lib/api";
import Avatar from "@/components/Avatar";
import LogoCircle from "@/components/LogoCircle";
import ReviewButton from "@/components/ReviewButton";
import ReviewsSection from "@/components/ReviewsSection";
import PhotoGallery from "@/components/PhotoGallery";
import ImageLightbox from "@/components/ImageLightbox";
import ShareButton from "@/components/ShareButton";
import { useAuth } from "@/context/AuthContext";
import WaveDivider from "@/components/WaveDivider";
import SectionEyebrow from "@/components/SectionEyebrow";
import { RequireAuth } from "@/components/AuthGate";

const ACCOUNT_LABEL = { sailor: "Sailor", boat_owner: "Boat Owner", boat_pro: "Boat Pro", partner: "Community Partner" };

export default function HandleProfile() {
  const params = useParams();
  const navigate = useNavigate();
  // Support both /u/:handle and /:atHandle (the @-prefixed alias route).
  const handle = params.handle || (params.atHandle || "").replace(/^@/, "");
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { images:[{src,alt}], index }
  const [err, setErr] = useState(null);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [reviewsKey, setReviewsKey] = useState(0);
  const [rsvpDone, setRsvpDone] = useState({});
  useEffect(() => {
    setData(null); setErr(null);
    const h = (handle || "").replace(/^@/, "");
    api.get(`/u/${encodeURIComponent(h)}`).then(({ data }) => {
      // A business handle resolves to the owning account's Boat Pro listing.
      // Redirect to the public listing without ever rendering the personal profile.
      if (data?.user?.resolved_identity === "business" && data?.user?.user_id) {
        navigate(`/directory/${data.user.user_id}`, { replace: true });
        return;
      }
      setData(data);
      setFollowing(!!data.is_following);
      setFollowerCount(data.follower_count || 0);
      setBlocked(!!data.is_blocked);
    }).catch((e) => setErr(e?.response?.status === 404 ? "notfound" : "error"));
  }, [handle, navigate]);

  const signUp = async (ev) => {
    if (!user) { toast.message("Sign in to sign up for events"); window.location.href = "/login"; return; }
    setRsvpDone((m) => ({ ...m, [ev.id]: "busy" }));
    try {
      await api.post(`/events/${ev.id}/register`, { kind: "rsvp" });
      setRsvpDone((m) => ({ ...m, [ev.id]: "done" }));
      toast.success("You're signed up!");
    } catch (e) {
      setRsvpDone((m) => ({ ...m, [ev.id]: undefined }));
      toast.error(e?.response?.data?.detail || "Couldn't sign up");
    }
  };

  const toggleBlock = async () => {
    const uid = data?.user?.user_id;
    if (!uid || blockBusy) return;
    const next = !blocked;
    if (next && !window.confirm("Block this member? They won't be able to follow or message you, and you'll stop following them.")) return;
    setBlockBusy(true);
    try {
      if (next) { await api.post(`/follows/block/${uid}`); setFollowing(false); toast.success("Blocked"); }
      else { await api.delete(`/follows/block/${uid}`); toast.success("Unblocked"); }
      setBlocked(next);
    } catch { toast.error("Action failed"); }
    finally { setBlockBusy(false); }
  };

  const toggleFollow = async () => {
    const uid = data?.user?.user_id;
    if (!uid || followBusy) return;
    setFollowBusy(true);
    const next = !following;
    setFollowing(next);
    setFollowerCount((c) => c + (next ? 1 : -1));
    try {
      const { data: r } = next ? await api.post(`/follows/${uid}`) : await api.delete(`/follows/${uid}`);
      if (typeof r?.follower_count === "number") setFollowerCount(r.follower_count);
    } catch {
      setFollowing(!next);
      setFollowerCount((c) => c + (next ? -1 : 1));
    } finally {
      setFollowBusy(false);
    }
  };

  if (err === "notfound") return (
    <div className="bg-[var(--smn-bg)] dark:bg-slate-950" data-testid="handle-notfound">
      <section className="smn-hero text-white -mt-16 pt-24 pb-16 text-center">
        <div className="max-w-2xl mx-auto px-4">
          <h1 className="font-display font-extrabold text-3xl sm:text-4xl">@{handle}</h1>
          <p className="mt-3 text-slate-300">That username isn&apos;t in use yet.</p>
          <Link to="/directory" className="mt-6 inline-block bg-[#F2A03B] text-white rounded-full px-5 py-2 font-semibold">Browse the directory</Link>
        </div>
      </section>
      <WaveDivider className="text-[var(--smn-bg)]" />
    </div>
  );
  if (!data) return <div className="bg-[var(--smn-bg)] dark:bg-slate-950 min-h-[60vh] max-w-2xl mx-auto p-10 text-slate-500 dark:text-slate-400">Loading…</div>;
  const u = data.user;
  const isOrg = u.account_type === "partner";
  const isCommunityPartner = isOrg && !!u.partner_badge;
  const orgAccent = isCommunityPartner ? "#1F3F5B" : "#2A7871";
  // Club/Org profiles are fully public; other member profiles stay gated to signed-in users.
  if (!user && !isOrg) return <RequireAuth feature="view member profiles"><div /></RequireAuth>;
  const logoSrc = u.logo_url || u.picture || u.avatar;
  const cats = u.org_categories && u.org_categories.length ? u.org_categories : (u.org_category ? [u.org_category] : []);
  const canDM = user && user.user_id !== u.user_id;
  const isOwnOrg = isOrg && user && user.user_id === u.user_id;

  // One swipeable sequence for the full-size viewer: cover, gallery 1..5, logo.
  // The viewer shows the FULL uncropped ORIGINAL (falls back to the crop when no
  // original was stored); the page above still renders the crop.
  const orgMedia = [];
  if (u.cover_url) orgMedia.push({ src: u.cover_original_url || u.cover_url, alt: `${u.name} cover` });
  (u.photos || []).forEach((p, i) => orgMedia.push({ src: p.original || p.url, alt: p.caption || `${u.name} photo ${i + 1}` }));
  if (logoSrc) orgMedia.push({ src: u.logo_original_url || logoSrc, alt: `${u.name} logo` });
  const gallerySeqStart = u.cover_url ? 1 : 0;
  const logoSeqIdx = orgMedia.length - 1;

  if (isOrg) {
    return (
      <div data-testid="handle-profile-page" className="bg-[var(--smn-bg)] dark:bg-slate-950 min-h-screen">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <Link to="/clubs" data-testid="org-back-to-directory" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#1F3F5B] dark:hover:text-slate-200">
            <Icon name="arrow-left" tone="current" className="h-4 w-4" /> Back to directory
          </Link>

          <div className="mt-4 rounded-3xl overflow-hidden text-white break-words [overflow-wrap:anywhere]" style={{ backgroundColor: orgAccent }} data-testid="org-profile-card">
            {(u.cover_url || (Array.isArray(u.photos) && u.photos.length > 0)) && (
              <>
                {u.cover_url && (
                  <button type="button" onClick={() => setLightbox({ images: orgMedia, index: 0 })} className="block w-full" data-testid="org-hero-photo-btn" aria-label="View cover photo">
                    <img src={u.cover_url} alt={`${u.name} cover`} data-testid="org-hero-photo" className="w-full aspect-[3.5/1] object-cover" loading="lazy" />
                  </button>
                )}
                <PhotoGallery photos={u.photos} max={5}
                  onTileClick={(i) => setLightbox({ images: orgMedia, index: gallerySeqStart + i })}
                  containerTestId="org-photos-gallery" testIdPrefix="org-photo"
                  altFor={(i) => `${u.name} photo ${i + 1}`} bgClass="bg-white/10" />
              </>
            )}
            <div className="p-8">
              <div className="flex items-start gap-5 flex-wrap">
                <button type="button" disabled={!logoSrc} onClick={() => logoSrc && setLightbox({ images: orgMedia, index: logoSeqIdx })} data-testid="org-logo-btn" aria-label="View logo" className="rounded-full">
                  <LogoCircle src={logoSrc} size="h-20 w-20" alt={u.name || ""} testId="org-logo" fallback={<span className="h-full w-full flex items-center justify-center bg-white/10"><Icon name="org" tone="current" className="h-9 w-9 text-white/80" /></span>} />
                </button>
                <div className="flex-1 min-w-0">
                  {u.partner_badge && (
                    <div className="flex flex-wrap items-center gap-2">
                      <PartnerBadge kind={u.partner_badge} variant="full" />
                    </div>
                  )}
                  <h1 className="font-display font-extrabold text-3xl sm:text-4xl mt-3 flex items-center gap-2 text-white">
                    {u.name}
                    {u.identity_verified && <img src={ICON_VERIFIED} alt="Verified" title="Identity verified" className="h-6 w-6" />}
                  </h1>
                  <div className="mt-1 text-slate-200 font-mono text-sm" data-testid="handle-label">@{u.handle}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    {u.primary_market && <span className="inline-flex items-center gap-1 text-slate-200"><Icon name="location" tone="current" className="h-3.5 w-3.5" /> {u.primary_market}</span>}
                    {data.rating != null && (
                      <span className="inline-flex items-center gap-1 text-white font-semibold">
                        <Icon name="reviews" tone="current" className="h-4 w-4 text-[#F2A03B] fill-[#F2A03B]" /> {data.rating}
                        <span className="text-slate-200 font-normal">· {data.review_count}</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-sm" data-testid="handle-follow-counts">
                    <span className="text-white"><b data-testid="handle-follower-count">{followerCount}</b> <span className="text-slate-200">follower{followerCount === 1 ? "" : "s"}</span></span>
                    <span className="text-white"><b>{data.following_count || 0}</b> <span className="text-slate-200">following</span></span>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-2 flex-wrap">
                {canDM && (
                  blocked ? (
                    <button onClick={toggleBlock} disabled={blockBusy} data-testid="handle-unblock-btn"
                            className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold bg-white/15 text-white hover:bg-white/25">Unblock</button>
                  ) : (
                    <>
                      <button onClick={toggleFollow} disabled={followBusy} data-testid="handle-follow-btn"
                              className={`inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${following ? "bg-white/15 text-white hover:bg-white/25" : "bg-[#55B3AD] text-white hover:bg-[#489a94]"}`}>
                        <Icon name={following ? "check" : "add"} tone="current" className="h-4 w-4" /> {following ? "Following" : "Follow"}
                      </button>
                      <Link to={`/messages?to=${u.user_id}`} data-testid="handle-dm"
                            className="inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2.5 text-sm font-semibold">
                        <Icon name="message-square" tone="current" className="h-4 w-4" /> Message
                      </Link>
                      <button onClick={toggleBlock} disabled={blockBusy} data-testid="handle-block-btn" title="Block this member"
                              className="inline-flex items-center rounded-full px-4 py-2.5 text-sm font-semibold border border-white/25 text-white/80 hover:text-white hover:border-white/50">Block</button>
                    </>
                  )
                )}
                {isOwnOrg && (
                  <Link to="/org-listing" data-testid="org-edit-listing-btn"
                        className="inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2.5 text-sm font-semibold">
                    <Icon name="edit" tone="current" className="h-4 w-4" /> Edit my listing
                  </Link>
                )}
                {!user && (
                  <Link to="/login" data-testid="org-message-btn" className="inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2.5 text-sm font-semibold">
                    <Icon name="message-square" tone="current" className="h-4 w-4" /> Message this club
                  </Link>
                )}
                <ShareButton
                  path={`/u/${u.handle}`}
                  title={u.name}
                  text={`Check out ${u.name} on Sail More Now`}
                  label="Share"
                  testId="org-share-btn"
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/30 text-white hover:bg-white/10 px-4 py-2.5 text-sm font-semibold transition-colors"
                />
              </div>

              {u.bio && <p className="mt-6 text-base leading-relaxed text-slate-100">{u.bio}</p>}

              {cats.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-2">
                  {cats.map((c) => (
                    <span key={c} data-testid={`org-cat-${c}`} className="px-3 py-1 rounded-full text-xs font-medium bg-white/10 text-white">{c}</span>
                  ))}
                </div>
              )}

              <div className="mt-6 grid sm:grid-cols-3 gap-4 text-sm break-words [overflow-wrap:anywhere]" data-testid="org-contact-card">
                {u.website && (
                  <a href={u.website.startsWith("http") ? u.website : `https://${u.website}`} target="_blank" rel="noopener noreferrer" data-testid="org-website"
                     className="inline-flex items-center gap-2 text-white font-semibold hover:text-[#F2A03B]">
                    <Icon name="globe" tone="current" className="h-4 w-4 shrink-0 text-[#F2A03B]" /> {u.website.replace(/^https?:\/\//, "")}
                  </a>
                )}
                {u.public_email && (
                  <a href={`mailto:${u.public_email}`} data-testid="org-email" className="inline-flex items-center gap-2 text-slate-100 hover:text-[#F2A03B]">
                    <Icon name="mail" tone="current" className="h-4 w-4 shrink-0 text-[#F2A03B]" /> {u.public_email}
                  </a>
                )}
                {u.public_phone && (
                  <a href={`tel:${u.public_phone}`} data-testid="org-phone" className="inline-flex items-center gap-2 text-slate-100 hover:text-[#F2A03B]">
                    <Icon name="phone" tone="current" className="h-4 w-4 shrink-0 text-[#F2A03B]" /> {u.public_phone}
                  </a>
                )}
                {!u.website && !u.public_email && !u.public_phone && (
                  <p className="text-slate-300">No public contact details listed yet.</p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-6">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 sm:p-8" data-testid="org-events-card">
              <SectionEyebrow className="mb-3">Upcoming events</SectionEyebrow>
              {(!data.upcoming_events || data.upcoming_events.length === 0) ? (
                <p className="text-sm text-slate-400">No upcoming events scheduled.</p>
              ) : (
                <ul className="space-y-3">
                  {data.upcoming_events.map((ev) => (
                    <li key={ev.id} className="flex items-center justify-between gap-3 border-b border-slate-50 dark:border-slate-700/50 last:border-0 pb-3 last:pb-0" data-testid={`org-event-${ev.id}`}>
                      <div className="min-w-0">
                        <Link to="/events" className="text-sm font-semibold smn-heading truncate block hover:text-[#F2A03B]">{ev.title}</Link>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {(ev.starts_at || "").slice(0, 10)}{ev.location ? ` · ${ev.location}` : ev.market ? ` · ${ev.market}` : ""}
                        </div>
                      </div>
                      <button onClick={() => signUp(ev)} disabled={rsvpDone[ev.id] === "busy" || rsvpDone[ev.id] === "done"} data-testid={`org-event-signup-${ev.id}`}
                              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold ${rsvpDone[ev.id] === "done" ? "bg-emerald-100 text-emerald-700" : "bg-[#55B3AD] text-white hover:bg-[#489a94]"}`}>
                        {rsvpDone[ev.id] === "done" ? "Signed up ✓" : rsvpDone[ev.id] === "busy" ? "…" : "Sign up"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {data.recent_posts && data.recent_posts.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 sm:p-8" data-testid="org-activity-card">
                <SectionEyebrow className="mb-3">Recent activity</SectionEyebrow>
                <ul className="space-y-2">
                  {data.recent_posts.map((p) => {
                    const isDisc = p.type === "forum" || p.type === "blog";
                    return (
                      <li key={p.id} className="flex items-center justify-between gap-3">
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

            <div data-testid="org-reviews-card">
              <div className="flex items-center justify-end mb-3">
                <ReviewButton targetId={u.user_id} targetName={u.name} onPosted={() => setReviewsKey((k) => k + 1)} />
              </div>
              {!user && <p className="mb-3 text-sm text-slate-400"><Link to="/login" className="text-[#55B3AD] font-semibold hover:underline">Sign in</Link> to leave a review.</p>}
              <ReviewsSection targetId={u.user_id} kind="org" canReply={!!user && (user.user_id === u.user_id || user.platform_role === "admin" || user.is_admin)} refreshKey={reviewsKey} />
            </div>
          </div>
        </div>
        <ImageLightbox open={!!lightbox} images={lightbox?.images || []} index={lightbox?.index || 0}
          onClose={() => setLightbox(null)} onIndexChange={(i) => setLightbox((l) => (l ? { ...l, index: i } : l))} />
      </div>
    );
  }

  return (
    <div data-testid="handle-profile-page" className="bg-[var(--smn-bg)] dark:bg-slate-950">
      <section className="smn-hero text-white -mt-16 pt-24 sm:pt-28 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex items-start gap-5 flex-wrap">
          <Avatar src={logoSrc} className="h-24 w-24 ring-4 ring-white/20 bg-white" alt={u.name || ""} />
          <div className="flex-1 min-w-0">
            <SectionEyebrow tone="white" className="!text-[#55B3AD]">{isOrg ? "Club / Org profile" : (ACCOUNT_LABEL[u.account_type] ? `${ACCOUNT_LABEL[u.account_type]} profile` : "Member profile")}</SectionEyebrow>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl mt-2 flex items-center gap-2">
              {u.name}
              {u.identity_verified && <img src={ICON_VERIFIED} alt="Verified" title="Identity verified" className="h-6 w-6" />}
            </h1>
            <div className="mt-1 text-slate-300 font-mono text-sm" data-testid="handle-label">@{u.handle}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              {u.account_type && (
                <span data-testid="org-tier-badge" className={`font-bold uppercase tracking-widest px-2 py-1 rounded-full ${isCommunityPartner ? "bg-[#F2A03B] text-[#1F3F5B]" : isOrg ? "bg-[#55B3AD] text-[#1F3F5B]" : "bg-white/10 text-slate-100"}`}>{ACCOUNT_LABEL[u.account_type] || u.account_type}</span>
              )}
              <PartnerBadge kind={u.partner_badge} />
              {isOrg && cats.map((c) => (
                <span key={c} data-testid={`org-cat-${c}`} className="font-semibold px-2 py-1 rounded-full bg-[#55B3AD]/25 text-white">{c}</span>
              ))}
              {u.primary_market && <span className="inline-flex items-center gap-1 text-slate-300"><Icon name="location" tone="current" className="h-3 w-3" /> {u.primary_market}</span>}
              {data.rating != null && (
                <span className="inline-flex items-center gap-1 text-slate-100 font-semibold">
                  <Icon name="reviews" tone="current" className="h-3.5 w-3.5 text-[#F2A03B] fill-[#F2A03B]" /> {data.rating}
                  <span className="text-slate-300 font-normal">· {data.review_count}</span>
                </span>
              )}
            </div>
            <div className="mt-3 flex items-center gap-4 text-sm" data-testid="handle-follow-counts">
              <span className="text-slate-100"><b data-testid="handle-follower-count">{followerCount}</b> <span className="text-slate-300">follower{followerCount === 1 ? "" : "s"}</span></span>
              <span className="text-slate-100"><b>{data.following_count || 0}</b> <span className="text-slate-300">following</span></span>
            </div>
          </div>
          {canDM && (
            <div className="flex items-center gap-2">
              {blocked ? (
                <button onClick={toggleBlock} disabled={blockBusy} data-testid="handle-unblock-btn"
                        className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold bg-slate-200 text-slate-700 hover:bg-slate-300">Unblock</button>
              ) : (
                <>
                  <button onClick={toggleFollow} disabled={followBusy} data-testid="handle-follow-btn"
                          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${following ? "bg-white/15 text-white hover:bg-white/25" : "bg-[#55B3AD] text-white hover:bg-[#489a94]"}`}>
                    <Icon name={following ? "check" : "add"} tone="current" className="h-4 w-4" /> {following ? "Following" : "Follow"}
                  </button>
                  <Link to={`/messages?to=${u.user_id}`} data-testid="handle-dm"
                        className="inline-flex items-center gap-1 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-4 py-2 text-sm font-semibold">
                    <Icon name="message-square" tone="current" className="h-3.5 w-3.5" /> Message
                  </Link>
                  <button onClick={toggleBlock} disabled={blockBusy} data-testid="handle-block-btn" title="Block this member"
                          className="inline-flex items-center rounded-full px-3 py-2 text-sm font-semibold border border-white/25 text-white/80 hover:text-white hover:border-white/50">Block</button>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <WaveDivider className="text-[#17324a] dark:text-slate-950" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-6">
        {isOrg && (
          <Link to="/clubs" data-testid="org-back-to-directory" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#1F3F5B] dark:hover:text-slate-200">
            <Icon name="arrow-left" tone="current" className="h-4 w-4" /> Back to directory
          </Link>
        )}
        {u.account_type === "boat_owner" && (u.boat_name || u.boat_make_model) && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 sm:p-8" data-testid="handle-boat-card">
            <SectionEyebrow>Their boat</SectionEyebrow>
            <div className="mt-3 flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <Icon name="boatOwner" tone="current" className="h-5 w-5 text-[#55B3AD]" />
              <span className="font-semibold">{u.boat_name || "—"}</span>
              {u.boat_make_model && <span className="text-slate-500 dark:text-slate-400">· {u.boat_make_model}</span>}
            </div>
          </div>
        )}
        {u.bio && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 sm:p-8">
            <SectionEyebrow>About</SectionEyebrow>
            <p className="mt-3 text-slate-700 dark:text-slate-200 leading-relaxed break-words [overflow-wrap:anywhere] max-w-full">{u.bio}</p>
          </div>
        )}

        {isOrg && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 sm:p-8" data-testid="org-contact-card">
            <SectionEyebrow>Contact</SectionEyebrow>
            <div className="mt-3 space-y-2 text-sm">
              {u.website && (
                <a href={u.website.startsWith("http") ? u.website : `https://${u.website}`} target="_blank" rel="noopener noreferrer" data-testid="org-website"
                   className="flex items-center gap-2 text-[#1F3F5B] dark:text-slate-100 font-semibold hover:text-[#F2A03B]">
                  <Icon name="globe" tone="current" className="h-4 w-4 text-[#55B3AD]" /> {u.website.replace(/^https?:\/\//, "")}
                </a>
              )}
              {u.public_email && (
                <a href={`mailto:${u.public_email}`} data-testid="org-email" className="flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:text-[#F2A03B]">
                  <Icon name="mail" tone="current" className="h-4 w-4 text-[#55B3AD]" /> {u.public_email}
                </a>
              )}
              {u.public_phone && (
                <a href={`tel:${u.public_phone}`} data-testid="org-phone" className="flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:text-[#F2A03B]">
                  <Icon name="phone" tone="current" className="h-4 w-4 text-[#55B3AD]" /> {u.public_phone}
                </a>
              )}
              {!u.website && !u.public_email && !u.public_phone && (
                <p className="text-slate-400">No public contact details listed yet.</p>
              )}
            </div>
            <Link to={user ? (canDM ? `/messages?to=${u.user_id}` : "/messages") : "/login"} data-testid="org-message-btn"
                  className="mt-4 inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2 text-sm font-semibold">
              <Icon name="message-square" tone="current" className="h-4 w-4" /> Message {isOrg ? "this club" : ""}
            </Link>
          </div>
        )}

        {isOrg && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 sm:p-8" data-testid="org-events-card">
            <SectionEyebrow className="mb-3">Upcoming events</SectionEyebrow>
            {(!data.upcoming_events || data.upcoming_events.length === 0) ? (
              <p className="text-sm text-slate-400">No upcoming events scheduled.</p>
            ) : (
              <ul className="space-y-3">
                {data.upcoming_events.map((ev) => (
                  <li key={ev.id} className="flex items-center justify-between gap-3 border-b border-slate-50 dark:border-slate-700/50 last:border-0 pb-3 last:pb-0" data-testid={`org-event-${ev.id}`}>
                    <div className="min-w-0">
                      <Link to="/events" className="text-sm font-semibold smn-heading truncate block hover:text-[#F2A03B]">{ev.title}</Link>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {(ev.starts_at || "").slice(0, 10)}{ev.location ? ` · ${ev.location}` : ev.market ? ` · ${ev.market}` : ""}
                      </div>
                    </div>
                    <button onClick={() => signUp(ev)} disabled={rsvpDone[ev.id] === "busy" || rsvpDone[ev.id] === "done"} data-testid={`org-event-signup-${ev.id}`}
                            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold ${rsvpDone[ev.id] === "done" ? "bg-emerald-100 text-emerald-700" : "bg-[#55B3AD] text-white hover:bg-[#489a94]"}`}>
                      {rsvpDone[ev.id] === "done" ? "Signed up ✓" : rsvpDone[ev.id] === "busy" ? "…" : "Sign up"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {isOrg && data.recent_posts && data.recent_posts.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 sm:p-8" data-testid="org-activity-card">
            <SectionEyebrow className="mb-3">Recent activity</SectionEyebrow>
            <ul className="space-y-2">
              {data.recent_posts.map((p) => {
                const isDisc = p.type === "forum" || p.type === "blog";
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3">
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

        {!isOrg && (
          <div data-testid="member-reviews-card">
            <div className="flex items-center justify-end mb-3">
              <ReviewButton targetId={u.user_id} targetName={u.name} targetIdentity={u.account_type === "boat_pro" ? "personal" : undefined} onPosted={() => setReviewsKey((k) => k + 1)} />
            </div>
            <ReviewsSection targetId={u.user_id} kind="member" identity={u.account_type === "boat_pro" ? "personal" : "business"} canReply={!!user && user.user_id === u.user_id} refreshKey={reviewsKey} />
          </div>
        )}
        {!isOrg && data.recent_posts && data.recent_posts.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 sm:p-8" data-testid="handle-recent-posts">
            <SectionEyebrow className="mb-3">{isOrg ? "Recent activity" : "Recent posts"}</SectionEyebrow>
            <ul className="space-y-2">
              {data.recent_posts.map((p) => {
                const isDisc = p.type === "forum" || p.type === "blog";
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3">
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
      </div>
      <ImageLightbox open={!!lightbox} images={lightbox?.images || []} index={lightbox?.index || 0}
        onClose={() => setLightbox(null)} onIndexChange={(i) => setLightbox((l) => (l ? { ...l, index: i } : l))} />
    </div>
  );
}
