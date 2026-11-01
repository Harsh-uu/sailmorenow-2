import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useMarket } from "@/context/MarketContext";
import Avatar from "@/components/Avatar";
import LogoCircle from "@/components/LogoCircle";
import Rating from "@/components/Rating";
import SectionEyebrow from "@/components/SectionEyebrow";
import { toast } from "sonner";

function OrgActivityModal({ orgId, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!orgId) return;
    setData(null);
    api.get(`/follows/${orgId}/activity`).then(({ data }) => setData(data)).catch(() => setData({ activity: [] }));
  }, [orgId]);
  if (!orgId) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose} data-testid="org-activity-modal">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {!data ? (
          <div className="p-10 text-center text-slate-500">Loading…</div>
        ) : (
          <div className="p-6">
            <div className="flex items-center gap-3">
              <Avatar src={data.org?.picture || data.org?.avatar} alt={data.org?.name} className="h-12 w-12" fallback={<Icon name="org" tone="brand" />} />
              <div className="min-w-0 flex-1">
                <div className="font-display font-bold text-lg smn-heading truncate">{data.org?.name}</div>
                <div className="text-xs text-slate-500">{data.follower_count} follower{data.follower_count === 1 ? "" : "s"} · {data.upcoming_events} upcoming · {data.recent_posts} posts</div>
              </div>
              <button onClick={onClose} data-testid="org-activity-close" className="text-slate-400 hover:text-slate-600"><Icon name="close" tone="current" className="h-5 w-5" /></button>
            </div>
            <div className="mt-5 space-y-3">
              {data.activity.length === 0 && <div className="text-sm text-slate-500 text-center py-8">No recent activity yet.</div>}
              {data.activity.map((a) => (
                <div key={`${a.kind}-${a.id}`} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-700" data-testid={`org-activity-${a.kind}-${a.id}`}>
                  <div className="h-9 w-9 rounded-full bg-[#55B3AD]/15 flex items-center justify-center shrink-0">
                    <Icon name={a.kind === "event" ? "events" : "message-square"} tone="brand" className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{a.kind === "event" ? "Event" : a.post_type || "Post"}</div>
                    <Link to={a.kind === "event" ? `/events?event=${a.id}` : "/feed"} onClick={onClose} className="font-semibold smn-heading hover:text-[#55B3AD] block truncate">{a.title || "(untitled)"}</Link>
                    {a.kind === "event" && <div className="text-xs text-slate-500 mt-0.5">{a.location || a.market}</div>}
                    {a.kind === "post" && a.body && <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2 mt-0.5">{a.body}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Clubs() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { market } = useMarket();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [orgCategory, setOrgCategory] = useState("");
  const [orgCategories, setOrgCategories] = useState([]);
  const [followingIds, setFollowingIds] = useState(new Set());
  const [blockedIds, setBlockedIds] = useState(new Set());
  const [busyId, setBusyId] = useState(null);
  const [activityOrg, setActivityOrg] = useState(null);
  const [feed, setFeed] = useState(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [search, setSearch] = useState("");

  const loadFeed = useCallback(() => {
    if (!user) { setFeed(null); return; }
    api.get("/follows/feed").then(({ data }) => setFeed(data)).catch(() => {});
  }, [user]);

  useEffect(() => { api.get("/markets").then(({ data }) => setOrgCategories(data.org_categories || [])).catch(() => {}); }, []);
  useEffect(() => {
    setData(null);
    const params = {};
    if (market && market !== "all") params.market = market;
    if (orgCategory) params.category = orgCategory;
    api.get("/partners", { params }).then(({ data }) => setData(data)).catch((e) => setErr(e?.response?.data?.detail || "Failed to load"));
  }, [market, orgCategory]);
  useEffect(() => {
    if (!user) { setFollowingIds(new Set()); setFeed(null); setBlockedIds(new Set()); return; }
    api.get("/follows").then(({ data }) => setFollowingIds(new Set(data.ids || []))).catch(() => {});
    api.get("/follows/blocked").then(({ data }) => setBlockedIds(new Set((data.blocked || []).map((b) => b.user_id)))).catch(() => {});
    loadFeed();
  }, [user, loadFeed]);

  const toggleFollow = useCallback(async (org) => {
    if (!user) { toast.error("Sign in to follow organizations"); return; }
    const id = org.user_id;
    const isFollowing = followingIds.has(id);
    setBusyId(id);
    try {
      if (isFollowing) { await api.delete(`/follows/${id}`); setFollowingIds((s) => { const n = new Set(s); n.delete(id); return n; }); }
      else { await api.post(`/follows/${id}`); setFollowingIds((s) => new Set(s).add(id)); toast.success(`Following ${org.name}`); }
    } catch { toast.error("Couldn't update follow"); } finally { setBusyId(null); loadFeed(); }
  }, [user, followingIds, loadFeed]);

  const toggleBlock = useCallback(async (org) => {
    if (!user) { toast.error("Sign in first"); return; }
    const id = org.user_id;
    const isBlocked = blockedIds.has(id);
    setBusyId(id);
    try {
      if (isBlocked) { await api.delete(`/follows/block/${id}`); setBlockedIds((s) => { const n = new Set(s); n.delete(id); return n; }); toast.success("Unblocked"); }
      else {
        await api.post(`/follows/block/${id}`);
        setBlockedIds((s) => new Set(s).add(id));
        setFollowingIds((s) => { const n = new Set(s); n.delete(id); return n; });
        toast.success(`Blocked ${org.name}`);
      }
    } catch { toast.error("Couldn't update"); } finally { setBusyId(null); }
  }, [user, blockedIds]);

  return (
    <div className="bg-[var(--smn-bg)] dark:bg-slate-950 min-h-screen" data-testid="clubs-page">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <SectionEyebrow>Clubs &amp; Organizations</SectionEyebrow>
        <h1 className="font-display font-extrabold smn-heading text-3xl sm:text-4xl mt-2 tracking-tight">Sailing clubs &amp; community partners</h1>
        <p className="text-slate-600 dark:text-slate-300 mt-3 max-w-2xl">Follow the organizations growing the Pacific Northwest sailing scene to keep up with their events and posts.</p>

        {user?.account_type === "partner" && (
          <Link to="/org-listing" data-testid="clubs-edit-my-listing"
                className="mt-5 inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] text-[#1F3F5B] rounded-full px-5 py-2.5 text-sm font-bold">
            <Icon name="edit" tone="current" className="h-4 w-4" /> Edit my listing
          </Link>
        )}

        {!user && (
          <div data-testid="clubs-guest-cta" className="mt-6 rounded-2xl border border-[#F2A03B]/40 bg-[#F2A03B]/[0.07] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="font-display font-bold smn-heading text-lg">Browsing as a guest</div>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">Create a free account to follow clubs & organizations, see their contact details, and get their event updates.</p>
            </div>
            <Link to="/register" data-testid="clubs-guest-signup" className="inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 font-semibold shrink-0">
              Create an account <Icon name="arrow-right" tone="current" className="h-4 w-4" />
            </Link>
          </div>
        )}

        <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3 max-w-2xl" data-testid="clubs-filter-row">
          <div className="relative flex-1 w-full" data-testid="clubs-search-wrap">
            <Icon name="search" tone="current" className="h-4 w-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="clubs-search-input"
              placeholder="Search organizations by name…"
              className="w-full rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-11 pr-10 py-2.5 text-sm text-[#1F3F5B] dark:text-slate-100 outline-none focus:border-[#55B3AD] focus:ring-2 focus:ring-[#55B3AD]" />
            {search && (
              <button onClick={() => setSearch("")} data-testid="clubs-search-clear" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <Icon name="close" tone="current" className="h-4 w-4" />
              </button>
            )}
          </div>
          <select value={orgCategory} onChange={(e) => setOrgCategory(e.target.value)} data-testid="org-category-select"
            aria-label="Category"
            className="w-full sm:w-auto shrink-0 min-h-[44px] rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-[#1F3F5B] dark:text-slate-100 outline-none focus:border-[#55B3AD] focus:ring-2 focus:ring-[#55B3AD]">
            <option value="">All categories</option>
            {orgCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {err && <div className="mt-8 text-red-500" data-testid="clubs-error">{err}</div>}        {!data && !err && <div className="mt-8 text-slate-500">Loading…</div>}
        {data && data.partners.length === 0 && (
          <div className="mt-8 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center text-slate-500" data-testid="clubs-empty">No organizations listed yet.</div>
        )}

        {feed && feed.activity && feed.activity.length > 0 && (
          <div className="mt-8 rounded-2xl border border-[#55B3AD]/30 bg-white dark:bg-slate-900 p-5" data-testid="following-feed">
            <button
              type="button"
              onClick={() => setFeedOpen((o) => !o)}
              aria-expanded={feedOpen}
              data-testid="following-feed-toggle"
              className={`flex items-center gap-2 w-full text-left ${feedOpen ? "mb-3" : ""}`}>
              <Icon name="hub" tone="brand" className="h-5 w-5" />
              <h2 className="font-display font-bold smn-heading text-lg">From people and orgs you follow</h2>
              <span className="text-xs text-slate-500 ml-auto">{feed.following_count} following</span>
              <Icon name={feedOpen ? "chevron-up" : "chevron-down"} tone="current" className="h-5 w-5 text-slate-400 shrink-0" />
            </button>
            {feedOpen && (
            <div className="space-y-2">
              {feed.activity.slice(0, 8).map((a) => (
                <div key={`${a.kind}-${a.id}`} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-800" data-testid={`following-feed-${a.kind}-${a.id}`}>
                  <div className="h-9 w-9 rounded-full bg-[#55B3AD]/15 flex items-center justify-center shrink-0">
                    <Icon name={a.kind === "event" ? "events" : "message-square"} tone="brand" className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{a.org?.name || (a.kind === "event" ? "Event" : "Post")}</div>
                    <Link to={a.kind === "event" ? `/events?event=${a.id}` : "/feed"} className="font-semibold smn-heading hover:text-[#55B3AD] block truncate">{a.title || "(untitled)"}</Link>
                    {a.kind === "event" && <div className="text-xs text-slate-500 mt-0.5">{a.location || a.market}</div>}
                    {a.kind === "post" && a.body && <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2 mt-0.5">{a.body}</p>}
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>
        )}

        {data && data.partners.length > 0 && search.trim() && data.partners.filter((p) => {
          const q = search.trim().toLowerCase();
          return (p.name || "").toLowerCase().includes(q) || (p.handle || "").toLowerCase().includes(q);
        }).length === 0 && (
          <div className="mt-8 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center text-slate-500" data-testid="clubs-search-empty">No organizations match “{search}”.</div>
        )}

        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {(data?.partners || []).filter((p) => {
            const q = search.trim().toLowerCase();
            return !q || (p.name || "").toLowerCase().includes(q) || (p.handle || "").toLowerCase().includes(q);
          }).map((p) => {
            const following = followingIds.has(p.user_id);
            const blocked = blockedIds.has(p.user_id);
            const isSelf = user?.user_id === p.user_id;
            const isCP = !!p.partner_badge; // Community Partner or Founding Partner → navy card
            const isFounding = p.partner_badge === "founding";
            const base = isCP ? "bg-[#1F3F5B] text-white border border-[#1F3F5B]" : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700";
            const openCard = () => { if (p.handle) nav(`/u/${p.handle}`); };
            return (
              <div key={p.user_id} role="link" tabIndex={0} onClick={openCard}
                   onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(); } }}
                   data-testid={`club-card-${p.handle || p.user_id}`}
                   className={`relative min-w-0 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all cursor-pointer flex flex-col ${base}`}>
                {isCP && (
                  <span className="absolute top-4 right-4" title={isFounding ? "Founding Partner" : "Community Partner"} aria-label={isFounding ? "Founding Partner" : "Community Partner"}>
                    <Icon name="flag" tone="current" className={`h-5 w-5 ${isFounding ? "text-[#F2A03B]" : "text-[#55B3AD]"}`} data-testid={`${isFounding ? "fp" : "cp"}-flag-${p.user_id}`} />
                  </span>
                )}
                <div className="flex items-start gap-3 pr-8">
                  <LogoCircle src={p.logo_url || p.picture || p.avatar} alt={p.name} testId={`club-logo-${p.user_id}`}
                    fallback={<span className={`h-full w-full flex items-center justify-center ${isCP ? "bg-white/15" : "bg-[#1F3F5B]/10 dark:bg-[#55B3AD]/15"}`}><Icon name="org" tone="current" className={`h-7 w-7 ${isCP ? "text-white" : "text-[#1F3F5B] dark:text-[#7fcac4]"}`} /></span>} />
                  <div className="min-w-0 flex-1">
                    <h3 className={`font-display font-bold text-lg leading-tight flex items-center gap-1 ${isCP ? "text-white" : "smn-heading"}`}>
                      <span className="truncate">{p.name}</span>
                      {p.identity_verified && <Icon name="verified" tone="current" className={`h-4 w-4 shrink-0 ${isCP ? "text-white" : "text-[#55B3AD]"}`} />}
                    </h3>
                    {p.primary_market && <div className={`text-xs flex items-center gap-1 mt-0.5 ${isCP ? "text-slate-200" : "text-slate-500"}`}><Icon name="location" tone="current" className="h-3 w-3" /> {p.primary_market}</div>}
                    {p.handle && <div className={`text-[11px] font-mono mt-1 ${isCP ? "text-slate-200" : "text-slate-500"}`}>@{p.handle}</div>}
                  </div>
                </div>
                {p.bio && <p className={`mt-3 text-sm line-clamp-3 ${isCP ? "text-slate-200" : "text-slate-600 dark:text-slate-300"}`}>{p.bio}</p>}
                <div className="mt-3 flex items-center justify-between">
                  <Rating value={p.rating || 0} count={p.review_count || 0} />
                  <span className={`text-xs ${isCP ? "text-slate-300" : "text-slate-500"}`} data-testid={`follower-count-${p.user_id}`}>{p.follower_count || 0} follower{(p.follower_count || 0) === 1 ? "" : "s"}</span>
                </div>
                <div className={`mt-4 pt-3 border-t ${isCP ? "border-white/15" : "border-slate-100 dark:border-slate-800"}`}>
                  {isSelf ? (
                    <div className="flex items-center gap-2">
                      <Link to="/org-listing" data-testid={`edit-listing-${p.user_id}`} onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold rounded-full px-3.5 py-1.5 bg-[#F2A03B] text-[#1F3F5B] hover:bg-[#d98c30] transition-colors">
                        <Icon name="edit" tone="current" className="h-4 w-4" /> Edit
                      </Link>
                      <button onClick={(e) => { e.stopPropagation(); setActivityOrg(p.user_id); }} data-testid={`view-activity-${p.user_id}`}
                              className={`inline-flex items-center gap-1 text-sm font-semibold ml-auto hover:underline ${isCP ? "text-[#9fe0da]" : "text-[#55B3AD]"}`}>
                        Activity <Icon name="arrow-right" tone="current" className="h-4 w-4" />
                      </button>
                    </div>
                  ) : blocked ? (
                    <div className="flex items-center gap-2">
                      <button onClick={(e) => { e.stopPropagation(); toggleBlock(p); }} disabled={busyId === p.user_id} data-testid={`unblock-btn-${p.user_id}`}
                              className={`inline-flex items-center gap-1.5 text-sm font-semibold rounded-full px-3.5 py-1.5 ${isCP ? "bg-white/15 text-white" : "bg-slate-200 text-slate-700 hover:bg-slate-300"}`}>
                        Unblock
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setActivityOrg(p.user_id); }} data-testid={`view-activity-${p.user_id}`}
                              className={`inline-flex items-center gap-1 text-sm font-semibold ml-auto hover:underline ${isCP ? "text-[#9fe0da]" : "text-[#55B3AD]"}`}>
                        Activity <Icon name="arrow-right" tone="current" className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button onClick={(e) => { e.stopPropagation(); toggleFollow(p); }} disabled={busyId === p.user_id} data-testid={`follow-btn-${p.user_id}`}
                              className={`inline-flex items-center gap-1.5 text-sm font-semibold rounded-full px-3 py-1.5 transition-colors ${following ? (isCP ? "bg-white/15 text-white" : "bg-[#55B3AD]/15 text-[#2A7871] dark:text-[#7fcac4]") : "bg-[#55B3AD] text-white hover:bg-[#489a94]"}`}>
                        <Icon name={following ? "check" : "add"} tone="current" className="h-4 w-4" /> {following ? "Following" : "Follow"}
                      </button>
                      <Link to={`/messages?to=${p.user_id}`} onClick={(e) => e.stopPropagation()} data-testid={`message-btn-${p.user_id}`}
                            className={`inline-flex items-center gap-1.5 text-sm font-semibold rounded-full px-3 py-1.5 ${isCP ? "bg-[#F2A03B] text-[#1F3F5B] hover:bg-[#d98c30]" : "bg-[#1F3F5B] text-white hover:bg-[#17324a]"}`}>
                        <Icon name="message-square" tone="current" className="h-4 w-4" /> Message
                      </Link>
                      <button onClick={(e) => { e.stopPropagation(); setActivityOrg(p.user_id); }} data-testid={`view-activity-${p.user_id}`}
                              className={`inline-flex items-center gap-1 text-sm font-semibold ml-auto hover:underline ${isCP ? "text-[#9fe0da]" : "text-[#55B3AD]"}`}>
                        Activity <Icon name="arrow-right" tone="current" className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <OrgActivityModal orgId={activityOrg} onClose={() => setActivityOrg(null)} />
    </div>
  );
}
