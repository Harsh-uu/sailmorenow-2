import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { canInteract } from "@/lib/plan";
import { useAuth } from "@/context/AuthContext";
import { useAppSocket } from "@/context/WebSocketContext";
import { toast } from "sonner";
import MentionTextarea from "@/components/MentionTextarea";
import PostingAs from "@/components/PostingAs";
import Modal from "@/components/Modal";

function threadIdOf(a, b, identity = "personal") {
  const base = [a, b].sort().join("-");
  return identity === "business" ? `${base}~b` : base;
}

function Avatar({ url, name, className = "h-9 w-9" }) {
  const isUrl = typeof url === "string" && /^https?:\/\//.test(url);
  return (
    <div className={`rounded-full bg-[#55B3AD]/15 flex items-center justify-center overflow-hidden shrink-0 ${className}`}>
      {isUrl
        ? <img src={url} alt="" className="h-full w-full object-cover" />
        : <span className="font-bold text-[#2A7871]">{(name || "⛵").trim().charAt(0).toUpperCase()}</span>}
    </div>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const { subscribe } = useAppSocket();
  const [params] = useSearchParams();
  const initialTo = params.get("to");
  const initialThread = params.get("thread");
  const offerParam = params.get("offer");
  const [threads, setThreads] = useState([]);
  const [active, setActive] = useState(null); // { thread_id, name, is_group, user_id? }
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [threadsError, setThreadsError] = useState(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [menuMsgId, setMenuMsgId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [unlockBanner, setUnlockBanner] = useState(null);
  const [threadMenuId, setThreadMenuId] = useState(null);
  const [confirmThread, setConfirmThread] = useState(null); // thread row to delete
  const [confirmMsg, setConfirmMsg] = useState(null);        // own message to delete
  const [headerMenu, setHeaderMenu] = useState(false);
  const scrollRef = useRef(null);

  const loadThreads = () => api.get("/messages/threads")
    .then(({ data }) => { setThreads(data); setThreadsError(null); })
    .catch(() => setThreadsError("Couldn't load conversations. Please try again."));

  const openThread = async (t) => {
    const next = t.is_group
      ? { thread_id: t.thread_id, name: t.title || (t.members || []).map((m) => (m.name || "").split(" ")[0]).filter(Boolean).slice(0, 3).join(", ") || "Group chat", is_group: true, members: t.members }
      : { thread_id: t.thread_id || threadIdOf(user.user_id, t.other_user?.user_id), name: t.other_user?.name || "Sailor", is_group: false, user_id: t.other_user?.user_id,
          to_identity: t.peer_identity || "personal", my_identity: t.my_identity || "personal",
          channel: t.channel || "personal", business_name: t.business_name, viewer_is_boat_pro: !!t.viewer_is_boat_pro };
    setActive(next);
    const { data } = await api.get(`/messages/${next.thread_id}`);
    setMessages(data);
    if (next.is_group) {
      api.get(`/messages/${next.thread_id}/info`).then(({ data: info }) => {
        setActive((a) => (a && a.thread_id === next.thread_id ? { ...a, members: info.members || a.members } : a));
      }).catch(() => {});
    }
    try { await api.post(`/messages/${next.thread_id}/read`); loadThreads(); } catch { /* noop */ }
  };

  const deleteMessage = async (m, scope) => {
    setMenuMsgId(null);
    try {
      await api.delete(`/messages/item/${m.id}`, { params: { scope } });
      if (scope === "everyone") setMessages((ms) => ms.map((x) => x.id === m.id ? { ...x, deleted_for_all: true, body: "" } : x));
      else setMessages((ms) => ms.filter((x) => x.id !== m.id));
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't delete message"); }
  };

  const deleteThread = async (t) => {
    setThreadMenuId(null);
    setConfirmThread(null);
    const tid = t.thread_id || threadIdOf(user.user_id, t.other_user?.user_id);
    try {
      await api.delete(`/messages/thread/${tid}`);
      setThreads((ts) => ts.filter((x) => (x.thread_id || threadIdOf(user.user_id, x.other_user?.user_id)) !== tid));
      if (active?.thread_id === tid) { setActive(null); setMessages([]); }
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't delete conversation"); }
  };

  const blockUser = async (uid, name) => {    if (!uid || !window.confirm(`Block ${name || "this member"}? They won't be able to follow or re-add you.`)) return;
    try { await api.post(`/follows/block/${uid}`); toast.success(`Blocked ${name || "member"}`); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't block"); }
  };

  const startEdit = (m) => { setMenuMsgId(null); setEditingId(m.id); setEditDraft(m.body || ""); };
  const saveEdit = async (m) => {
    const text = editDraft.trim();
    if (!text) return;
    try {
      const { data } = await api.patch(`/messages/item/${m.id}`, { body: text });
      setMessages((ms) => ms.map((x) => x.id === m.id ? { ...x, body: data.body, edited_at: data.edited_at } : x));
      setEditingId(null); setEditDraft("");
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't edit message"); }
  };

  // Open a fresh 1:1 conversation with a specific user (from /u/:handle ?to=,
  // or a business listing ?to=&as=business). `asIdentity` is the RECIPIENT's
  // identity: "business" lands in their business thread, else personal.
  const openDirect = async (otherId, name, asIdentity = "personal") => {
    const tid = threadIdOf(user.user_id, otherId, asIdentity);
    const next = { thread_id: tid, name, is_group: false, user_id: otherId,
                   to_identity: asIdentity, channel: asIdentity === "business" ? "business" : "personal",
                   business_name: asIdentity === "business" ? name : null,
                   viewer_is_boat_pro: user?.account_type === "boat_pro" };
    setActive(next);
    const { data } = await api.get(`/messages/${tid}`);
    setMessages(data);
    try { await api.post(`/messages/${tid}/read`); loadThreads(); } catch { /* noop */ }
  };

  useEffect(() => {
    if (!user) return;
    const off = subscribe("message", (data) => {
      if (active && data.message.thread_id === active.thread_id) {
        setMessages((m) => [...m, data.message]);
        if (!active.is_group && data.message.to_id === user.user_id) {
          api.post(`/messages/${active.thread_id}/read`).catch(() => {});
        }
        if (active.is_group) api.post(`/messages/${active.thread_id}/read`).catch(() => {});
      }
      loadThreads();
    });
    const offRead = subscribe("message.read", (data) => {
      if (!active || data.thread_id !== active.thread_id) return;
      setMessages((ms) => ms.map((m) => (m.to_id === data.reader_id && !m.read_at ? { ...m, read_at: data.read_at } : m)));
    });
    const offDel = subscribe("message.deleted", (data) => {
      if (!active || data.thread_id !== active.thread_id) return;
      setMessages((ms) => ms.map((m) => (m.id === data.message_id ? { ...m, deleted_for_all: true, body: "" } : m)));
    });
    const offEdit = subscribe("message.edited", (data) => {
      if (!active || data.thread_id !== active.thread_id) return;
      setMessages((ms) => ms.map((m) => (m.id === data.message_id ? { ...m, body: data.body, edited_at: data.edited_at } : m)));
    });
    return () => { off?.(); offRead?.(); offDel?.(); offEdit?.(); };
  }, [user, active, subscribe]);

  useEffect(() => { if (user) loadThreads(); }, [user]);
  useEffect(() => {
    if (!canInteract(user)) return;
    api.get("/messages/unlock-banner").then(({ data }) => { if (data?.show) setUnlockBanner(data); }).catch(() => {});
  }, [user]);
  const dismissUnlock = () => { setUnlockBanner(null); api.post("/messages/unlock-banner/ack").catch(() => {}); };
  useEffect(() => { if (initialTo && user) {
    const asIdentity = params.get("as") === "business" ? "business" : "personal";
    const prefill = offerParam ? `Hi! I'd like to offer $${Number(offerParam).toLocaleString()} for your listing. Is it still available?` : "";
    if (prefill) setText(prefill);
    const wantTid = threadIdOf(user.user_id, initialTo, asIdentity);
    api.get(`/messages/threads`).then(({ data }) => {
      const t = (data || []).find((x) => !x.is_group && x.thread_id === wantTid);
      if (t) return openThread(t);
      if (asIdentity === "business") {
        api.get(`/boat-pros/${initialTo}`).then(({ data: d }) => openDirect(initialTo, d?.pro?.company_name || "Business", "business"))
          .catch(() => openDirect(initialTo, "Business", "business"));
        return;
      }
      const tp = (data || []).find((x) => !x.is_group && x.other_user?.user_id === initialTo);
      if (tp?.other_user?.name) return openDirect(initialTo, tp.other_user.name);
      api.get(`/messages/peer/${initialTo}`)
        .then(({ data: peer }) => openDirect(initialTo, peer?.name || "Sail More Now member"))
        .catch(() => openDirect(initialTo, "Sail More Now member"));
    }).catch(() => openDirect(initialTo, "Sail More Now member", asIdentity));
  }}, [initialTo, user]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialThread && user) {
    api.get(`/messages/threads`).then(({ data }) => {
      const t = (data || []).find((x) => x.thread_id === initialThread);
      if (t) openThread(t);
    }).catch(() => {});
  }}, [initialThread, user]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scrollRef.current?.scrollTo(0, 1e9); }, [messages]);

  useEffect(() => { setMembersOpen(false); setHeaderMenu(false); }, [active?.thread_id]);

  const send = async () => {
    if (!text.trim() || !active) return;
    try {
      const path = active.is_group ? `/messages/group/${active.thread_id}` : `/messages/${active.user_id}`;
      const payload = active.is_group
        ? { body: text }
        : { body: text, thread_id: active.thread_id };
      const { data } = await api.post(path, payload);
      setMessages((m) => [...m, data]);
      setText("");
      // Trust the thread id the server returns for a 1:1 (keeps the "~b" business
      // channel) so follow-up reads/replies target the same thread, never a recomputed one.
      if (!active.is_group && data.thread_id && data.thread_id !== active.thread_id) {
        setActive((a) => (a ? { ...a, thread_id: data.thread_id } : a));
      }
      loadThreads();
      if (!active.is_group && data.recipient_locked) {
        toast.info(`${data.recipient_name || "This member"} is on a free plan and can't receive messages yet. We've sent them a notification to upgrade.`);
      }
      if (active.is_group && data.locked_members?.length) {
        toast.info(`On a free plan — won't receive this until they upgrade: ${data.locked_members.join(", ")}.`);
      }
    } catch (e) { if (e?.response?.status !== 402) toast.error("Failed to send"); }
  };

  if (!user) return <div className="max-w-3xl mx-auto p-10 text-slate-500">Please sign in to use messaging.</div>;

  if (!canInteract(user)) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center" data-testid="messages-upgrade-wall">
        <div className="mx-auto h-14 w-14 rounded-full bg-[#F2A03B]/15 flex items-center justify-center mb-4">
          <Icon name="message-square" tone="current" className="h-7 w-7 text-[#F2A03B]" />
        </div>
        <h1 className="font-display font-extrabold text-[#1F3F5B] text-2xl">Messaging is a Premium feature</h1>
        <p className="text-slate-500 mt-2">Upgrade your membership to send direct messages, start group chats, and connect with Boat Pros and the crew.</p>
        <a href="/pricing" data-testid="messages-upgrade-btn" className="mt-6 inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 font-semibold">See membership plans</a>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="messages-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl">Messages</h1>
        <button onClick={() => setGroupOpen(true)} data-testid="new-message-btn"
                className="inline-flex items-center gap-1.5 bg-[#1F3F5B] hover:bg-[#152a3d] text-white rounded-full px-4 py-2 text-sm font-semibold">
          <Icon name="add" tone="current" className="h-4 w-4" /> New message
        </button>
      </div>
      {unlockBanner && (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#F2A03B]/10 border border-[#F2A03B]/30 px-4 py-2.5" data-testid="inbox-unlock-banner">
          <Icon name="inbox" tone="current" className="h-5 w-5 text-[#d98c30] shrink-0" />
          <div className="flex-1 min-w-0 text-sm text-[#1F3F5B] font-semibold">You have {unlockBanner.count} message{unlockBanner.count === 1 ? "" : "s"} waiting — now unlocked with your membership.</div>
          <button onClick={dismissUnlock} data-testid="inbox-unlock-dismiss" aria-label="Dismiss" className="shrink-0 text-slate-400 hover:text-slate-600"><Icon name="close" tone="current" className="h-4 w-4" /></button>
        </div>
      )}
      <div className="mt-6 grid md:grid-cols-3 gap-6 h-[70vh]">
        <aside className="bg-white rounded-2xl border border-slate-100 overflow-hidden" data-testid="threads-list">
          <div className="p-4 border-b border-slate-100 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Conversations</div>
          <div className="overflow-y-auto h-[calc(100%-49px)]">
            {threadsError && <div className="p-4 text-sm text-red-500" data-testid="threads-error">{threadsError}</div>}
            {!threadsError && threads.length === 0 && <div className="p-4 text-sm text-slate-500">No messages yet. Message a Boat Pro from their directory page, or start a group.</div>}
            {threads.map((t) => {
              const isActive = active?.thread_id === (t.thread_id || threadIdOf(user.user_id, t.other_user?.user_id));
              const title = t.is_group ? (t.title || (t.members || []).map((m) => (m.name || "").split(" ")[0]).filter(Boolean).slice(0, 3).join(", ") || "Group chat") : (t.other_user?.name || "Sailor");
              const testId = t.is_group ? `thread-group-${t.thread_id}` : `thread-${t.other_user?.user_id}`;
              const menuKey = t.is_group ? t.thread_id : (t.other_user?.user_id || t.thread_id);
              return (
                <div key={t.thread_id} className="relative border-b border-slate-50">
                  <button onClick={() => openThread(t)} className={`w-full text-left p-4 pr-10 flex items-center gap-3 ${isActive ? "bg-slate-50" : "hover:bg-slate-50"}`} data-testid={testId}>
                  {t.is_group
                    ? <div className="h-9 w-9 rounded-full bg-[#55B3AD]/15 flex items-center justify-center shrink-0"><Icon name="crew" tone="current" className="h-4 w-4 text-[#2A7871]" /></div>
                    : <Avatar url={t.other_user?.avatar || t.other_user?.picture} name={t.other_user?.name} />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#1F3F5B] truncate flex items-center gap-1.5">
                      {title}
                      {t.is_group && <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">· {(t.members || []).length}</span>}
                    </div>
                    {!t.is_group && t.viewer_is_boat_pro && t.channel === "business" && t.business_name && (
                      <span data-testid={`thread-label-${t.other_user?.user_id}`}
                            className="inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#1F3F5B]/10 text-[#1F3F5B]">
                        {t.business_name}
                      </span>
                    )}
                    <div className="text-xs text-slate-500 truncate">{t.last_message}</div>
                  </div>
                  {t.unread > 0 && (
                    <span data-testid={t.is_group ? `unread-group-${t.thread_id}` : `unread-${t.other_user?.user_id}`}
                          className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#F2A03B] text-white text-[11px] font-bold">
                      {t.unread > 99 ? "99+" : t.unread}
                    </span>
                  )}
                  </button>
                  <div className="absolute right-2 top-2">
                    <button onClick={(e) => { e.stopPropagation(); setThreadMenuId(threadMenuId === menuKey ? null : menuKey); }}
                            data-testid={`thread-menu-${menuKey}`} aria-label="Conversation options"
                            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                      <Icon name="more" tone="current" className="h-4 w-4" />
                    </button>
                    {threadMenuId === menuKey && (
                      <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[180px]" data-testid={`thread-menu-pop-${menuKey}`}>
                        <button onClick={() => { setThreadMenuId(null); setConfirmThread(t); }} data-testid={`delete-conversation-${menuKey}`}
                                className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">Delete conversation</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
        <section className="md:col-span-2 bg-white rounded-2xl border border-slate-100 flex flex-col">
          {active ? (
            <>
              <div className="p-4 border-b border-slate-100">
                <div className="font-semibold text-[#1F3F5B] flex items-center gap-2 flex-wrap">
                  {active.is_group && <Icon name="crew" tone="current" className="h-4 w-4 text-[#2A7871]" />}
                  <span>{active.name}</span>
                  {!active.is_group && active.viewer_is_boat_pro && (
                    <span data-testid="active-thread-label"
                          className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${active.channel === "business" ? "bg-[#1F3F5B]/10 text-[#1F3F5B]" : "bg-slate-100 text-slate-500"}`}>
                      {active.channel === "business" ? (active.business_name || "Business") : "Personal"}
                    </span>
                  )}
                  {active.is_group && active.members && (
                    <button onClick={() => setMembersOpen((o) => !o)} data-testid="group-members-toggle"
                            className="text-xs font-semibold text-slate-400 hover:text-[#2A7871] inline-flex items-center gap-1">
                      {active.members.length} people
                      <Icon name={membersOpen ? "chevron-up" : "chevron-down"} tone="current" className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {!active.is_group && active.user_id && messages.some((m) => m.from_id === active.user_id) && (
                    <button onClick={() => blockUser(active.user_id, active.name)} data-testid="block-chat-user-btn"
                            className="ml-auto text-xs font-semibold text-red-500 hover:text-red-600 inline-flex items-center gap-1 rounded-full border border-red-200 px-3 py-1">
                      <Icon name="close" tone="current" className="h-3.5 w-3.5" /> Block
                    </button>
                  )}
                  <div className={`relative ${!active.is_group && active.user_id && messages.some((m) => m.from_id === active.user_id) ? "" : "ml-auto"}`}>
                    <button onClick={() => setHeaderMenu((o) => !o)} data-testid="thread-header-menu"
                            aria-label="Conversation options"
                            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                      <Icon name="more" tone="current" className="h-4 w-4" />
                    </button>
                    {headerMenu && (
                      <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[180px]" data-testid="thread-header-menu-pop">
                        <button onClick={() => { setHeaderMenu(false); setConfirmThread({ thread_id: active.thread_id, is_group: active.is_group, other_user: { user_id: active.user_id, name: active.name } }); }}
                                data-testid="delete-conversation-header"
                                className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">Delete conversation</button>
                      </div>
                    )}
                  </div>
                </div>
                {active.is_group && membersOpen && active.members && (
                  <div className="mt-2 flex flex-wrap gap-1.5" data-testid="group-members-list">
                    {active.members.map((m) => (
                      <span key={m.user_id} data-testid={`group-member-${m.user_id}`}
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${m.is_free ? "bg-red-500 text-white" : "bg-[#55B3AD]/15 text-[#2A7871]"}`}>
                        {m.name || "Sailor"}
                        {m.is_free && <span className="text-[9px] uppercase tracking-wide opacity-90">free</span>}
                        {m.user_id !== user.user_id && (
                          <button onClick={() => blockUser(m.user_id, m.name)} data-testid={`block-member-${m.user_id}`}
                                  title="Block member" className={`ml-0.5 ${m.is_free ? "text-white/80 hover:text-white" : "text-slate-400 hover:text-red-500"}`}>
                            <Icon name="close" tone="current" className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="messages-scroll">
                {messages.map((m, i) => {
                  const mine = m.from_id === user.user_id;
                  const menuUp = i > messages.length / 2;
                  if (m.deleted_for_all) {
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className="max-w-[75%] px-4 py-2 rounded-2xl text-sm italic bg-slate-100 text-slate-400" data-testid={`message-deleted-${m.id}`}>
                          This message was deleted
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={m.id} className={`group flex items-center gap-1 ${mine ? "justify-end" : "justify-start"}`}>
                      {mine && (
                        <div className="relative">
                          <button onClick={() => setMenuMsgId(menuMsgId === m.id ? null : m.id)} data-testid={`message-menu-${m.id}`}
                                  aria-label="Message options" className="text-slate-400 hover:text-slate-600 p-1">
                            <Icon name="more" tone="current" className="h-4 w-4" />
                          </button>
                          {menuMsgId === m.id && (
                            <div className={`absolute right-0 ${menuUp ? "bottom-full mb-1" : "top-full mt-1"} z-10 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[160px]`} data-testid={`message-menu-pop-${m.id}`}>
                              <button onClick={() => startEdit(m)} data-testid={`edit-msg-${m.id}`} className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Edit</button>
                              <button onClick={() => { setMenuMsgId(null); setConfirmMsg(m); }} data-testid={`delete-msg-${m.id}`} className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">Delete</button>
                            </div>
                          )}
                        </div>
                      )}
                      <div className={`max-w-[75%] px-4 py-2 rounded-2xl text-sm ${mine ? "bg-[#1F3F5B] text-white rounded-br-sm" : "bg-slate-100 text-slate-800 rounded-bl-sm"}`}>
                        {active.is_group && !mine && m.from_name && <div className="text-[11px] font-bold text-[#2A7871] mb-0.5">{m.from_name}</div>}
                        {editingId === m.id ? (
                          <div className="flex flex-col gap-1.5 min-w-[200px]">
                            <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={2} data-testid={`edit-input-${m.id}`}
                                      className="w-full rounded-lg text-slate-800 bg-white border border-slate-200 px-2 py-1 text-sm outline-none resize-none" />
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => { setEditingId(null); setEditDraft(""); }} className="text-xs text-white/70 hover:text-white">Cancel</button>
                              <button onClick={() => saveEdit(m)} data-testid={`edit-save-${m.id}`} className="text-xs font-semibold bg-white/20 hover:bg-white/30 rounded-full px-3 py-1">Save</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {m.body}
                            {m.edited_at && <span className="ml-1.5 text-[10px] opacity-60" data-testid={`edited-tag-${m.id}`}>(edited)</span>}
                          </>
                        )}
                        {mine && !active.is_group && (
                          <span className="ml-2 inline-flex items-center align-middle" data-testid={`receipt-${m.id}`} title={m.read_at ? `Read ${new Date(m.read_at).toLocaleString()}` : "Delivered"}>
                            {m.read_at
                              ? <Icon name="checkDouble" tone="current" className="h-3.5 w-3.5 text-sky-300" data-testid={`receipt-read-${m.id}`} />
                              : <Icon name="check" tone="current" className="h-3.5 w-3.5 text-slate-300" data-testid={`receipt-sent-${m.id}`} />}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="p-3 border-t border-slate-100 flex gap-2 items-end">
                <MentionTextarea value={text} onChange={setText} onSubmit={send} rows={1}
                                 placeholder="Type a message… (type @ to mention someone)"
                                 wrapperClassName="flex-1 relative"
                                 testId="message-input"
                                 className="w-full rounded-2xl border border-slate-200 px-4 py-2 focus:border-[#55B3AD] outline-none text-sm resize-none" />
                <button onClick={send} data-testid="message-send" className="bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-4 py-2 inline-flex items-center gap-1 font-semibold"><Icon name="send" tone="current" className="h-4 w-4" /></button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">Select a conversation, message a Boat Pro, or start a group.</div>
          )}
        </section>
      </div>

      {groupOpen && (
        <NewMessageModal
          onClose={() => setGroupOpen(false)}
          onSent={(res) => {
            setGroupOpen(false);
            loadThreads();
            if (res.oneToOne) openDirect(res.user_id, res.name, "personal");
            else openThread({ ...res.group, is_group: true, members: res.members });
          }}
        />
      )}

      <Modal open={!!confirmThread} onClose={() => setConfirmThread(null)} title="Delete conversation?" size="sm" testId="delete-conversation-modal"
             footer={<>
               <button onClick={() => setConfirmThread(null)} data-testid="delete-conversation-cancel"
                       className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
               <button onClick={() => deleteThread(confirmThread)} data-testid="delete-conversation-confirm"
                       className="rounded-full px-5 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white">Delete</button>
             </>}>
        <div className="p-5 text-sm text-slate-600">This removes it from your inbox. The other person keeps their copy.</div>
      </Modal>

      <Modal open={!!confirmMsg} onClose={() => setConfirmMsg(null)} title="Delete message?" size="sm" testId="delete-message-modal"
             footer={<>
               <button onClick={() => setConfirmMsg(null)} data-testid="delete-message-cancel"
                       className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
               <button onClick={() => { const m = confirmMsg; setConfirmMsg(null); deleteMessage(m, "everyone"); }} data-testid="delete-message-confirm"
                       className="rounded-full px-5 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white">Delete</button>
             </>}>
        <div className="p-5 text-sm text-slate-600">This removes the message for everyone in the conversation.</div>
      </Modal>
    </div>
  );
}

function NewMessageModal({ onClose, onSent }) {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState(user?.active_identity || "personal");
  const [bizLine, setBizLine] = useState(false);
  const timer = useRef(null);

  const business = !!user?.can_use_business && identity === "business";
  const isGroup = selected.length > 1;

  const search = (v) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 1) { setResults([]); return; }
    timer.current = setTimeout(() => {
      api.get(`/users/search?q=${encodeURIComponent(v.trim())}&limit=8`).then(({ data }) => setResults(data.users || [])).catch(() => setResults([]));
    }, 250);
  };
  const removeSel = (p) => setSelected((prev) => prev.filter((x) => x.user_id !== p.user_id));
  const pick = (p) => {
    setQ(""); setResults([]);
    setSelected((prev) => {
      if (prev.find((x) => x.user_id === p.user_id)) return prev.filter((x) => x.user_id !== p.user_id);
      if (business && prev.length >= 1) { setBizLine(true); return prev; }
      return [...prev, p];
    });
  };
  const changeIdentity = (next) => {
    setIdentity(next);
    if (next === "business") {
      setBizLine(false);
      setSelected((prev) => {
        if (prev.length > 1) { setBizLine(true); return prev.slice(0, 1); }
        return prev;
      });
    } else { setBizLine(false); }
  };

  const canSend = !busy && selected.length >= 1 && body.trim() && (!isGroup || title.trim());

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      if (selected.length === 1) {
        const p = selected[0];
        await api.post(`/messages/${p.user_id}`, { body: body.trim(), identity, to_identity: "personal" });
        toast.success("Message sent");
        onSent({ oneToOne: true, user_id: p.user_id, name: p.name || p.handle || "Sail More Now member" });
      } else {
        const { data } = await api.post("/messages/group", { participant_ids: selected.map((p) => p.user_id), title: title.trim(), body: body.trim(), identity: "personal" });
        const members = selected.map((p) => ({ user_id: p.user_id, name: p.name }));
        toast.success("Group chat started");
        if (data.locked_members?.length) toast.info(`On a free plan — won't receive this until they upgrade: ${data.locked_members.join(", ")}.`);
        onSent({ group: data, members });
      }
    } catch (e) {
      if (e?.response?.status !== 402) toast.error(e?.response?.data?.detail?.message || e?.response?.data?.detail || "Couldn't send the message");
    } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="New message" size="sm" testId="new-message-modal"
           footer={<button onClick={submit} disabled={!canSend} data-testid="compose-send-btn"
                           className="w-full inline-flex items-center justify-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] disabled:opacity-50 text-white rounded-full px-4 py-2.5 text-sm font-semibold">
                     <Icon name="send" tone="current" className="h-4 w-4" /> Send
                   </button>}>
      <div className="p-5 space-y-3">
        {user?.account_type === "boat_pro" && user?.can_use_business && (
          <PostingAs value={identity} onChange={changeIdentity} testId="compose-posting-as" />
        )}

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selected.map((p) => (
              <button key={p.user_id} onClick={() => removeSel(p)} data-testid={`compose-selected-${p.user_id}`}
                      className="inline-flex items-center gap-1 rounded-full bg-[#55B3AD]/15 text-[#2A7871] px-3 py-1 text-xs font-semibold">
                {(p.name || p.handle || "").split(" ")[0]} <Icon name="close" tone="current" className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}

        {bizLine && (
          <div data-testid="compose-business-line" className="text-xs font-semibold text-[#1F3F5B] bg-[#1F3F5B]/5 rounded-lg px-3 py-2">
            Business messages are one-to-one. Switch to You to start a group.
          </div>
        )}

        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
          <Icon name="search" tone="current" className="h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => search(e.target.value)} data-testid="compose-search-input" placeholder="Search people by name or @username"
                 className="flex-1 text-sm outline-none" />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {results.map((p) => {
            const on = !!selected.find((x) => x.user_id === p.user_id);
            return (
              <button key={p.user_id} onClick={() => pick(p)} data-testid={`compose-result-${p.user_id}`}
                      className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 text-left">
                <Avatar url={p.avatar || p.picture} name={p.name || p.handle} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-[#1F3F5B] truncate">{p.name || p.handle}</div>
                  {p.handle && <div className="text-xs text-slate-400">@{p.handle}</div>}
                </div>
                <Icon name={on ? "checkDouble" : "add"} tone="current" className={`h-4 w-4 ${on ? "text-[#55B3AD]" : "text-slate-400"}`} />
              </button>
            );
          })}
          {q.trim() && results.length === 0 && <div className="p-3 text-sm text-slate-400 text-center">No matches</div>}
        </div>

        {isGroup && !business && (
          <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="group-title-input" placeholder="Group name"
                 className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#55B3AD] outline-none" />
        )}

        <textarea value={body} onChange={(e) => setBody(e.target.value)} data-testid="compose-message-input" rows={2} placeholder="Write a message…"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#55B3AD] outline-none resize-none" />
      </div>
    </Modal>
  );
}
