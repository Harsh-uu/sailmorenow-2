import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { canParticipate, promptUpgrade } from "@/lib/plan";
import { useMarket } from "@/context/MarketContext";
import { toast } from "sonner";
import Modal from "@/components/Modal";
import Avatar from "@/components/Avatar";
import MentionTextarea from "@/components/MentionTextarea";
import WaveDivider from "@/components/WaveDivider";
import SectionEyebrow from "@/components/SectionEyebrow";
import FlyerUploader from "@/components/FlyerUploader";
import MultiSelectPicker from "@/components/MultiSelectPicker";
import SaveButton, { useSaved } from "@/components/SaveButton";
import Reactions from "@/components/Reactions";
import PostComments from "@/components/PostComments";
import AuthorLink from "@/components/AuthorLink";
import AuthorBlock, { authorFromDoc } from "@/components/AuthorBlock";
import AuthorActions from "@/components/AuthorActions";
import PostingAs from "@/components/PostingAs";
import Linkify from "@/lib/linkify";

const KIND_META = {
  blog: { label: "Blog", icon: "book-open", blurb: "Long-form posts from the community. Drafts are reviewed by admins before going live." },
  forum: { label: "Forum", icon: "messages-square", blurb: "Start a topic. Everyone can jump in. Comments are on by default." },
};

const ALL_MKT = "__all__";

export default function CommunityHub({ embedded = false, lockKind = null }) {
  const { user } = useAuth();
  const { market } = useMarket();
  const [kind, setKind] = useState(lockKind || "blog");
  const { isSaved, toggle: toggleSaved } = useSaved();
  const [items, setItems] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ title: "", body: "", tags: "", image_url: "", identity: "personal", market: null });
  const [markets, setMarkets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState([]);
  const [reactions, setReactions] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [expandedPending, setExpandedPending] = useState(null);

  const load = async () => {
    const { data } = await api.get("/discussions", { params: { kind, market: market !== "all" ? market : undefined } });
    const list = data || [];
    setItems(list);
    if (list.length) {
      api.post("/reactions/batch", { items: list.map((d) => ({ target_type: "discussion", target_id: d.id })) })
        .then(({ data: r }) => setReactions(r || {})).catch(() => setReactions({}));
    } else {
      setReactions({});
    }
    if (user?.platform_role === "admin" && kind === "blog") {
      try {
        const { data: p } = await api.get("/discussions", { params: { kind: "blog", status: "pending" } });
        setPending(p || []);
      } catch { setPending([]); }
    } else { setPending([]); }
  };
  useEffect(() => { load(); }, [kind, market, user]);
  useEffect(() => { api.get("/markets").then(({ data }) => setMarkets(data?.markets || [])).catch(() => {}); }, []);

  const create = async () => {
    if (!user) return toast.error("Sign in first");
    if (!draft.title.trim() || !draft.body.trim()) return toast.error("Title and body are required");
    setBusy(true);
    if (editingId) {
      try {
        const { data } = await api.patch(`/discussions/${editingId}`, {
          title: draft.title.trim(), body: draft.body.trim(),
          tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
          image_url: draft.image_url || null,
        });
        setItems((cur) => cur.map((x) => x.id === editingId ? { ...x, ...data } : x));
        toast.success("Saved");
        setEditingId(null);
        setDraft({ title: "", body: "", tags: "", image_url: "", identity: "personal", market: null });
        setShowCreate(false);
      } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't save"); }
      finally { setBusy(false); }
      return;
    }
    try {
      await api.post("/discussions", {
        kind, title: draft.title, body: draft.body,
        market: draft.market || null,
        tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
        image_url: draft.image_url || null,
        identity: draft.identity || undefined,
      });
      toast.success(kind === "forum" ? "Topic posted." : "Draft submitted for admin review.");
      setDraft({ title: "", body: "", tags: "", image_url: "", identity: "personal", market: null });
      setShowCreate(false);
      load();
    } catch (e) { if (e?.upgradeHandled) return; toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const approve = async (id) => {
    try { await api.post(`/discussions/${id}/approve`); toast.success("Published."); load(); }
    catch { toast.error("Failed"); }
  };

  const startEdit = (d) => {
    setEditingId(d.id);
    setDraft({ title: d.title || "", body: d.body || "", tags: (d.tags || []).join(", "), image_url: d.image_url || "", identity: d.author_identity || "personal", market: d.market || null });
    setShowCreate(true);
  };

  const meta = KIND_META[kind];
  const metaIcon = meta.icon;

  return (
    <div className="bg-[var(--smn-bg)] dark:bg-slate-950" data-testid="community-hub-page">
      {!embedded && (<>
      <section className="smn-hero text-white -mt-16 pt-24 sm:pt-28 pb-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionEyebrow tone="white" className="!text-[#F2A03B] inline-flex items-center gap-2">
            <Icon name={metaIcon} tone="current" className="h-3.5 w-3.5" /> Community Hub
          </SectionEyebrow>
          <h1 className="font-display font-extrabold text-3xl sm:text-5xl mt-3 tracking-tight">Beyond one-liners.</h1>
          <p className="mt-3 text-slate-200 max-w-2xl">{meta.blurb}</p>
        </div>
      </section>
      <WaveDivider className="text-[#17324a] dark:text-slate-950" />
      </>)}
      <div className={`max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 ${embedded ? "pt-2 pb-8" : "py-12"}`}>
      {embedded && <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">{meta.blurb}</p>}
      <div className="mt-6 flex items-center justify-between flex-wrap gap-3">
        {!lockKind ? (
        <div className="inline-flex rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1" data-testid="hub-tabs">
          {["blog", "forum"].map((k) => (
            <button key={k} onClick={() => setKind(k)} data-testid={`hub-tab-${k}`}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${kind === k ? "bg-[#1F3F5B] dark:bg-[#F2A03B] text-white" : "text-slate-600 dark:text-slate-300 hover:text-[#1F3F5B] dark:hover:text-white"}`}>
              {KIND_META[k].label}
            </button>
          ))}
        </div>
        ) : <div />}
        {user && (
          <button onClick={() => { if (!canParticipate(user)) { promptUpgrade(kind === "blog" ? "Writing blog posts is a Community Partner feature" : "Starting forum topics is a Community Partner feature"); return; } setDraft((d) => ({ ...d, identity: user.active_identity || "personal", market: user.primary_market || null })); setShowCreate(true); }} data-testid="hub-new-btn"
                  className="inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2 font-semibold">
            <Icon name="add" tone="current" className="h-4 w-4" /> {kind === "blog" ? "Submit a draft" : "Start a topic"}
          </button>
        )}
      </div>

      {user?.platform_role === "admin" && kind === "blog" && pending.length > 0 && (
        <section className="mt-8 rounded-2xl border border-orange-200 bg-orange-50 p-4" data-testid="pending-drafts">
          <div className="text-xs font-bold uppercase tracking-widest text-[#d98c30]">Pending drafts ({pending.length})</div>
          <div className="mt-2 space-y-2">
            {pending.map((d) => {
              const pOpen = expandedPending === d.id;
              return (
              <div key={d.id} className="rounded-xl bg-white p-3 flex items-start justify-between gap-3" data-testid={`pending-${d.id}`}>
                <div className="min-w-0">
                  <button type="button" onClick={() => setExpandedPending(pOpen ? null : d.id)} data-testid={`pending-toggle-${d.id}`} className="text-left">
                    <div className="font-semibold text-[#1F3F5B] flex items-center gap-1.5">
                      <Icon name={pOpen ? "chevron-down" : "chevron-right"} tone="current" className="h-4 w-4 shrink-0 text-slate-400" />
                      {d.title}
                    </div>
                  </button>
                  <div className="text-xs text-slate-500 mt-0.5">by {d.author_name || "Anonymous"} · {d.market || "All markets"} · {(d.created_at || "").slice(0, 10)}</div>
                  {pOpen && d.image_url && <img src={d.image_url} alt={d.title} className="mt-2 w-full max-h-72 object-cover rounded-xl" />}
                  <p className={`mt-1 text-sm text-slate-700 whitespace-pre-wrap break-words ${pOpen ? "" : "line-clamp-2"}`} data-testid={`pending-body-${d.id}`}>{d.body}</p>
                  {!pOpen && <button type="button" onClick={() => setExpandedPending(d.id)} className="mt-1 text-xs font-semibold text-[#55B3AD] hover:underline">Read full draft</button>}
                </div>
                <button onClick={() => approve(d.id)} data-testid={`approve-${d.id}`}
                        className="shrink-0 inline-flex items-center gap-1 bg-[#55B3AD] hover:bg-[#3f9691] text-white rounded-full px-3 py-1.5 text-xs font-semibold">
                  <Icon name="check" tone="current" className="h-3.5 w-3.5" /> Approve
                </button>
              </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="mt-8 rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden" data-testid="hub-list">
        <div className="hidden sm:grid grid-cols-[1fr_140px_160px_100px_auto] gap-3 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50 dark:bg-slate-900">
          <span>Subject</span><span>Market</span><span>Author</span><span>Date</span><span />
        </div>
        {items.length === 0 && <div className="p-6 text-slate-500 dark:text-slate-400">Nothing here yet. Be the first!</div>}
        {items.map((d) => {
          const expanded = expandedId === d.id;
          return (
          <div key={d.id} data-testid={`disc-wrap-${d.id}`}>
          <div role="button" tabIndex={0} onClick={() => setExpandedId(expanded ? null : d.id)} onKeyDown={(e) => { if (e.key === "Enter") setExpandedId(expanded ? null : d.id); }}
               className="grid grid-cols-1 sm:grid-cols-[1fr_140px_160px_100px_auto] gap-1 sm:gap-3 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer" data-testid={`disc-${d.id}`}>
            <div className="min-w-0 font-semibold smn-heading truncate flex items-center gap-2" data-testid={`disc-link-${d.id}`}>
              <Icon name={expanded ? "chevron-down" : "chevron-right"} tone="current" className="h-4 w-4 shrink-0 text-slate-400" />
              {kind === "blog" && d.image_url && <img src={d.image_url} alt="" className="h-9 w-12 rounded object-cover shrink-0" data-testid={`disc-cover-${d.id}`} />}
              <span className="truncate">{d.title}</span>
            </div>
            <div className="text-xs text-slate-500 truncate">{d.market || "All markets"}</div>
            <div className="text-xs text-slate-500 truncate flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <AuthorBlock {...authorFromDoc(d)} size="h-5 w-5" testId={`disc-author-${d.id}`}
                           nameClassName="text-xs text-slate-500 font-medium" />
            </div>
            <div className="text-xs text-slate-500">{(d.created_at || "").slice(0, 10)}{d.edited_at ? <span className="block text-[10px] text-slate-400" data-testid={`disc-edited-${d.id}`}>edited</span> : null}</div>
            <div className="hidden sm:flex items-center justify-end gap-3">
              <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" data-testid={`hub-comments-${d.id}`}>
                <Icon name="message-square" tone="current" className="h-3.5 w-3.5" /> {d.comment_count || 0}
              </span>
              <SaveButton targetType="discussion" targetId={d.id} saved={isSaved(d.id)} onToggle={toggleSaved} size="xs" />
              <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" data-testid={`hub-up-${d.id}`}>
                <Icon name="thumbs-up" tone="current" className="h-3.5 w-3.5" /> {reactions[`discussion:${d.id}`]?.up || 0}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" data-testid={`hub-down-${d.id}`}>
                <Icon name="thumbs-down" tone="current" className="h-3.5 w-3.5" /> {reactions[`discussion:${d.id}`]?.down || 0}
              </span>
              <span onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-2">
                <AuthorActions canEdit={d.can_edit} canDelete={d.can_delete} noun={d.kind === "blog" ? "blog post" : "topic"} testIdBase={`disc-${d.id}`}
                  onEdit={() => startEdit(d)} deleteUrl={`/discussions/${d.id}`}
                  onDeleted={() => setItems((cur) => cur.filter((x) => x.id !== d.id))} />
              </span>
            </div>
          </div>
          {expanded && (
            <div className="px-4 pb-5 pt-1 bg-slate-50/60 dark:bg-slate-900/40" data-testid={`disc-expanded-${d.id}`} onClick={(e) => e.stopPropagation()}>
              {d.image_url && <img src={d.image_url} alt={d.title} className="mb-3 w-full max-h-80 object-cover rounded-xl" data-testid={`disc-photo-${d.id}`} />}
              <div className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed"><Linkify text={d.body} /></div>
              <div className="mt-3"><Reactions targetType="discussion" targetId={d.id} /></div>
              <PostComments post={{ id: d.id, comment_count: d.comment_count, allow_comments: true }} defaultOpen
                            onCountChange={(n) => setItems((cur) => cur.map((x) => x.id === d.id ? { ...x, comment_count: n } : x))} />
              <Link to={`/community-hub/${d.id}`} className="inline-block mt-2 text-xs font-semibold text-[#55B3AD] hover:underline" data-testid={`disc-open-${d.id}`}>Open full page →</Link>
            </div>
          )}
          </div>
          );
        })}
      </div>

      <Modal open={showCreate} onClose={() => { setShowCreate(false); setEditingId(null); }}
             eyebrow={<><Icon name={metaIcon} tone="current" className="h-3.5 w-3.5" /> {meta.label}</>}
             title={editingId ? (kind === "blog" ? "Edit blog post" : "Edit topic") : (kind === "blog" ? "Submit a blog draft" : "Start a new topic")}
             testId="hub-create-modal"
             footer={<>
               <button onClick={() => { setShowCreate(false); setEditingId(null); }} className="text-slate-600 px-4 py-2 rounded-full hover:bg-slate-100">Cancel</button>
               <button onClick={create} disabled={busy} data-testid="hub-submit-btn"
                       className="bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2 font-semibold disabled:opacity-50">
                 {editingId ? "Save changes" : (kind === "blog" ? "Submit for review" : "Post topic")}
               </button>
             </>}>
        <div className="p-5 space-y-4">
          {!editingId && <PostingAs value={draft.identity} onChange={(id) => setDraft({ ...draft, identity: id })} testId="hub-posting-as" />}
          {kind === "blog" && !editingId && (
            <div className="rounded-xl bg-orange-50 border border-orange-100 p-3 text-xs text-slate-700 flex items-start gap-2">
              <Icon name="verified" tone="current" className="h-4 w-4 text-[#d98c30] shrink-0" />
              <span>Blog posts require admin approval before going live. You&apos;ll be notified when it&apos;s published.</span>
            </div>
          )}
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} data-testid="hub-title"
                 placeholder="Title" className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
          <div data-testid="hub-cover">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{kind === "blog" ? "Cover photo (optional)" : "Photo (optional)"}</div>
            <FlyerUploader value={draft.image_url} onChange={(url) => setDraft({ ...draft, image_url: url })} label={kind === "blog" ? "Upload cover photo (optional)" : "Upload a photo (optional)"} />
          </div>
          <MentionTextarea rows={8} value={draft.body} onChange={(b) => setDraft({ ...draft, body: b })} testId="hub-body"
                    placeholder={kind === "blog" ? "Write your post… (type @ to mention someone)" : "What's the topic? (type @ to mention someone)"}
                    wrapperClassName="relative w-full"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
          {!editingId && (
          <div data-testid="hub-market-field">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Market (optional)</div>
            <MultiSelectPicker
              label="Market"
              title="Select market"
              testId="hub-market-picker"
              single
              searchable={false}
              placeholder="All markets"
              options={[{ value: ALL_MKT, label: "All markets" }, ...markets.map((m) => ({ value: m, label: m }))]}
              value={draft.market ? [draft.market] : [ALL_MKT]}
              onChange={(next) => { const v = next[0]; setDraft((d) => ({ ...d, market: (!v || v === ALL_MKT) ? null : v })); }}
              valueLabel={draft.market || "All markets"}
              ariaLabel={`Market: ${draft.market || "All markets"}`}
            />
          </div>
          )}
          <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} data-testid="hub-tags"
                 placeholder="Tags, comma separated (optional)" className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
        </div>
      </Modal>
      </div>
    </div>
  );
}
