import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useAppSocket } from "@/context/WebSocketContext";
import { toast } from "sonner";
import Avatar from "@/components/Avatar";
import FlagButton from "@/components/FlagButton";
import AdminControls from "@/components/AdminControls";
import MentionTextarea from "@/components/MentionTextarea";
import AuthorLink from "@/components/AuthorLink";
import AuthorBlock, { authorFromDoc } from "@/components/AuthorBlock";
import PostingAs from "@/components/PostingAs";
import Linkify from "@/lib/linkify";

/**
 * Threaded comments panel for a Feed post or Hub discussion.
 * Renders as flat-with-indent (one level of nesting). Deeper replies still
 * work but roll up under their nearest visible ancestor.
 */

export default function PostComments({ post, onCountChange, defaultOpen = false }) {
  const { user } = useAuth();
  const { subscribe } = useAppSocket();
  const [open, setOpen] = useState(defaultOpen);
  const [comments, setComments] = useState([]);
  const [count, setCount] = useState(post.comment_count ?? 0);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState(user?.active_identity || "personal");

  useEffect(() => { setIdentity(user?.active_identity || "personal"); }, [user?.active_identity]);

  const commentsDisabled = post.allow_comments === false;

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/posts/${post.id}/comments`);
      setComments(data || []);
      setCount(data?.length || 0);
      onCountChange?.(data?.length || 0);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) load(); }, [open, post.id]);

  // Live comment-count updates via the shared app WebSocket. Each card just
  // subscribes to `comment.count` events for its post id — no per-card socket.
  useEffect(() => {
    const off = subscribe("comment.count", (msg) => {
      if (msg?.post_id !== post.id) return;
      setCount(msg.count);
      onCountChange?.(msg.count);
      if (open) load();
    });
    return off;
  }, [post.id, open, subscribe]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!user) return toast.error("Sign in to comment");
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      await api.post(`/posts/${post.id}/comments`, { body: text, parent_id: replyTo?.id || null, identity });
      setDraft("");
      setReplyTo(null);
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const del = async (c) => {
    if (!window.confirm("Delete this comment?")) return;
    try {
      await api.delete(`/comments/${c.id}`);
      await load();
    } catch { toast.error("Failed"); }
  };

  // Build a recursive comment tree so replies-of-replies stay in-line up to a
  // reasonable depth (MAX_DEPTH). Deeper nesting still renders — it just stops
  // indenting further so long threads don't run off the right edge on mobile.
  const MAX_INDENT_DEPTH = 4;
  const roots = comments.filter((c) => !c.parent_id);
  const childrenOf = (pid) => comments.filter((c) => c.parent_id === pid);

  const renderComment = (c, depth = 0) => {
    const indentDepth = Math.min(depth, MAX_INDENT_DEPTH);
    return (
    <div key={c.id} className={`${indentDepth > 0 ? "ml-6 pl-3 border-l-2 border-slate-100" : ""}`} data-testid={`comment-${c.id}`}>
      <div className="flex items-start gap-2 py-2">
        <AuthorBlock
          {...authorFromDoc(c)}
          size="h-7 w-7"
          testId={`comment-author-${c.id}`}
          nameClassName="text-xs font-semibold text-[#1F3F5B]"
          subline={(
            <div className="text-xs">
              <span className="text-slate-400">{new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            </div>
          )}
        />
      </div>
      <div className="ml-9">
        <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap break-words"><Linkify text={c.body} /></div>
        <div className="mt-1 flex items-center gap-3 text-xs">
          {user && (
            <button onClick={() => setReplyTo(c)} className="text-slate-500 hover:text-[#1F3F5B] inline-flex items-center gap-1" data-testid={`reply-${c.id}`}>
              <Icon name="corner-down-right" tone="current" className="h-3 w-3" /> Reply
            </button>
          )}
          {user && user.user_id !== c.author_id && (
            <FlagButton targetType="comment" targetId={c.id} size="xs" label="" />
          )}
          <AdminControls entity="comment" item={c} compact onChanged={() => load()} />
          {user && c.author_id === user.user_id && user.platform_role !== "admin" && (
            <button onClick={() => del(c)} className="text-slate-400 hover:text-red-500 inline-flex items-center gap-1" data-testid={`del-${c.id}`}>
              <Icon name="delete" tone="current" className="h-3 w-3" /> Delete
            </button>
          )}
        </div>
      </div>
      {childrenOf(c.id).map((child) => renderComment(child, depth + 1))}
    </div>
    );
  };

  return (
    <div className="mt-4 pt-3 border-t border-slate-100" data-testid={`comments-${post.id}`}>
      <button onClick={() => setOpen(!open)}
              className="text-xs font-semibold text-slate-500 hover:text-[#1F3F5B] inline-flex items-center gap-1"
              data-testid={`toggle-comments-${post.id}`}>
        <Icon name="message-square" tone="current" className="h-3.5 w-3.5" />
        {open ? "Hide" : "Show"} comments {count > 0 && `(${count})`}
      </button>

      {open && (
        <div className="mt-3">
          {loading && <div className="text-sm text-slate-400">Loading…</div>}
          {!loading && roots.length === 0 && (
            <div className="text-sm text-slate-500">{commentsDisabled ? "Comments are turned off on this post." : "No comments yet."}</div>
          )}
          <div className="divide-y divide-slate-50">
            {roots.map((c) => renderComment(c, 0))}
          </div>

          {!commentsDisabled ? (
            user ? (
              <div className="mt-3">
                {replyTo && (
                  <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                    Replying to <b>{replyTo.author_name}</b>
                    <button onClick={() => setReplyTo(null)} className="text-slate-400 hover:text-red-500 ml-1">cancel</button>
                  </div>
                )}
                <div className="flex gap-2">
                  <MentionTextarea
                    value={draft}
                    onChange={setDraft}
                    onSubmit={submit}
                    disabled={busy}
                    rows={2}
                    placeholder={replyTo ? `Reply to ${replyTo.author_name}…  Type @ to mention someone` : "Add a comment…  Type @ to mention someone"}
                    className="flex-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm"
                    testId={`comment-input-${post.id}`}
                  />
                  <button onClick={submit} disabled={busy || !draft.trim()} data-testid={`comment-submit-${post.id}`}
                          className="self-end bg-[#1F3F5B] hover:bg-[#152a3d] disabled:opacity-50 text-white rounded-full px-4 py-2 text-sm font-semibold">
                    Post
                  </button>
                </div>
                <div className="mt-2"><PostingAs value={identity} onChange={setIdentity} testId={`comment-posting-as-${post.id}`} /></div>
              </div>
            ) : (
              <div className="mt-3 text-xs text-slate-500">
                <Link to="/" className="text-[#F2A03B] font-semibold">Sign in</Link> to comment.
              </div>
            )
          ) : (
            roots.length > 0 && <div className="mt-2 text-xs text-slate-400 italic">The author has turned off new comments.</div>
          )}
        </div>
      )}
    </div>
  );
}
