import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const REPLY_TEMPLATES = [
  { key: "thanks", label: "Thanks & we'll follow up", body: "Thanks so much for the note - really appreciate you reaching out. We'll dig in on our side and follow up within a business day." },
  { key: "feature", label: "Feature request logged", body: "Great suggestion - I've logged this on our roadmap. If we ship it, we'll drop you a line so you're the first to know." },
  { key: "partner", label: "Partner listing next steps", body: "Happy to add you to the Community Partners directory! Reply with your logo (PNG or SVG), a two-sentence blurb, and a link, and we'll get it live within the week." },
];

const STATUS_BADGE = {
  new: "bg-[#F2A03B]/15 text-[#d98c30]",
  handled: "bg-emerald-100 text-emerald-700",
  archived: "bg-slate-200 text-slate-600",
};

function ReplyComposer({ msgId, onSent }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [tplKey, setTplKey] = useState("");

  const pickTemplate = (key) => {
    const tpl = REPLY_TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    setText(tpl.body);
    setTplKey(key);
  };

  const send = async () => {
    if (text.trim().length < 5) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/contact/${msgId}/reply`, { body: text.trim() });
      if (data?.delivered) toast.success("Reply sent & delivered.");
      else if (data?.persisted) toast.warning("Saved - email delivery failed. We'll retry.");
      else toast.error("Failed to send reply.");
      setText("");
      setTplKey("");
      onSent?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to send"); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-4 border-t border-slate-100 pt-3" data-testid={`reply-composer-${msgId}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Common replies</span>
        <Select value={tplKey} onValueChange={pickTemplate}>
          <SelectTrigger data-testid={`reply-template-${msgId}`} className="h-8 w-[220px] text-xs rounded-full px-3 bg-white">
            <SelectValue placeholder="Pick a template…" />
          </SelectTrigger>
          <SelectContent>
            {REPLY_TEMPLATES.map((t) => (
              <SelectItem key={t.key} value={t.key} data-testid={`reply-template-item-${t.key}`}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <textarea value={text} onChange={(e) => { setText(e.target.value); if (tplKey) setTplKey(""); }}
                data-testid={`reply-body-${msgId}`} rows={4}
                placeholder="Write your reply… (logged onto this submission)"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm" />
      <div className="mt-2 flex justify-end">
        <button onClick={send} disabled={busy || text.trim().length < 5}
                data-testid={`reply-send-${msgId}`}
                className="inline-flex items-center gap-1 bg-[#1F3F5B] hover:bg-[#152a3d] disabled:opacity-40 text-white rounded-full px-4 py-2 text-sm font-semibold">
          <Icon name="send" tone="current" className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send reply"}
        </button>
      </div>
    </div>
  );
}

const isPartnerInquiry = (m) => (m?.subject || "").toLowerCase().includes("community partner");

function PartnerActivate({ msg, onDone }) {
  const [busy, setBusy] = useState(false);
  const acct = msg.account;
  const tier = acct?.subscription_tier;
  const active = tier === "community_partner" || tier === "founding_partner";

  const setPartner = async (activate) => {
    setBusy(true);
    try {
      await api.post("/admin/community-partner/activate", { email: msg.email, months: 12, activate });
      toast.success(activate ? "Community Partner activated (1 year)." : "Community Partner tier removed.");
      onDone?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't update tier"); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-4 rounded-xl border border-[#F2A03B]/40 bg-[#F2A03B]/[0.06] p-3" data-testid={`partner-activate-${msg.id}`}>
      <div className="flex items-center gap-2 text-[#d98c30] text-sm font-bold">
        <Icon name="award" tone="current" className="h-4 w-4" /> Community Partner
      </div>
      {!acct ? (
        <p className="mt-1 text-sm text-slate-600" data-testid={`partner-no-account-${msg.id}`}>
          No account exists for <b>{msg.email}</b> yet. Ask them to sign up (Organization), then activate here.
        </p>
      ) : (
        <div className="mt-2 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-slate-600">
            Account: <b>{acct.name || acct.email}</b>
            {acct.account_type ? <span className="text-slate-400"> · {acct.account_type}</span> : null}
            <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {active ? <><Icon name="success" tone="current" className="h-3 w-3" /> {tier}</> : (tier || "free")}
            </span>
          </div>
          {active ? (
            <button onClick={() => setPartner(false)} disabled={busy} data-testid={`partner-deactivate-btn-${msg.id}`}
              className="text-xs font-semibold text-slate-500 hover:text-red-600 disabled:opacity-40">Remove tier</button>
          ) : (
            <button onClick={() => setPartner(true)} disabled={busy} data-testid={`partner-activate-btn-${msg.id}`}
              className="inline-flex items-center gap-1 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
              <Icon name="award" tone="current" className="h-3.5 w-3.5" /> {busy ? "Activating…" : "Activate Community Partner"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_TABS = [
  { key: "new", label: "New" },
  { key: "handled", label: "Handled" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

export default function AdminContact() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const deepLinkMsg = params.get("msg");
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("new");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null); // {type:'single',id} | {type:'bulk',ids}
  const [busy, setBusy] = useState(false);
  const highlightRef = useRef(null);

  const reload = () => api.get("/admin/contact")
    .then(({ data }) => setData(data))
    .catch((e) => setErr(e?.response?.data?.detail || "Failed to load"));

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    if (user.platform_role !== "admin") { setErr("Admin access required."); return; }
    reload();
  }, [user, loading, nav]);

  // Deep link from the contact email (/admin/contact?msg=<id>): show All so the
  // message is visible regardless of its status, then scroll + highlight it.
  useEffect(() => {
    if (deepLinkMsg && data) {
      setFilter("all");
      const t = setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
      return () => clearTimeout(t);
    }
  }, [deepLinkMsg, data]);

  const messages = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.messages.filter((m) => {
      const st = m.queue_status || "new";
      if (filter !== "all" && st !== filter) return false;
      if (q) {
        const hay = `${m.name || ""} ${m.email || ""} ${m.subject || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, filter, search]);

  const counts = useMemo(() => {
    const c = { new: 0, handled: 0, archived: 0 };
    (data?.messages || []).forEach((m) => { c[m.queue_status || "new"] = (c[m.queue_status || "new"] || 0) + 1; });
    return c;
  }, [data]);

  const toggleSel = (id) => setSelected((cur) => {
    const n = new Set(cur);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const clearSel = () => setSelected(new Set());

  const setStatus = async (id, status) => {
    setBusy(true);
    try {
      await api.post(`/admin/contact/${id}/status`, { status });
      toast.success(status === "handled" ? "Marked handled." : status === "archived" ? "Archived." : "Restored to New.");
      await reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't update"); }
    finally { setBusy(false); }
  };

  const doDelete = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.type === "single") {
        await api.delete(`/admin/contact/${confirm.id}`);
        toast.success("Message deleted.");
      } else {
        const { data } = await api.post("/admin/contact/bulk", { ids: confirm.ids, action: "delete" });
        toast.success(`Deleted ${data.deleted} ${data.deleted === 1 ? "message" : "messages"}.`);
        clearSel();
      }
      setConfirm(null);
      await reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't delete"); }
    finally { setBusy(false); }
  };

  const bulkArchive = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/contact/bulk", { ids: [...selected], action: "archive" });
      toast.success(`Archived ${data.archived} ${data.archived === 1 ? "message" : "messages"}.`);
      clearSel();
      await reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't archive"); }
    finally { setBusy(false); }
  };

  if (err) return <div className="max-w-3xl mx-auto p-10 text-red-500" data-testid="admin-contact-error">{err}</div>;
  if (!data) return <div className="max-w-3xl mx-auto p-10 text-slate-500">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="admin-contact-page">
      <div className="flex items-center gap-3 mb-6">
        <Icon name="inbox" tone="current" className="h-6 w-6 text-[#55B3AD]" />
        <div>
          <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl tracking-tight">Contact queue</h1>
          <div className="text-xs text-slate-500 mt-1">{counts.new} new · {counts.handled} handled · {counts.archived} archived · {data.total} lifetime</div>
        </div>
      </div>

      {/* Status tabs + search */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {STATUS_TABS.map((t) => (
          <button key={t.key} onClick={() => { setFilter(t.key); clearSel(); }} data-testid={`contact-filter-${t.key}`}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold border ${filter === t.key ? "bg-[#1F3F5B] text-white border-[#1F3F5B]" : "bg-white text-slate-600 border-slate-200"}`}>
            {t.label}{t.key !== "all" && counts[t.key] ? ` (${counts[t.key]})` : ""}
          </button>
        ))}
        <div className="relative ml-auto">
          <Icon name="search" tone="current" className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} data-testid="contact-search"
            placeholder="Search sender or subject"
            className="w-56 rounded-full border border-slate-200 pl-9 pr-3 py-1.5 text-sm focus:border-[#55B3AD] outline-none" />
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 rounded-xl bg-[#1F3F5B] text-white px-4 py-2.5" data-testid="contact-bulk-bar">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <button onClick={bulkArchive} disabled={busy} data-testid="contact-bulk-archive"
            className="inline-flex items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 px-3 py-1 text-xs font-semibold disabled:opacity-40">
            <Icon name="history" tone="current" className="h-3.5 w-3.5" /> Archive
          </button>
          <button onClick={() => setConfirm({ type: "bulk", ids: [...selected] })} disabled={busy} data-testid="contact-bulk-delete"
            className="inline-flex items-center gap-1 rounded-full bg-red-500 hover:bg-red-600 px-3 py-1 text-xs font-semibold disabled:opacity-40">
            <Icon name="delete" tone="current" className="h-3.5 w-3.5" /> Delete
          </button>
          <button onClick={clearSel} className="ml-auto text-xs text-white/70 hover:text-white underline">Clear</button>
        </div>
      )}

      {messages.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center text-slate-500" data-testid="contact-empty">
          Nothing here yet.
        </div>
      )}

      <div className="space-y-3">
        {messages.map((m) => {
          const st = m.queue_status || "new";
          const isHit = deepLinkMsg === m.id;
          return (
            <article key={m.id} ref={isHit ? highlightRef : null}
              data-testid={`contact-msg-${m.id}`}
              className={`bg-white rounded-2xl border p-5 transition-shadow ${isHit ? "border-[#F2A03B] ring-2 ring-[#F2A03B]/40 shadow-md" : "border-slate-100"}`}>
              <div className="flex items-start gap-3">
                <Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggleSel(m.id)}
                  data-testid={`contact-select-${m.id}`} className="mt-1" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-[#1F3F5B] flex items-center gap-2 flex-wrap">
                        {m.name}
                        <span data-testid={`contact-status-${m.id}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE[st]}`}>
                          {st}
                        </span>
                        <span data-testid={`contact-source-${m.id}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${m.source === "profile_support" ? "bg-[#55B3AD]/15 text-[#2A7871]" : "bg-slate-100 text-slate-500"}`}>
                          {m.source === "profile_support" ? "Profile" : "Public site"}
                        </span>
                        {m.subject && (
                          <span data-testid={`contact-subject-${m.id}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${isPartnerInquiry(m) ? "bg-[#F2A03B]/15 text-[#d98c30]" : "bg-slate-100 text-slate-500"}`}>
                            {isPartnerInquiry(m) && <Icon name="award" tone="current" className="h-3 w-3" />}{m.subject}
                          </span>
                        )}
                      </div>
                      <a href={`mailto:${m.email}?subject=Re%3A%20Your%20note%20to%20Sail%20More%20Now`} className="text-xs text-slate-500 hover:text-[#F2A03B] inline-flex items-center gap-1">
                        <Icon name="mail" tone="current" className="h-3 w-3" /> {m.email}
                      </a>
                    </div>
                    <div className="text-xs text-slate-400 inline-flex items-center gap-1">
                      <Icon name="clock" tone="current" className="h-3 w-3" /> {new Date(m.created_at).toLocaleString()}
                    </div>
                  </div>

                  <p className="mt-3 text-sm text-slate-700 whitespace-pre-wrap break-words">{m.message}</p>
                  {isPartnerInquiry(m) && <PartnerActivate msg={m} onDone={reload} />}

                  {Array.isArray(m.replies) && m.replies.length > 0 && (
                    <div className="mt-4 border-t border-slate-100 pt-3 space-y-2" data-testid={`contact-replies-${m.id}`}>
                      {m.replies.map((r) => (
                        <div key={r.id} className="bg-slate-50 rounded-xl p-3 text-sm">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1 flex items-center gap-2 flex-wrap">
                            <span>Replied by {r.by_name || r.by} · {new Date(r.at).toLocaleString()}</span>
                            {r.delivered === false && (
                              <span data-testid={`reply-retry-badge-${r.id}`}
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 normal-case tracking-normal">
                                <Icon name="warning" tone="current" className="h-3 w-3" /> Saved · email retry pending
                              </span>
                            )}
                          </div>
                          <div className="whitespace-pre-wrap text-slate-700">{r.body}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <ReplyComposer msgId={m.id} onSent={reload} />

                  {/* Per-message status actions */}
                  <div className="mt-3 flex items-center gap-2 flex-wrap border-t border-slate-100 pt-3">
                    {st !== "handled" && (
                      <button onClick={() => setStatus(m.id, "handled")} disabled={busy} data-testid={`contact-handle-${m.id}`}
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 text-emerald-700 hover:bg-emerald-50 px-3 py-1 text-xs font-semibold disabled:opacity-40">
                        <Icon name="success" tone="current" className="h-3.5 w-3.5" /> Mark handled
                      </button>
                    )}
                    {st !== "archived" && (
                      <button onClick={() => setStatus(m.id, "archived")} disabled={busy} data-testid={`contact-archive-${m.id}`}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1 text-xs font-semibold disabled:opacity-40">
                        <Icon name="history" tone="current" className="h-3.5 w-3.5" /> Archive
                      </button>
                    )}
                    {st !== "new" && (
                      <button onClick={() => setStatus(m.id, "new")} disabled={busy} data-testid={`contact-restore-${m.id}`}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1 text-xs font-semibold disabled:opacity-40">
                        <Icon name="refresh" tone="current" className="h-3.5 w-3.5" /> Restore
                      </button>
                    )}
                    <button onClick={() => setConfirm({ type: "single", id: m.id })} disabled={busy} data-testid={`contact-delete-${m.id}`}
                      className="inline-flex items-center gap-1 rounded-full border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1 text-xs font-semibold disabled:opacity-40 ml-auto">
                      <Icon name="delete" tone="current" className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent data-testid="contact-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirm?.type === "bulk" ? `${confirm.ids.length} messages` : "this message"}? This can't be undone.</AlertDialogTitle>
            <AlertDialogDescription>
              The message text and sender details are removed. Only a small record (date and who deleted it) is kept in the admin audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="contact-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} disabled={busy} data-testid="contact-delete-confirm-btn"
              className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
