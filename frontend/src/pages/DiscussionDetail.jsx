import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import Avatar from "@/components/Avatar";
import AuthorBlock, { authorFromDoc } from "@/components/AuthorBlock";
import PostComments from "@/components/PostComments";
import Reactions from "@/components/Reactions";
import FlagButton from "@/components/FlagButton";
import AdminControls from "@/components/AdminControls";
import ShareButton from "@/components/ShareButton";
import InviteBanner from "@/components/InviteBanner";
import Linkify from "@/lib/linkify";

export default function DiscussionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get(`/discussions/${id}`).then(({ data }) => setD(data)).catch((e) => setErr(e?.response?.data?.detail || "Not found"));
  }, [id]);

  const approve = async () => {
    try { await api.post(`/discussions/${id}/approve`); toast.success("Published."); const { data } = await api.get(`/discussions/${id}`); setD(data); }
    catch { toast.error("Failed"); }
  };
  const del = async () => {
    if (!window.confirm("Delete this discussion?")) return;
    try { await api.delete(`/discussions/${id}`); toast.success("Deleted"); nav("/community-hub"); }
    catch { toast.error("Failed"); }
  };

  if (err) return <div className="max-w-3xl mx-auto p-10 text-center text-slate-500">{err}</div>;
  if (!d) return <div className="max-w-3xl mx-auto p-10 text-slate-500">Loading…</div>;

  const canDelete = user && (user.user_id === d.author_id || user.platform_role === "admin");
  const canApprove = user?.platform_role === "admin" && d.status !== "published";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="discussion-detail-page">
      <Link to="/community-hub" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[#1F3F5B]">
        <Icon name="arrow-left" tone="current" className="h-4 w-4" /> Back to Community Hub
      </Link>
      {!user && <InviteBanner blurb={`Sign up free to join the discussion on "${d.title}" and connect with PNW sailors.`} />}
      <div className="mt-4 bg-white rounded-3xl border border-slate-100 p-6 sm:p-8">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-slate-100 text-slate-700">
              {d.kind === "blog" ? "Blog" : "Forum"} · {d.status}
            </span>
            <h1 className="mt-3 font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl tracking-tight">{d.title}</h1>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <AuthorBlock {...authorFromDoc(d)} size="h-6 w-6" testId={`disc-detail-author-${d.id}`}
                           nameClassName="text-xs font-semibold text-slate-700"
                           subline={(
                             <div className="flex items-center gap-1 text-xs text-slate-500">
                               <Icon name="clock" tone="current" className="h-3 w-3" /><span>{(d.created_at || "").slice(0, 10)}</span>
                               {d.market && <span>· {d.market}</span>}
                             </div>
                           )} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canApprove && (
              <button onClick={approve} data-testid="detail-approve-btn"
                      className="inline-flex items-center gap-1 bg-[#55B3AD] hover:bg-[#3f9691] text-white rounded-full px-3 py-1.5 text-xs font-semibold">
                <Icon name="check" tone="current" className="h-3.5 w-3.5" /> Approve
              </button>
            )}
            <ShareButton
              path={`/community-hub/${d.id}`}
              title={d.title}
              text={`${d.kind === "blog" ? "Read" : "Join the discussion"}: "${d.title}" on Sail More Now`}
              iconOnly
              testId="discussion-share-btn"
            />
            <FlagButton targetType="discussion" targetId={d.id}
                        hidden={user?.user_id === d.author_id} />
            <AdminControls entity="discussion" item={d} compact
              onChanged={(next) => { if (!next) { nav("/community-hub"); } else { setD((cur) => ({ ...cur, ...next })); } }} />
            {canDelete && (
              <button onClick={del} data-testid="detail-delete-btn"
                      className="inline-flex items-center gap-1 text-slate-500 hover:text-red-500 text-xs font-semibold rounded-full border border-slate-200 px-3 py-1.5">
                <Icon name="delete" tone="current" className="h-3.5 w-3.5" /> Delete
              </button>
            )}
          </div>
        </div>

        {d.image_url && (
          <img src={d.image_url} alt={d.title} className="mt-6 w-full max-h-96 object-cover rounded-2xl" data-testid="discussion-cover" />
        )}
        <p className="mt-6 text-slate-700 whitespace-pre-wrap break-words leading-relaxed"><Linkify text={d.body} /></p>

        {d.tags && d.tags.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-1">
            {d.tags.map((t) => <span key={t} className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{t}</span>)}
          </div>
        )}

        <div className="mt-8">
          <Reactions targetType="discussion" targetId={d.id} className="mb-6" />
          <PostComments post={d} />
        </div>
      </div>
    </div>
  );
}
