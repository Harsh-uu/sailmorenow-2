import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/components/Icon";
import Avatar from "@/components/Avatar";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

const ORG_TYPES = new Set(["partner", "community_partner", "boat_pro"]);

function Row({ item, onUnfollow }) {
  const [busy, setBusy] = useState(false);
  const unfollow = async () => {
    setBusy(true);
    try { await api.delete(`/follows/${item.user_id}`); onUnfollow(item.user_id); toast.success(`Unfollowed ${item.name || "member"}`); }
    catch { toast.error("Couldn't unfollow"); setBusy(false); }
  };
  return (
    <div className="flex items-center gap-3 py-3 border-b border-slate-100 dark:border-slate-700" data-testid={`following-row-${item.user_id}`}>
      <Avatar user={item} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {item.handle
            ? <Link to={`/u/${item.handle}`} className="font-semibold text-[#1F3F5B] dark:text-slate-100 truncate hover:underline">{item.name || "Member"}</Link>
            : <span className="font-semibold text-[#1F3F5B] dark:text-slate-100 truncate">{item.name || "Member"}</span>}
          {item.partner_badge && <Icon name="flag" tone="current" className={`h-3.5 w-3.5 ${item.partner_badge === "founding" ? "text-[#F2A03B]" : "text-[#55B3AD]"}`} aria-label={item.partner_badge === "founding" ? "Founding Partner" : "Community Partner"} />}
        </div>
        {item.handle && <div className="text-xs text-slate-400">@{item.handle}</div>}
      </div>
      <button onClick={unfollow} disabled={busy} data-testid={`unfollow-${item.user_id}`}
              className="text-xs font-semibold rounded-full border border-slate-200 dark:border-slate-600 px-4 py-1.5 text-slate-600 dark:text-slate-300 hover:border-red-300 hover:text-red-600 disabled:opacity-50">
        {busy ? "…" : "Unfollow"}
      </button>
    </div>
  );
}

export default function FollowingList() {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!user) return;
    api.get("/follows").then(({ data }) => setOrgs(data.orgs || [])).catch(() => {}).finally(() => setLoading(false));
  }, [user]);

  const onUnfollow = (id) => setOrgs((prev) => prev.filter((o) => o.user_id !== id));
  const ql = q.trim().toLowerCase();
  const match = (o) => !ql || (o.name || "").toLowerCase().includes(ql) || (o.handle || "").toLowerCase().includes(ql);
  const filtered = orgs.filter(match);
  const people = filtered.filter((o) => !ORG_TYPES.has(o.account_type));
  const organizations = filtered.filter((o) => ORG_TYPES.has(o.account_type));

  if (!user) return <div className="max-w-2xl mx-auto p-10 text-slate-500">Please sign in.</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10" data-testid="following-list-page">
      <h1 className="font-display font-extrabold text-[#1F3F5B] dark:text-slate-100 text-3xl mb-2">Following</h1>
      <p className="text-slate-500 mb-6">Everyone and every organization you follow.</p>
      {!loading && orgs.length > 0 && (
        <div className="relative mb-6">
          <Icon name="search" tone="current" className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="following-search"
                 placeholder="Search by name or @username"
                 className="w-full rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 pl-10 pr-4 py-2.5 text-sm focus:border-[#55B3AD] outline-none dark:text-slate-100" />
        </div>
      )}
      {loading ? (
        <div className="text-slate-400 py-10 text-center">Loading…</div>
      ) : orgs.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-8 text-center" data-testid="following-empty">
          <p className="text-slate-500">You're not following anyone yet. Explore <Link to="/clubs" className="text-[#55B3AD] font-semibold">Clubs & Orgs</Link> or member profiles to follow along.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-slate-400 py-10 text-center" data-testid="following-no-match">No matches for "{q}".</div>
      ) : (
        <div className="space-y-8">
          <section data-testid="following-people">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#55B3AD] mb-1">People ({people.length})</div>
            {people.length === 0 ? <div className="text-sm text-slate-400 py-3">No people followed yet.</div>
              : people.map((p) => <Row key={p.user_id} item={p} onUnfollow={onUnfollow} />)}
          </section>
          <section data-testid="following-orgs">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#55B3AD] mb-1">Organizations ({organizations.length})</div>
            {organizations.length === 0 ? <div className="text-sm text-slate-400 py-3">No organizations followed yet.</div>
              : organizations.map((o) => <Row key={o.user_id} item={o} onUnfollow={onUnfollow} />)}
          </section>
        </div>
      )}
      <Suggestions show={!loading && orgs.length < 5} followingIds={orgs.map((o) => o.user_id)} onFollowed={(o) => setOrgs((prev) => [...prev, o])} />
      <FollowersAndBlocked />
    </div>
  );
}

function FollowersAndBlocked() {
  const [followers, setFollowers] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [fq, setFq] = useState("");
  const load = () => {
    api.get("/follows/followers").then(({ data }) => setFollowers(data.followers || [])).catch(() => {});
    api.get("/follows/blocked").then(({ data }) => setBlocked(data.blocked || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const block = async (f) => {
    setBusyId(f.user_id);
    try { await api.post(`/follows/block/${f.user_id}`); setFollowers((p) => p.filter((x) => x.user_id !== f.user_id)); setBlocked((p) => [...p, f]); toast.success(`Blocked ${f.name || "member"}`); }
    catch { toast.error("Couldn't block"); }
    finally { setBusyId(null); }
  };
  const unblock = async (b) => {
    setBusyId(b.user_id);
    try { await api.delete(`/follows/block/${b.user_id}`); setBlocked((p) => p.filter((x) => x.user_id !== b.user_id)); toast.success(`Unblocked ${b.name || "member"}`); }
    catch { toast.error("Couldn't unblock"); }
    finally { setBusyId(null); }
  };
  return (
    <>
      <section className="mt-10 pt-6 border-t border-slate-100 dark:border-slate-700" data-testid="followers-section">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#1F3F5B] dark:text-slate-200 mb-3">Your followers ({followers.length})</div>
        {followers.length > 8 && (
          <input value={fq} onChange={(e) => setFq(e.target.value)} data-testid="followers-search" placeholder="Search followers"
                 className="w-full mb-3 rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm focus:border-[#55B3AD] outline-none dark:text-slate-100" />
        )}
        {followers.length === 0 ? <p className="text-sm text-slate-400" data-testid="followers-empty">No followers yet.</p> : followers.filter((f) => { const q = fq.trim().toLowerCase(); return !q || (f.name || "").toLowerCase().includes(q) || (f.handle || "").toLowerCase().includes(q); }).map((f) => (
          <div key={f.user_id} className="flex items-center gap-3 py-3 border-b border-slate-100 dark:border-slate-700" data-testid={`follower-row-${f.user_id}`}>
            <Avatar user={f} size={44} />
            <div className="min-w-0 flex-1">
              {f.handle ? <Link to={`/u/${f.handle}`} className="font-semibold text-[#1F3F5B] dark:text-slate-100 truncate hover:underline">{f.name || "Member"}</Link>
                : <span className="font-semibold text-[#1F3F5B] dark:text-slate-100 truncate">{f.name || "Member"}</span>}
              {f.handle && <div className="text-xs text-slate-400">@{f.handle}</div>}
            </div>
            <button onClick={() => block(f)} disabled={busyId === f.user_id} data-testid={`block-${f.user_id}`}
                    className="text-xs font-semibold rounded-full border border-slate-200 dark:border-slate-600 px-4 py-1.5 text-slate-500 hover:border-red-300 hover:text-red-600 disabled:opacity-50">Block</button>
          </div>
        ))}
      </section>
      {blocked.length > 0 && (
        <section className="mt-8" data-testid="blocked-section">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-red-500 mb-3">Blocked ({blocked.length})</div>
          {blocked.map((b) => (
            <div key={b.user_id} className="flex items-center gap-3 py-3 border-b border-slate-100 dark:border-slate-700" data-testid={`blocked-row-${b.user_id}`}>
              <Avatar user={b} size={40} />
              <div className="min-w-0 flex-1"><span className="font-semibold text-slate-600 dark:text-slate-300 truncate">{b.name || "Member"}</span></div>
              <button onClick={() => unblock(b)} disabled={busyId === b.user_id} data-testid={`unblock-${b.user_id}`}
                      className="text-xs font-semibold rounded-full bg-slate-100 dark:bg-slate-700 px-4 py-1.5 text-slate-600 dark:text-slate-200 hover:bg-slate-200 disabled:opacity-50">Unblock</button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Suggestions({ show, followingIds, onFollowed }) {
  const [all, setAll] = useState([]);
  const [start, setStart] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const fetchIt = () => api.get("/follows/suggestions", { params: { limit: 12 } }).then(({ data }) => { setAll(data.suggestions || []); setStart(0); }).catch(() => {});
  useEffect(() => { if (show) fetchIt(); }, [show]);
  const pool = all.filter((s) => !followingIds.includes(s.user_id));
  const visible = pool.length <= 6 ? pool : pool.slice(start % pool.length).concat(pool.slice(0, start % pool.length)).slice(0, 6);
  if (!show || pool.length === 0) return null;
  const follow = async (s) => {
    setBusyId(s.user_id);
    try { await api.post(`/follows/${s.user_id}`); onFollowed(s); setAll((prev) => prev.filter((x) => x.user_id !== s.user_id)); toast.success(`Following ${s.name || "member"}`); }
    catch { toast.error("Couldn't follow"); }
    finally { setBusyId(null); }
  };
  const dismiss = async (s) => {
    setAll((prev) => prev.filter((x) => x.user_id !== s.user_id));
    try { await api.post(`/follows/suggestions/${s.user_id}/dismiss`); } catch { /* ignore */ }
  };
  return (
    <section className="mt-10 pt-6 border-t border-slate-100 dark:border-slate-700" data-testid="follow-suggestions">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#F2A03B]">Suggested for you</div>
        <button onClick={() => (pool.length > 6 ? setStart((s) => s + 6) : fetchIt())} data-testid="suggestions-refresh"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#55B3AD] hover:text-[#489a94]">
          <Icon name="refresh" tone="current" className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
      <div className="space-y-3">
        {visible.map((s) => (
          <div key={s.user_id} className="flex items-center gap-3" data-testid={`suggestion-${s.user_id}`}>
            <Avatar user={s} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {s.handle ? <Link to={`/u/${s.handle}`} className="font-semibold text-[#1F3F5B] dark:text-slate-100 truncate hover:underline">{s.name || "Member"}</Link>
                  : <span className="font-semibold text-[#1F3F5B] dark:text-slate-100 truncate">{s.name || "Member"}</span>}
                {s.partner_badge && <Icon name="flag" tone="current" className={`h-3.5 w-3.5 ${s.partner_badge === "founding" ? "text-[#F2A03B]" : "text-[#55B3AD]"}`} aria-label={s.partner_badge === "founding" ? "Founding Partner" : "Community Partner"} />}
              </div>
              {(s.reason || !s.is_org) && (
                <div className="text-xs text-[#55B3AD] font-medium">{s.reason || (s.is_org ? "" : "Sailor")}</div>
              )}
            </div>
            <button onClick={() => follow(s)} disabled={busyId === s.user_id} data-testid={`suggestion-follow-${s.user_id}`}
                    className="rounded-full bg-[#55B3AD] hover:bg-[#489a94] disabled:opacity-50 text-white px-4 py-1.5 text-sm font-semibold">Follow</button>
            <button onClick={() => dismiss(s)} data-testid={`suggestion-dismiss-${s.user_id}`} title="Not interested"
                    className="text-slate-300 hover:text-slate-500 p-1"><Icon name="close" tone="current" className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </section>
  );
}
