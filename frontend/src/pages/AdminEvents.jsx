import { useEffect, useState, useMemo } from "react";
import { Icon } from "@/components/Icon";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { EVENT_CATEGORIES, categoryMeta, formatEventDate, ptInputToISO, isoToPTInput, eventTitleParts } from "@/lib/eventCategories";
import FlyerUploader from "@/components/FlyerUploader";

export default function AdminEvents() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [events, setEvents] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [inputs, setInputs] = useState({});
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [marketF, setMarketF] = useState("all");
  const [sourceF, setSourceF] = useState("all");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [catBusy, setCatBusy] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkName, setBulkName] = useState("");
  const [bulkEmail, setBulkEmail] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkActionBusy, setBulkActionBusy] = useState("");
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedList, setDeletedList] = useState([]);
  const [deletedBusy, setDeletedBusy] = useState(false);
  const [restoringId, setRestoringId] = useState(null);

  const toggleSel = (id) => setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const bulkDelete = async () => {
    setBulkActionBusy("delete");
    try {
      const { data } = await api.post("/admin/events/bulk-delete", { event_ids: [...selectedIds] });
      toast.success(`Deleted ${data.deleted} event${data.deleted === 1 ? "" : "s"}. You can restore from Deleted events.`);
      setConfirmBulkDelete(false);
      setSelectedIds(new Set());
      await refreshEvents();
    } catch (e) { toast.error(e?.response?.data?.detail || "Bulk delete failed"); }
    finally { setBulkActionBusy(""); }
  };

  const bulkReview = async () => {
    setBulkActionBusy("review");
    try {
      const { data } = await api.post("/admin/events/bulk-review", { event_ids: [...selectedIds] });
      toast.success(`Marked ${data.updated} event${data.updated === 1 ? "" : "s"} reviewed`);
      setSelectedIds(new Set());
      await refreshEvents();
    } catch (e) { toast.error(e?.response?.data?.detail || "Mark reviewed failed"); }
    finally { setBulkActionBusy(""); }
  };

  const confirmEvents = async (ids) => {
    const list = [...ids];
    setBulkActionBusy("confirm");
    try {
      const { data } = await api.post("/admin/events/confirm", { event_ids: list });
      toast.success(`Confirmed ${data.confirmed} event${data.confirmed === 1 ? "" : "s"}. The Tentative tag is removed and locked against re-import.`);
      if (list.length > 1) setSelectedIds(new Set());
      await refreshEvents();
    } catch (e) { toast.error(e?.response?.data?.detail || "Confirm failed"); }
    finally { setBulkActionBusy(""); }
  };

  const loadDeleted = async () => {
    setDeletedBusy(true);
    try { const { data } = await api.get("/admin/events/deleted"); setDeletedList(data.events || []); }
    catch { toast.error("Couldn't load deleted events"); }
    finally { setDeletedBusy(false); }
  };

  const openDeleted = async () => { setShowDeleted(true); await loadDeleted(); };

  const restoreEvent = async (id) => {
    setRestoringId(id);
    try {
      await api.post(`/admin/events/${id}/restore`);
      toast.success("Event restored");
      setDeletedList((list) => list.filter((d) => d.id !== id));
      await refreshEvents();
    } catch (e) { toast.error(e?.response?.data?.detail || "Restore failed"); }
    finally { setRestoringId(null); }
  };

  const refreshEvents = async () => {
    const { data } = await api.get("/admin/events");
    setEvents(data || []);
  };

  const doDelete = async (ev) => {
    try {
      await api.post("/admin/events/bulk-delete", { event_ids: [ev.id] });
      toast.success("Event deleted. You can restore it from Deleted events.");
      setDeleting(null);
      setEvents((list) => list.filter((e) => e.id !== ev.id));
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't delete"); }
  };

  const applyBulk = async () => {
    const payload = { event_ids: [...selectedIds] };
    if (bulkName.trim()) payload.organizer_name = bulkName.trim();
    if (bulkEmail.trim()) payload.organizer_email = bulkEmail.trim();
    if (!payload.organizer_name && !payload.organizer_email) return toast.error("Enter an organizer name and/or contact email");
    setBulkBusy(true);
    try {
      const { data } = await api.patch("/admin/events/bulk", payload);
      toast.success(`Updated ${data.updated} event${data.updated === 1 ? "" : "s"}`);
      setSelectedIds(new Set()); setBulkName(""); setBulkEmail("");
      await refreshEvents();
    } catch (e) { toast.error(e?.response?.data?.detail || "Bulk update failed"); }
    finally { setBulkBusy(false); }
  };

  const setCategory = async (ev, category) => {
    setCatBusy(ev.id);
    try {
      await api.patch(`/admin/events/${ev.id}/category`, { category });
      setEvents((list) => list.map((e) => e.id === ev.id ? { ...e, category, category_manual: true, category_needs_review: false } : e));
      toast.success(`Category set to ${categoryMeta(category).label}`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setCatBusy(null); }
  };

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    if (user.platform_role !== "admin") { setError("Admin access required."); return; }
    api.get("/admin/events").then(({ data }) => {
      setEvents(data || []);
      const d = {};
      for (const e of data || []) d[e.id] = [...(e.email_recipients || [])];
      setDrafts(d);
    }).catch((e) => setError(e?.response?.data?.detail || "Failed to load"));
  }, [user, loading, nav]);

  // EVENTS-ADMIN-BULK-1 item 4: scroll-lock safety net. A modal elsewhere in the
  // app can leave document.body locked (overflow hidden / pointer-events none);
  // if the admin lands here unable to scroll, clear any stray lock on mount and
  // whenever none of this page's own modals are open.
  useEffect(() => {
    const anyModalOpen = editing || deleting || confirmBulkDelete || showDeleted;
    if (anyModalOpen) return;
    const b = document.body.style;
    if (b.overflow === "hidden") b.overflow = "";
    if (b.position === "fixed") b.position = "";
    if (b.pointerEvents === "none") b.pointerEvents = "";
    document.documentElement.style.overflow = "";
  }, [editing, deleting, confirmBulkDelete, showDeleted]);

  const markets = useMemo(() => Array.from(new Set(events.map((e) => e.market).filter(Boolean))).sort(), [events]);
  const sources = useMemo(() => Array.from(new Set(events.map((e) => e.source || "community").filter(Boolean))).sort(), [events]);

  const visible = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return events.filter((e) => {
      if (marketF !== "all" && e.market !== marketF) return false;
      if (sourceF !== "all" && (e.source || "community") !== sourceF) return false;
      if (reviewOnly && !e.category_needs_review) return false;
      if (ql && !e.title?.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [events, q, marketF, sourceF, reviewOnly]);
  const reviewCount = useMemo(() => events.filter((e) => e.category_needs_review).length, [events]);
  const needsContact = (e) => e.source === "aggregator" && (!e.organizer_name || !e.organizer_email);
  const missingContactCount = useMemo(() => events.filter(needsContact).length, [events]);

  const addEmail = (evId) => {
    const raw = (inputs[evId] || "").trim().toLowerCase();
    if (!raw) return;
    if (!raw.includes("@") || raw.includes(" ") || raw.length > 254) return toast.error("Invalid email");
    setDrafts((d) => ({ ...d, [evId]: Array.from(new Set([...(d[evId] || []), raw])) }));
    setInputs((i) => ({ ...i, [evId]: "" }));
  };
  const removeEmail = (evId, email) => setDrafts((d) => ({ ...d, [evId]: (d[evId] || []).filter((x) => x !== email) }));
  const save = async (ev) => {
    setBusyId(ev.id);
    try {
      await api.patch(`/admin/events/${ev.id}/email-recipients`, { email_recipients: drafts[ev.id] || [] });
      toast.success(`Recipients saved for "${ev.title}".`);
      // refresh
      const { data } = await api.get("/admin/events");
      setEvents(data || []);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusyId(null); }
  };
  const isDirty = (ev) => ((ev.email_recipients || []).slice().sort().join(",") !== (drafts[ev.id] || []).slice().sort().join(","));

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <Icon name="shield-alert" tone="current" className="h-12 w-12 text-orange-500 mx-auto" />
        <h1 className="mt-4 text-2xl font-display font-bold text-[#1F3F5B]">{error}</h1>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10" data-testid="admin-events-page">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#F2A03B] flex items-center gap-2">
        <Icon name="mail" tone="current" className="h-3.5 w-3.5" /> Admin · Per-event email recipients
      </div>
      <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl mt-2 tracking-tight">Route crew signups.</h1>

      <SyncStatusCard />

      <div className="mt-6 grid gap-2 sm:grid-cols-4" data-testid="admin-events-filters">
        <label className="sm:col-span-2 relative">
          <Icon name="search" tone="current" className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="filter-search" placeholder="Search title…"
                 className="w-full rounded-full border border-slate-200 pl-9 pr-3 py-2 text-sm focus:border-[#55B3AD] outline-none" />
        </label>
        <select value={marketF} onChange={(e) => setMarketF(e.target.value)} data-testid="filter-market"
                className="rounded-full border border-slate-200 px-3 py-2 text-sm bg-white">
          <option value="all">All markets</option>
          {markets.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={sourceF} onChange={(e) => setSourceF(e.target.value)} data-testid="filter-source"
                className="rounded-full border border-slate-200 px-3 py-2 text-sm bg-white">
          <option value="all">All sources</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="mt-2 flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-slate-500" data-testid="admin-events-count">{visible.length} of {events.length} shown</div>
        <button onClick={() => setReviewOnly(!reviewOnly)} data-testid="filter-needs-review"
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border ${reviewOnly ? "bg-orange-500 text-white border-orange-500" : "border-orange-300 text-[#d98c30] hover:bg-orange-50"}`}>
          <Icon name="warning" tone="current" className="h-3.5 w-3.5" /> Needs category review {reviewCount > 0 && <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] px-1 ${reviewOnly ? "bg-white text-orange-600" : "bg-orange-500 text-white"}`}>{reviewCount}</span>}
        </button>
        <button onClick={() => setSelectedIds(new Set(visible.filter(needsContact).map((e) => e.id)))} data-testid="select-missing-contact"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border border-red-300 text-red-600 hover:bg-red-50">
          <Icon name="mail" tone="current" className="h-3.5 w-3.5" /> Select missing contact {missingContactCount > 0 && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] px-1 bg-red-500 text-white">{missingContactCount}</span>}
        </button>
        <button onClick={openDeleted} data-testid="open-deleted-events"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border border-slate-300 text-slate-600 hover:bg-slate-50">
          <Icon name="trash" tone="current" className="h-3.5 w-3.5" /> Deleted events
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {selectedIds.size > 0 && (
          <div className="sticky top-2 z-10 bg-[#1F3F5B] text-white rounded-2xl p-4 shadow-lg flex flex-col gap-3" data-testid="bulk-bar">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-wrap">
              <div className="text-sm font-bold whitespace-nowrap">{selectedIds.size} selected</div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setConfirmBulkDelete(true)} disabled={!!bulkActionBusy} data-testid="bulk-delete"
                        className="inline-flex items-center gap-1.5 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 text-sm font-bold">
                  <Icon name="trash" tone="current" className="h-4 w-4" /> Delete selected
                </button>
                <button onClick={bulkReview} disabled={!!bulkActionBusy} data-testid="bulk-review"
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 disabled:opacity-50 px-4 py-2 text-sm font-bold">
                  <Icon name="success" tone="current" className="h-4 w-4" /> {bulkActionBusy === "review" ? "Marking…" : "Mark reviewed"}
                </button>
                <button onClick={() => confirmEvents(selectedIds)} disabled={!!bulkActionBusy} data-testid="bulk-confirm"
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#55B3AD] hover:bg-[#45938e] disabled:opacity-50 px-4 py-2 text-sm font-bold text-[#0d2a28]">
                  <Icon name="success" tone="current" className="h-4 w-4" /> {bulkActionBusy === "confirm" ? "Confirming…" : "Mark confirmed"}
                </button>
                <button onClick={() => setSelectedIds(new Set())} className="text-white/70 hover:text-white text-sm px-2">Clear</button>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 border-t border-white/15 pt-3">
              <div className="text-[11px] uppercase tracking-widest font-bold text-white/60 whitespace-nowrap">Set organizer</div>
              <input value={bulkName} onChange={(e) => setBulkName(e.target.value)} data-testid="bulk-organizer-name" placeholder="Organizer name"
                     className="flex-1 min-w-0 rounded-full border-0 px-3 py-2 text-sm text-[#1F3F5B]" />
              <input value={bulkEmail} onChange={(e) => setBulkEmail(e.target.value)} data-testid="bulk-organizer-email" placeholder="RSVP contact email" type="email"
                     className="flex-1 min-w-0 rounded-full border-0 px-3 py-2 text-sm text-[#1F3F5B]" />
              <button onClick={applyBulk} disabled={bulkBusy} data-testid="bulk-apply"
                      className="rounded-full bg-[#F2A03B] hover:bg-[#d98c30] disabled:opacity-50 px-5 py-2 text-sm font-bold whitespace-nowrap">{bulkBusy ? "Applying…" : "Apply to selected"}</button>
            </div>
          </div>
        )}
        {visible.length === 0 && <div className="text-slate-500 text-sm">No events match your filters.</div>}
        {visible.map((ev) => {
          const recipients = drafts[ev.id] || [];
          const parts = eventTitleParts(ev.title);
          return (
            <div key={ev.id} className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-100 shadow-sm" data-testid={`admin-event-${ev.id}`}>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
                <div className="min-w-0 flex items-start gap-3">
                  <input type="checkbox" checked={selectedIds.has(ev.id)} onChange={() => toggleSel(ev.id)}
                         data-testid={`select-event-${ev.id}`} className="mt-1.5 h-4 w-4 accent-[#55B3AD] shrink-0" />
                  <div className="min-w-0">
                  <div className="font-display font-bold text-base sm:text-lg text-[#1F3F5B] flex items-center gap-2 flex-wrap">
                    <span>{parts.title}</span>
                    {parts.tentative && <span data-testid={`tentative-${ev.id}`} className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#F2A03B]/15 text-[#b86f1a]">Tentative</span>}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                    <span>{formatEventDate(ev.starts_at, ev.time_not_listed)}</span>
                    <span>· {ev.market}</span>
                    <span className="uppercase font-semibold tracking-wider text-slate-400">· {ev.source || "community"}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Organizer: <b className="text-slate-700">{ev.organizer_email || "—"}</b></div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap" data-testid={`category-row-${ev.id}`}>
                    {ev.category_needs_review && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-orange-100 text-[#d98c30]" data-testid={`needs-review-${ev.id}`}><Icon name="warning" tone="current" className="h-3 w-3" /> Review category</span>}
                    <select value={ev.category || "other"} disabled={catBusy === ev.id} onChange={(e) => setCategory(ev, e.target.value)} data-testid={`category-select-${ev.id}`}
                            className="rounded-full border border-slate-200 px-3 py-1 text-xs bg-white font-semibold text-[#1F3F5B]">
                      {EVENT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <span className="text-[10px] text-slate-400">{ev.category_manual ? "set by admin" : "auto-detected"}</span>
                  </div>
                </div>
                </div>
                {isDirty(ev) && <span className="self-start text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-orange-100 text-[#d98c30]">unsaved</span>}
                {needsContact(ev) && <span data-testid={`needs-contact-${ev.id}`} className="self-start text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-red-100 text-red-600">needs contact</span>}
                <button onClick={() => setEditing(ev)} data-testid={`edit-event-${ev.id}`}
                        className="self-start inline-flex items-center gap-1 rounded-full border border-slate-200 hover:border-[#55B3AD] px-3 py-1.5 text-xs font-semibold text-[#1F3F5B]">
                  <Icon name="edit" tone="current" className="h-3.5 w-3.5" /> Edit details
                </button>
                {parts.tentative && (
                  <button onClick={() => confirmEvents([ev.id])} disabled={!!bulkActionBusy} data-testid={`confirm-event-${ev.id}`}
                          className="self-start inline-flex items-center gap-1 rounded-full border border-[#55B3AD] text-[#2A7871] hover:bg-[#55B3AD]/10 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold">
                    <Icon name="success" tone="current" className="h-3.5 w-3.5" /> Mark confirmed
                  </button>
                )}
                <button onClick={() => setDeleting(ev)} data-testid={`delete-event-${ev.id}`}
                        className="self-start inline-flex items-center gap-1 rounded-full border border-red-200 hover:bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600">
                  <Icon name="trash" tone="current" className="h-3.5 w-3.5" /> Delete
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2" data-testid={`recipients-${ev.id}`}>
                {recipients.length === 0 && <div className="text-xs text-slate-400 italic">No extra recipients yet.</div>}
                {recipients.map((r) => (
                  <span key={r} className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 px-2.5 py-1 text-xs">
                    {r}
                    <button onClick={() => removeEmail(ev.id, r)} data-testid={`rm-${ev.id}-${r}`} className="text-slate-400 hover:text-red-500"><Icon name="close" tone="current" className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>

              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <input type="email" value={inputs[ev.id] || ""} onChange={(e) => setInputs((i) => ({ ...i, [ev.id]: e.target.value }))}
                       onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(ev.id); } }}
                       placeholder="ops@partner.org" data-testid={`input-${ev.id}`}
                       className="flex-1 min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#55B3AD] outline-none" />
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => addEmail(ev.id)} data-testid={`add-${ev.id}`}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 hover:border-[#55B3AD] px-4 py-2 text-sm font-semibold text-[#1F3F5B]">
                    <Icon name="add" tone="current" className="h-4 w-4" /> Add
                  </button>
                  <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 hover:border-[#55B3AD] px-4 py-2 text-sm font-semibold text-[#1F3F5B] cursor-pointer">
                    <input type="file" accept=".csv,text/csv,text/plain" data-testid={`csv-${ev.id}`}
                           className="hidden"
                           onChange={async (e) => {
                             const f = e.target.files?.[0]; if (!f) return;
                             const txt = await f.text();
                             try {
                               const { data } = await api.post(`/admin/events/${ev.id}/recipients-bulk`, { csv: txt });
                               toast.success(`Imported ${data.added} email${data.added===1?"":"s"}` + (data.invalid?.length ? ` (${data.invalid.length} invalid skipped)` : ""));
                               const r = await api.get("/admin/events");
                               setEvents(r.data || []);
                             } catch { toast.error("Import failed"); }
                             finally { e.target.value = ""; }
                           }} />
                    Import CSV
                  </label>
                  <button type="button" data-testid={`csv-template-${ev.id}`}
                          onClick={() => {
                            const sample = "# Sail More Now — recipients CSV template\n# Accepted formats: one email per line OR comma-separated on a single line.\n# Duplicates and case are auto-normalized.\nops@partner.org\ncaptain@yc.com\nfleet-captain@example.com, dockmaster@example.com\n";
                            const blob = new Blob([sample], { type: "text/csv;charset=utf-8" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url; a.download = "recipients-template.csv";
                            document.body.appendChild(a); a.click();
                            document.body.removeChild(a); URL.revokeObjectURL(url);
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 hover:border-[#55B3AD] px-4 py-2 text-sm font-semibold text-slate-500">
                    Template
                  </button>
                  <button onClick={() => save(ev)} disabled={!isDirty(ev) || busyId === ev.id} data-testid={`save-${ev.id}`}
                          className="inline-flex items-center gap-1 rounded-full bg-[#1F3F5B] hover:bg-[#152a3d] disabled:opacity-40 text-white px-4 py-2 text-sm font-semibold">
                    <Icon name="success" tone="current" className="h-4 w-4" /> Save
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {editing && <EventEditModal ev={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refreshEvents(); }} />}
      {deleting && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDeleting(null)} data-testid="event-delete-modal">
          <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold text-lg text-[#1F3F5B]">Delete event?</h3>
            <p className="mt-2 text-sm text-slate-600">
              This removes "<b>{eventTitleParts(deleting.title).title}</b>" and its signups from the calendar.
              {deleting.source === "aggregator" ? " Because it's an imported feed event, it is tombstoned so the importer never brings it back." : ""}
              {" "}A copy is kept under Deleted events so you can restore it.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} data-testid="delete-event-cancel"
                      className="rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={() => doDelete(deleting)} data-testid="delete-event-confirm"
                      className="rounded-full bg-red-600 hover:bg-red-700 text-white px-5 py-2 text-sm font-semibold">Delete event</button>
            </div>
          </div>
        </div>
      )}
      {confirmBulkDelete && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmBulkDelete(false)} data-testid="bulk-delete-modal">
          <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold text-lg text-[#1F3F5B]">Delete {selectedIds.size} event{selectedIds.size === 1 ? "" : "s"}?</h3>
            <p className="mt-2 text-sm text-slate-600">
              The selected events and their signups are removed from the calendar. Imported feed events are tombstoned so the importer never brings them back. A copy of each is kept under Deleted events so you can restore it.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmBulkDelete(false)} data-testid="bulk-delete-cancel"
                      className="rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button onClick={bulkDelete} disabled={bulkActionBusy === "delete"} data-testid="bulk-delete-confirm"
                      className="rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-5 py-2 text-sm font-semibold">{bulkActionBusy === "delete" ? "Deleting…" : "Delete events"}</button>
            </div>
          </div>
        </div>
      )}
      {showDeleted && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setShowDeleted(false)} data-testid="deleted-events-modal">
          <div className="bg-white rounded-2xl w-full max-w-2xl my-8 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-display font-bold text-lg text-[#1F3F5B]">Deleted events</h3>
              <button onClick={() => setShowDeleted(false)} data-testid="deleted-events-close" className="text-slate-400 hover:text-slate-700"><Icon name="close" tone="current" className="h-5 w-5" /></button>
            </div>
            <p className="text-xs text-slate-500 mb-4">Restore re-adds the event and its signups. Copies are kept and never auto-purged.</p>
            {deletedBusy && <div className="text-sm text-slate-500 py-8 text-center">Loading…</div>}
            {!deletedBusy && deletedList.length === 0 && <div className="text-sm text-slate-500 py-8 text-center" data-testid="deleted-events-empty">No deleted events.</div>}
            <div className="space-y-3">
              {deletedList.map((d) => (
                <div key={d.id} className="border border-slate-100 rounded-xl p-3 flex items-start justify-between gap-3" data-testid={`deleted-event-${d.id}`}>
                  <div className="min-w-0">
                    <div className="font-semibold text-[#1F3F5B] text-sm">{eventTitleParts(d.title).title}</div>
                    <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-2">
                      <span>{formatEventDate(d.starts_at, d.time_not_listed)}</span>
                      {d.market && <span>· {d.market}</span>}
                      <span className="uppercase tracking-wider text-slate-400">· {d.source || "community"}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      Deleted {d.deleted_at ? new Date(d.deleted_at).toLocaleDateString() : ""}{d.deleted_by_name ? ` by ${d.deleted_by_name}` : ""}
                    </div>
                  </div>
                  <button onClick={() => restoreEvent(d.id)} disabled={restoringId === d.id} data-testid={`restore-event-${d.id}`}
                          className="shrink-0 self-start inline-flex items-center gap-1 rounded-full bg-[#1F3F5B] hover:bg-[#152a3d] disabled:opacity-50 text-white px-4 py-1.5 text-xs font-semibold">
                    <Icon name="refresh" tone="current" className="h-3.5 w-3.5" /> {restoringId === d.id ? "Restoring…" : "Restore"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EventEditModal({ ev, onClose, onSaved }) {
  const [f, setF] = useState({
    title: ev.title || "", description: ev.description || "", location: ev.location || "",
    category: ev.category || "other", image_url: ev.image_url || "",
    organizer_name: ev.organizer_name || "", organizer_email: ev.organizer_email || "",
    registration_url: ev.registration_url || "", market: ev.market || "",
    starts_at: isoToPTInput(ev.starts_at), ends_at: isoToPTInput(ev.ends_at),
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      const payload = {};
      for (const [k, v] of Object.entries(f)) {
        const orig = k === "starts_at" || k === "ends_at" ? isoToPTInput(ev[k]) : (ev[k] || "");
        if (String(v) !== String(orig) && !(v === "" && !ev[k])) {
          if ((k === "starts_at" || k === "ends_at") && v) payload[k] = ptInputToISO(v);
          else payload[k] = v;
        }
      }
      if (Object.keys(payload).length === 0) { onClose(); return; }
      if ((payload.starts_at || payload.ends_at)) {
        const s = payload.starts_at || ptInputToISO(f.starts_at);
        const e2 = payload.ends_at || (f.ends_at ? ptInputToISO(f.ends_at) : null);
        if (s && e2 && new Date(e2) <= new Date(s)) return toast.error("End time must be after the start time");
      }
      if (payload.organizer_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.organizer_email)) {
        return toast.error("Enter a valid contact email");
      }
      if (payload.registration_url && !/^https?:\/\//i.test(payload.registration_url)) {
        return toast.error("Registration URL must start with http:// or https://");
      }
      await api.patch(`/admin/events/${ev.id}`, payload);
      toast.success("Event updated");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to update"); }
    finally { setBusy(false); }
  };
  const field = (label, k, type = "text") => (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
      <input type={type} value={f[k]} onChange={set(k)} data-testid={`edit-field-${k}`}
             className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#55B3AD] outline-none" />
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose} data-testid="event-edit-modal">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-lg text-[#1F3F5B]">Edit event</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><Icon name="close" tone="current" className="h-5 w-5" /></button>
        </div>
        {ev.source === "aggregator" && <div className="mb-3 text-xs bg-amber-50 border border-amber-100 text-amber-700 rounded-lg px-3 py-2">Imported feed event - your edits override the scraped values.</div>}
        <div className="space-y-3">
          {field("Title", "title")}
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Category</span>
            <select value={f.category} onChange={set("category")} data-testid="edit-field-category"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:border-[#55B3AD] outline-none">
              {EVENT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Description</span>
            <textarea value={f.description} onChange={set("description")} rows={3} data-testid="edit-field-description"
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#55B3AD] outline-none resize-none" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            {field("Starts", "starts_at", "datetime-local")}
            {field("Ends", "ends_at", "datetime-local")}
          </div>
          {field("Location", "location")}
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Photo</span>
            <div className="mt-1" data-testid="edit-field-image_url">
              <FlyerUploader value={f.image_url} onChange={(v) => setF((p) => ({ ...p, image_url: v }))} label="Upload event photo (optional)" />
            </div>
          </label>
          {field("Market", "market")}
          {field("Organizer name", "organizer_name")}
          {field("RSVP contact email", "organizer_email", "email")}
          {field("Registration / link URL", "registration_url", "url")}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} data-testid="edit-event-save"
                  className="rounded-full bg-[#1F3F5B] hover:bg-[#152a3d] disabled:opacity-40 text-white px-5 py-2 text-sm font-semibold">{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}


function fmtWhen(iso) {
  if (!iso) return "—";
  try { return formatEventDate(iso); }
  catch { return iso; }
}

function SyncStatusCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get("/admin/events/sync-status").then(({ data }) => setStatus(data)).catch(() => {});
  useEffect(() => { load(); }, []);
  const resync = async () => {
    setBusy(true);
    try { const { data } = await api.post("/admin/events/aggregate"); toast.success(`Synced · ${data.inserted || 0} new, ${data.updated || 0} updated`); await load(); }
    catch { toast.error("Sync failed"); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-6 rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex items-center justify-between gap-4 flex-wrap" data-testid="sync-status-card">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="h-10 w-10 rounded-full bg-[#55B3AD]/15 text-[#2A7871] flex items-center justify-center"><Icon name="events" tone="current" className="h-5 w-5" /></span>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Calendar freshness</div>
          <div className="text-sm text-slate-700 dark:text-slate-200 mt-0.5">
            Last synced <b data-testid="sync-last">{fmtWhen(status?.last_run_at)}</b>
            <span className="text-slate-400"> · </span>
            Next auto-sync <b data-testid="sync-next">{fmtWhen(status?.next_run_at)}</b>
          </div>
          {typeof status?.last_inserted === "number" && (
            <div className="text-xs text-slate-400 mt-0.5">Last run: {status.last_inserted} new · {status.last_updated} updated{status.last_errors ? ` · ${status.last_errors} errors` : ""}</div>
          )}
        </div>
      </div>
      <button onClick={resync} disabled={busy} data-testid="sync-now-btn"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1F3F5B] hover:bg-[#152a3d] text-white px-4 py-2 text-sm font-semibold disabled:opacity-50">
        <Icon name="refresh" tone="current" className="h-4 w-4" /> {busy ? "Syncing…" : "Re-sync now"}
      </button>
    </div>
  );
}
