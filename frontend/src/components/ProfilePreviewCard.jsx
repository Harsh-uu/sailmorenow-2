import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import Avatar from "@/components/Avatar";
import { toast } from "sonner";

const ROLE_LABELS = {
  boat_owner: "Boat Owner", boat_pro: "Boat Pro", crew: "Crew",
  organization: "Club / Org", club: "Club / Org", sailor: "Sailor",
};

export default function ProfilePreviewCard({ handle, onMouseEnter, onMouseLeave }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api.get(`/u/${handle}`).then(({ data }) => { if (active) { setData(data); setFollowing(!!data.is_following); } }).catch(() => {});
    return () => { active = false; };
  }, [handle]);

  const u = data?.user;
  const toggleFollow = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!u) return;
    setBusy(true);
    try {
      if (following) { await api.delete(`/follows/${u.user_id}`); setFollowing(false); }
      else { await api.post(`/follows/${u.user_id}`); setFollowing(true); }
    } catch (err) { toast.error(err?.response?.data?.detail || "Couldn't update follow"); }
    finally { setBusy(false); }
  };

  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
         className="absolute top-full left-0 mt-1 z-50 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 p-4 text-left cursor-default"
         data-testid="profile-preview-card" onClick={(e) => e.stopPropagation()}>
      {!u ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Avatar src={u.picture || u.avatar} className="h-12 w-12" alt={u.name || ""} />
            <div className="min-w-0">
              <Link to={`/u/${handle}`} className="font-semibold text-[#1F3F5B] truncate block hover:underline" onClick={(e) => e.stopPropagation()}>{u.name || "Member"}</Link>
              <div className="text-xs text-slate-500 truncate">{ROLE_LABELS[u.account_type] || "Member"}{u.primary_market ? ` · ${u.primary_market}` : ""}</div>
            </div>
          </div>
          {u.bio && <div className="mt-2 text-xs text-slate-600 overflow-hidden" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{u.bio}</div>}
          <div className="mt-3 flex items-center gap-2">
            {user && user.user_id !== u.user_id && (
              <button onClick={toggleFollow} disabled={busy} data-testid="preview-follow-btn"
                      className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${following ? "bg-slate-100 text-slate-600 hover:bg-slate-200" : "bg-[#F2A03B] text-white hover:bg-[#d98c30]"}`}>
                {following ? "Following" : "Follow"}
              </button>
            )}
            <Link to={`/u/${handle}`} onClick={(e) => e.stopPropagation()} data-testid="preview-view-profile"
                  className="flex-1 text-center rounded-full px-3 py-1.5 text-xs font-semibold border border-slate-200 text-[#1F3F5B] hover:bg-slate-50">
              View profile
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
