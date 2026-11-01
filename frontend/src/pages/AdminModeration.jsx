import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import Modal from "@/components/Modal";

const USER_FIELDS = [
  { k: "name", label: "Name" },
  { k: "handle", label: "Username" },
  { k: "short_bio", label: "Bio", textarea: true },
  { k: "primary_market", label: "Primary market" },
  { k: "boat_name", label: "Boat name" },
  { k: "boat_make_model", label: "Boat make/model" },
  { k: "subscription_tier", label: "Tier (free/premium/boat_pro/partner)" },
];

function AuditTab() {
  const [logs, setLogs] = useState(null);
  useEffect(() => { api.get("/admin/audit-logs?limit=300").then(({ data }) => setLogs(data)).catch(() => setLogs([])); }, []);
  if (logs === null) return <p className="text-slate-400 mt-4">Loading…</p>;
  if (!logs.length) return <p className="text-slate-500 mt-4" data-testid="audit-empty">No admin actions logged yet.</p>;
  const color = { delete: "text-red-600 bg-red-50", edit: "text-indigo-700 bg-indigo-50", ban: "text-red-600 bg-red-50", unban: "text-emerald-700 bg-emerald-50" };
  return (
    <div className="mt-4 space-y-2" data-testid="audit-log-list">
      {logs.map((l) => (
        <div key={l.id} className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 p-3" data-testid={`audit-row-${l.id}`}>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${color[l.action] || "bg-slate-100 text-slate-600"}`}>{l.action}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[#1F3F5B] font-semibold">{l.entity_type} <span className="text-slate-400 font-normal">· {l.summary || l.entity_id}</span></div>
            <div className="text-xs text-slate-500">by {l.admin_name || l.admin_email} · {new Date(l.created_at).toLocaleString()}</div>
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-400 pt-2">Audit entries are kept for 30 days.</p>
    </div>
  );
}

function UsersTab() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const search = (term) => api.get(`/admin/users/search?q=${encodeURIComponent(term)}`).then(({ data }) => setUsers(data)).catch(() => {});
  useEffect(() => { search(""); }, []);
  useEffect(() => { const t = setTimeout(() => search(q), 350); return () => clearTimeout(t); }, [q]); // eslint-disable-line

  const openEdit = (u) => { const init = {}; USER_FIELDS.forEach((f) => { init[f.k] = u[f.k] ?? ""; }); setForm(init); setEditing(u); };
  const save = async () => {
    setBusy(true);
    try {
      const payload = {}; USER_FIELDS.forEach((f) => { if (form[f.k] !== "" && form[f.k] != null) payload[f.k] = form[f.k]; });
      await api.patch(`/admin/users/${editing.user_id}`, payload);
      toast.success("Profile updated"); setEditing(null); search(q);
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't save"); } finally { setBusy(false); }
  };
  const toggleBan = async (u) => {
    const action = u.banned ? "unban" : "ban";
    if (!window.confirm(`${u.banned ? "Reactivate" : "Deactivate"} ${u.name || u.email}?`)) return;
    try { await api.post(`/admin/users/${u.user_id}/${action}`); toast.success(u.banned ? "Account reactivated" : "Account deactivated"); search(q); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't update"); }
  };

  return (
    <div className="mt-4">
      <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="admin-user-search" placeholder="Search by name, email or username…"
             className="w-full max-w-md rounded-xl border border-slate-200 px-4 py-2 text-sm" />
      <div className="mt-4 space-y-2" data-testid="admin-users-list">
        {users.map((u) => (
          <div key={u.user_id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-100 p-3" data-testid={`admin-user-${u.user_id}`}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[#1F3F5B] truncate">{u.name || "—"} {u.banned && <span className="ml-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700">Deactivated</span>}</div>
              <div className="text-xs text-slate-500 truncate">{u.email} · @{u.handle || "—"} · {u.subscription_tier || "free"}</div>
            </div>
            <button onClick={() => openEdit(u)} data-testid={`admin-user-edit-${u.user_id}`} className="text-xs font-bold text-indigo-700 border border-indigo-200 rounded-full px-3 py-1.5 hover:bg-indigo-50">Edit</button>
            <button onClick={() => toggleBan(u)} data-testid={`admin-user-ban-${u.user_id}`} className={`text-xs font-bold rounded-full px-3 py-1.5 border ${u.banned ? "text-emerald-700 border-emerald-200 hover:bg-emerald-50" : "text-red-600 border-red-200 hover:bg-red-50"}`}>{u.banned ? "Reactivate" : "Deactivate"}</button>
          </div>
        ))}
        {!users.length && <p className="text-slate-500" data-testid="admin-users-empty">No members found.</p>}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit profile" eyebrow="Admin" testId="admin-user-edit-modal"
             footer={<div className="flex justify-end gap-2"><button onClick={() => setEditing(null)} className="px-4 py-2 rounded-full text-sm font-semibold text-slate-500">Cancel</button><button onClick={save} disabled={busy} data-testid="admin-user-save" className="px-5 py-2 rounded-full text-sm font-semibold bg-[#1F3F5B] text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button></div>}>
        <div className="space-y-3">
          {USER_FIELDS.map((f) => (
            <div key={f.k}>
              <label className="text-xs font-semibold text-slate-500">{f.label}</label>
              {f.textarea
                ? <textarea value={form[f.k] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [f.k]: e.target.value }))} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                : <input value={form[f.k] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [f.k]: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

const FAQ_CATEGORIES = ["Getting Started", "Plans and Pricing", "Verification and Safety", "Boat Pros and Reviews", "Community"];

function FaqTab() {
  const [faqs, setFaqs] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ category: FAQ_CATEGORIES[0], question: "", answer: "" });
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/admin/faqs").then(({ data }) => setFaqs(data)).catch(() => setFaqs([]));
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm({ category: FAQ_CATEGORIES[0], question: "", answer: "" }); setEditing({ id: null }); };
  const openEdit = (f) => { setForm({ category: f.category, question: f.question, answer: f.answer, active: f.active }); setEditing(f); };
  const save = async () => {
    if (!form.question.trim() || !form.answer.trim()) { toast.error("Question and answer are required"); return; }
    setBusy(true);
    try {
      if (editing.id) await api.patch(`/admin/faqs/${editing.id}`, form);
      else await api.post("/admin/faqs", form);
      toast.success("Saved"); setEditing(null); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't save"); } finally { setBusy(false); }
  };
  const del = async (f) => {
    if (!window.confirm("Delete this FAQ?")) return;
    try { await api.delete(`/admin/faqs/${f.id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't delete"); }
  };
  const toggleActive = async (f) => {
    try { await api.patch(`/admin/faqs/${f.id}`, { active: !f.active }); load(); }
    catch { toast.error("Couldn't update"); }
  };

  const [drag, setDrag] = useState(null); // { cat, idx }
  const persistOrder = async (cat) => {
    const ids = faqs.filter((f) => f.category === cat).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((f) => f.id);
    try { await api.post("/admin/faqs/reorder", { ordered_ids: ids }); }
    catch { toast.error("Couldn't save order"); load(); }
  };
  const moveWithin = (cat, from, to) => {
    if (from === to) return;
    setFaqs((prev) => {
      const inCat = prev.filter((f) => f.category === cat).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const others = prev.filter((f) => f.category !== cat);
      const [moved] = inCat.splice(from, 1);
      inCat.splice(to, 0, moved);
      const reordered = inCat.map((f, i) => ({ ...f, order: i }));
      return [...others, ...reordered];
    });
  };
  const grouped = (faqs || []).reduce((acc, f) => {
    (acc[f.category] = acc[f.category] || []).push(f);
    return acc;
  }, {});
  Object.values(grouped).forEach((arr) => arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
  const orderedCats = Object.keys(grouped).sort(
    (a, b) => (FAQ_CATEGORIES.indexOf(a) + 1 || 99) - (FAQ_CATEGORIES.indexOf(b) + 1 || 99),
  );

  if (faqs === null) return <p className="text-slate-400 mt-4">Loading…</p>;
  return (
    <div className="mt-4">
      <button onClick={openNew} data-testid="faq-new-btn" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-white bg-[#1F3F5B] rounded-full px-4 py-2">
        <Icon name="add" tone="current" className="h-4 w-4" /> New FAQ
      </button>
      <p className="text-xs text-slate-400 mb-3">Tip: drag the handle to reorder questions within a category.</p>
      <div className="space-y-6" data-testid="admin-faq-list">
        {orderedCats.map((cat) => (
          <div key={cat} data-testid={`admin-faq-group-${cat}`}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#55B3AD] mb-2">{cat}</div>
            <div className="space-y-2">
              {grouped[cat].map((f, idx) => (
                <div
                  key={f.id}
                  draggable
                  onDragStart={() => setDrag({ cat, idx })}
                  onDragOver={(e) => { e.preventDefault(); if (drag && drag.cat === cat && drag.idx !== idx) { moveWithin(cat, drag.idx, idx); setDrag({ cat, idx }); } }}
                  onDragEnd={() => { if (drag) persistOrder(cat); setDrag(null); }}
                  className={`bg-white rounded-xl border p-3 ${drag && drag.cat === cat && drag.idx === idx ? "border-[#55B3AD] opacity-70" : "border-slate-100"}`}
                  data-testid={`admin-faq-${f.id}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="cursor-grab text-slate-300 pt-0.5 select-none" data-testid={`faq-drag-${f.id}`} title="Drag to reorder"><Icon name="menu" tone="current" className="h-4 w-4" /></span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#1F3F5B]">{f.question} {!f.active && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Hidden</span>}</div>
                      <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{f.answer}</div>
                    </div>
                    <button onClick={() => toggleActive(f)} data-testid={`faq-toggle-${f.id}`} className="text-xs font-bold text-slate-500 border border-slate-200 rounded-full px-3 py-1.5 hover:bg-slate-50">{f.active ? "Hide" : "Show"}</button>
                    <button onClick={() => openEdit(f)} data-testid={`faq-edit-${f.id}`} className="text-xs font-bold text-indigo-700 border border-indigo-200 rounded-full px-3 py-1.5 hover:bg-indigo-50">Edit</button>
                    <button onClick={() => del(f)} data-testid={`faq-delete-${f.id}`} className="text-xs font-bold text-red-600 border border-red-200 rounded-full px-3 py-1.5 hover:bg-red-50">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!faqs.length && <p className="text-slate-500" data-testid="admin-faq-empty">No FAQs yet.</p>}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit FAQ" : "New FAQ"} eyebrow="Help center" testId="admin-faq-modal"
             footer={<div className="flex justify-end gap-2"><button onClick={() => setEditing(null)} className="px-4 py-2 rounded-full text-sm font-semibold text-slate-500">Cancel</button><button onClick={save} disabled={busy} data-testid="faq-save" className="px-5 py-2 rounded-full text-sm font-semibold bg-[#1F3F5B] text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button></div>}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Category</label>
            <select value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))} data-testid="faq-category-select" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
              {FAQ_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Question</label>
            <input value={form.question} onChange={(e) => setForm((s) => ({ ...s, question: e.target.value }))} data-testid="faq-question-input" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Answer</label>
            <textarea value={form.answer} onChange={(e) => setForm((s) => ({ ...s, answer: e.target.value }))} rows={5} data-testid="faq-answer-input" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function TestimonialsTab() {
  const [filter, setFilter] = useState("pending");
  const [items, setItems] = useState(null);
  const load = (f) => api.get(`/admin/testimonials${f ? `?status=${f}` : ""}`).then(({ data }) => setItems(data)).catch(() => setItems([]));
  useEffect(() => { setItems(null); load(filter); }, [filter]);
  const act = async (t, status) => {
    try { await api.patch(`/admin/testimonials/${t.id}`, { status }); toast.success(status === "approved" ? "Approved" : "Hidden"); load(filter); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't update"); }
  };
  const del = async (t) => {
    if (!window.confirm("Delete this testimonial?")) return;
    try { await api.delete(`/admin/testimonials/${t.id}`); toast.success("Deleted"); load(filter); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't delete"); }
  };
  const FILTERS = [["pending", "Pending"], ["approved", "Approved"], ["hidden", "Hidden"], ["", "All"]];
  return (
    <div className="mt-4">
      <div className="flex gap-2 flex-wrap mb-4">
        {FILTERS.map(([k, l]) => (
          <button key={k || "all"} onClick={() => setFilter(k)} data-testid={`testimonial-filter-${k || "all"}`}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border ${filter === k ? "bg-[#1F3F5B] text-white border-[#1F3F5B]" : "bg-white border-slate-200 text-slate-600"}`}>{l}</button>
        ))}
      </div>
      {items === null ? <p className="text-slate-400">Loading…</p> : !items.length ? (
        <p className="text-slate-500" data-testid="admin-testimonials-empty">No testimonials here.</p>
      ) : (
        <div className="space-y-2" data-testid="admin-testimonials-list">
          {items.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border border-slate-100 p-4" data-testid={`admin-testimonial-${t.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700">&ldquo;{t.quote}&rdquo;</p>
                  <div className="text-xs text-slate-500 mt-2">
                    {t.show_name ? <span className="font-bold">{t.display_name}</span> : <span className="italic">name hidden</span>}
                    {" · "}<span className="capitalize">{[t.role, t.market].filter(Boolean).join(" · ")}</span>
                  </div>
                </div>
                <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${t.status === "approved" ? "bg-emerald-50 text-emerald-700" : t.status === "hidden" ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700"}`}>{t.status}</span>
              </div>
              <div className="flex gap-2 mt-3">
                {t.status !== "approved" && <button onClick={() => act(t, "approved")} data-testid={`testimonial-approve-${t.id}`} className="text-xs font-bold text-emerald-700 border border-emerald-200 rounded-full px-3 py-1.5 hover:bg-emerald-50">Approve</button>}
                {t.status !== "hidden" && <button onClick={() => act(t, "hidden")} data-testid={`testimonial-hide-${t.id}`} className="text-xs font-bold text-slate-600 border border-slate-200 rounded-full px-3 py-1.5 hover:bg-slate-50">Hide</button>}
                <button onClick={() => del(t)} data-testid={`testimonial-delete-${t.id}`} className="text-xs font-bold text-red-600 border border-red-200 rounded-full px-3 py-1.5 hover:bg-red-50">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DisputeAttachment({ disputeId, att }) {
  const [loading, setLoading] = useState(false);
  const open = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/review-disputes/${disputeId}/attachments/${att.index}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { toast.error("Couldn't open the attachment."); }
    finally { setLoading(false); }
  };
  return (
    <button onClick={open} disabled={loading} data-testid={`att-${disputeId}-${att.index}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1.5 hover:border-[#55B3AD]">
      <Icon name={att.content_type === "application/pdf" ? "upload" : "image"} tone="current" className="h-3.5 w-3.5" />
      {loading ? "Opening…" : (att.filename || "file")}
    </button>
  );
}

function DisputeCard({ d, removalReasons = [], onChanged }) {
  const [decision, setDecision] = useState("stays");
  const [reason, setReason] = useState("");
  const [removalCode, setRemovalCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(d.status === "open");
  const isSelfRemoval = d.reason === "remove_my_own_review";

  const act = async (fn, okMsg) => {
    if (!reason.trim()) { toast.error("A reason is required."); return; }
    setBusy(true);
    try { await fn(); toast.success(okMsg); onChanged(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Action failed."); }
    finally { setBusy(false); }
  };
  const decide = () => {
    if (decision === "removed" && !isSelfRemoval && !removalCode) { toast.error("Pick a standard removal reason."); return; }
    return act(() => api.post(`/admin/review-disputes/${d.id}/decide`, { decision, decision_reason: reason, removal_reason_code: (decision === "removed" && !isSelfRemoval) ? removalCode : null }), "Decision saved.");
  };
  const flag = () => {
    if (!window.confirm("Flag this filer for possible dispute misuse?\n\nThis adds an internal flag and raises their flag count for admins. It does NOT notify anyone, does NOT change any review or rating, and is not easily undone from here.")) return;
    return act(() => api.post(`/admin/review-disputes/${d.id}/flag-filer`, { reason }), "Filer flagged.");
  };
  const hold = () => act(() => api.post(`/admin/review-sessions/${d.session_id}/hold`, { reason }), "Review held.");
  const release = () => act(() => api.post(`/admin/review-sessions/${d.session_id}/release`, { reason }), "Review released.");
  const restore = () => {
    if (!window.confirm("Restore this removed review?\n\nIt becomes live again and counts toward averages. Both people get a neutral notice. This is audit logged.")) return;
    return act(() => api.post(`/admin/review-disputes/${d.id}/restore`, { reason }), "Review restored.");
  };
  const unflag = () => act(() => api.post(`/admin/review-disputes/${d.id}/unflag-filer`, { reason }), "Filer unflagged.");
  const canRestore = d.status === "decided" && d.decision === "removed" && !d.restored;
  const showPanel = open || canRestore || d.flagged_filer;

  return (
    <article className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4" data-testid={`admin-dispute-${d.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="font-semibold text-[#1F3F5B] dark:text-slate-100">{d.reason_label}{d.is_contest ? " (contest)" : ""}</div>
          <div className="text-xs text-slate-500">{d.filer_name} · {d.filer_role} → about {d.target_name || "—"}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {d.mutual_pair && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-purple-100 text-purple-800" title="Mutual Boat Pro pair">Mutual pair</span>}
          {d.pending_at_file && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">Filed while pending</span>}
          {d.held && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Held</span>}
          {d.flagged_filer && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-100 text-red-800">Filer flagged</span>}
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${d.status === "decided" ? "bg-teal-100 text-teal-900" : "bg-slate-200 text-slate-700"}`}>{d.status === "decided" ? (d.decision_label || "Decided") : "Open"}</span>
        </div>
      </div>
      {d.explanation && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 break-words">&ldquo;{d.explanation}&rdquo;</p>}
      <div className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-sm">
        <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Disputed review{!d.review?.exists ? " (removed)" : ""}</div>
        <div className="text-slate-700 dark:text-slate-200">Overall {d.review?.ratings?.overall ?? "—"}</div>
        {d.review?.comment && <p className="text-slate-600 dark:text-slate-300 break-words">{d.review.comment}</p>}
      </div>
      {d.attachments?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" data-testid={`atts-${d.id}`}>
          {d.attachments.map((a) => <DisputeAttachment key={a.index} disputeId={d.id} att={a} />)}
        </div>
      )}
      {d.status === "decided" && d.decision_reason && (
        <p className="mt-2 text-xs text-slate-500">Decision reason (internal): {d.decision_reason}</p>
      )}
      {d.history?.length > 0 && (
        <details className="mt-2"><summary className="text-xs text-slate-500 cursor-pointer">History ({d.history.length})</summary>
          <ul className="mt-1 text-xs text-slate-500 space-y-0.5">
            {d.history.map((h, i) => <li key={i}>{(h.at || "").slice(0, 16).replace("T", " ")} · {h.action}{h.decision ? ` → ${h.decision}` : ""}{h.reason ? ` · ${h.reason}` : ""}</li>)}
          </ul>
        </details>
      )}
      {showPanel && (
        <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Internal note (required, never shown to members)…"
                    data-testid={`admin-reason-${d.id}`} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#55B3AD] outline-none" />
          {d.status === "open" && decision === "removed" && !isSelfRemoval && (
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Standard reason shown to the reviewer</label>
              <select value={removalCode} onChange={(e) => setRemovalCode(e.target.value)} data-testid={`admin-removal-reason-${d.id}`}
                      className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2 py-2 text-sm focus:border-[#55B3AD] outline-none">
                <option value="">Pick a standard reason…</option>
                {removalReasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {d.status === "open" && (
              <>
                <select value={decision} onChange={(e) => setDecision(e.target.value)} data-testid={`admin-decision-${d.id}`}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2 py-2 text-sm">
                  <option value="stays">Stays</option>
                  <option value="removed">Removed</option>
                  <option value="kept_with_details_removed">Kept, details removed</option>
                </select>
                <button onClick={decide} disabled={busy} data-testid={`admin-decide-${d.id}`} className="min-h-[40px] rounded-full bg-[#1F3F5B] text-white px-4 py-1.5 text-sm font-semibold disabled:opacity-50">Decide</button>
              </>
            )}
            {d.status === "open" && d.session_id && d.session_status === "pending" && (d.held
              ? <button onClick={release} disabled={busy} className="min-h-[40px] rounded-full border border-slate-200 dark:border-slate-700 px-4 py-1.5 text-sm font-semibold">Release</button>
              : <button onClick={hold} disabled={busy} className="min-h-[40px] rounded-full border border-slate-200 dark:border-slate-700 px-4 py-1.5 text-sm font-semibold">Hold</button>)}
            {canRestore && <button onClick={restore} disabled={busy} data-testid={`admin-restore-${d.id}`} className="min-h-[40px] rounded-full border border-emerald-300 text-emerald-700 px-4 py-1.5 text-sm font-semibold">Restore review</button>}
            {d.status === "open" && !d.flagged_filer && <button onClick={flag} disabled={busy} data-testid={`admin-flag-${d.id}`} className="min-h-[40px] rounded-full border border-slate-200 dark:border-slate-700 px-4 py-1.5 text-sm font-semibold text-red-600">Flag filer</button>}
            {d.flagged_filer && <button onClick={unflag} disabled={busy} data-testid={`admin-unflag-${d.id}`} className="min-h-[40px] rounded-full border border-slate-200 dark:border-slate-700 px-4 py-1.5 text-sm font-semibold">Unflag filer</button>}
          </div>
        </div>
      )}
      {!showPanel && <button onClick={() => setOpen(true)} className="mt-2 text-xs text-[#2A7871] underline">Show actions</button>}
    </article>
  );
}

function DisputesTab() {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState("open");
  const [reason, setReason] = useState("");
  const [reasons, setReasons] = useState([]);
  const [removalReasons, setRemovalReasons] = useState([]);

  const load = () => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (reason) p.set("reason", reason);
    api.get(`/admin/review-disputes?${p.toString()}`).then((r) => setRows(r.data.disputes || [])).catch(() => setRows([]));
  };
  useEffect(() => { api.get("/review-disputes/meta").then((r) => { setReasons(r.data.reasons || []); setRemovalReasons(r.data.removal_reasons || []); }).catch(() => {}); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, reason]);

  return (
    <div data-testid="disputes-tab">
      <div className="flex flex-wrap gap-2 mb-4">
        <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="dispute-status-filter" className="rounded-full border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm">
          <option value="">All</option><option value="open">Open</option><option value="decided">Decided</option>
        </select>
        <select value={reason} onChange={(e) => setReason(e.target.value)} data-testid="dispute-reason-filter" className="rounded-full border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm">
          <option value="">All reasons</option>
          {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </div>
      {rows === null ? <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
        : !rows.length ? <p className="text-center text-slate-500 py-8" data-testid="disputes-empty">No disputes.</p>
        : <div className="space-y-3">{rows.map((d) => <DisputeCard key={d.id} d={d} removalReasons={removalReasons} onChanged={load} />)}</div>}
    </div>
  );
}


export default function AdminModeration() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState("audit");
  useEffect(() => { if (!loading && (!user || user.platform_role !== "admin")) nav("/"); }, [user, loading, nav]);
  if (loading || !user) return null;

  const TABS = [
    { k: "audit", label: "Audit log" },
    { k: "users", label: "Members" },
    { k: "faqs", label: "FAQ" },
    { k: "testimonials", label: "Testimonials" },
    { k: "disputes", label: "Disputes" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="font-display font-extrabold text-3xl text-[#1F3F5B] flex items-center gap-2"><Icon name="shield-alert" tone="current" className="h-7 w-7" /> Moderation</h1>
      <div className="mt-6 flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} data-testid={`tab-${t.k}`}
                  className={`px-4 py-2 rounded-full text-sm font-semibold border ${tab === t.k ? "bg-[#1F3F5B] text-white border-[#1F3F5B]" : "bg-white border-slate-200"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "audit" && <AuditTab />}
      {tab === "users" && <UsersTab />}
      {tab === "faqs" && <FaqTab />}
      {tab === "testimonials" && <TestimonialsTab />}
      {tab === "disputes" && <DisputesTab />}
    </div>
  );
}
