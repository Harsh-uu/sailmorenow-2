import { useState } from "react";
import { toast } from "sonner";
import Modal from "@/components/Modal";
import { Icon } from "@/components/Icon";
import FlyerUploader from "@/components/FlyerUploader";
import { EVENT_CATEGORIES, isoToPTInput, ptInputToISO } from "@/lib/eventCategories";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

// Fields editable per entity (event edits go through the admin event endpoint).
const FIELD_DEFS = {
  post: [
    { k: "title", label: "Title" },
    { k: "body", label: "Body", textarea: true },
    { k: "price", label: "Price", type: "number" },
    { k: "condition", label: "Condition" },
  ],
  discussion: [
    { k: "title", label: "Title" },
    { k: "body", label: "Body", textarea: true },
  ],
  comment: [{ k: "body", label: "Comment", textarea: true }],
  review: [
    { k: "rating", label: "Rating (1–5)", type: "number" },
    { k: "comment", label: "Comment", textarea: true },
  ],
  event: [
    { k: "title", label: "Title" },
    { k: "category", label: "Category", type: "select", options: EVENT_CATEGORIES.map((c) => ({ value: c.key, label: c.label })) },
    { k: "starts_at", label: "Date & time", type: "datetime-local" },
    { k: "ends_at", label: "End (optional)", type: "datetime-local" },
    { k: "location", label: "Location" },
    { k: "description", label: "Description", textarea: true },
    { k: "image_url", label: "Photo", type: "flyer" },
    { k: "organizer_email", label: "Contact email", type: "email" },
    { k: "registration_url", label: "Registration URL", type: "url" },
  ],
};

const LABELS = { post: "post", discussion: "discussion", comment: "comment", review: "review", event: "event" };

// Inline admin Edit + Delete controls for any content item, usable on normal
// pages. Delete always requires a confirm step. Shows nothing for non-admins.
export default function AdminControls({ entity, item, onChanged, className = "", compact = false }) {
  const { user } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({});

  const isAdmin = !!(user && (user.platform_role === "admin" || user.is_admin));
  if (!isAdmin) return null;

  const baseFields = FIELD_DEFS[entity] || [];
  // Price/Condition only make sense for a For Sale listing, not general posts.
  const fields = (entity === "post" && item.type !== "for_sale")
    ? baseFields.filter((f) => f.k !== "price" && f.k !== "condition")
    : baseFields;
  const id = item.id;

  const openEdit = () => {
    const init = {};
    fields.forEach((f) => {
      let v = item[f.k] ?? "";
      // Read datetime as Pacific wall-clock (DST-aware), same helper as the Starts/Ends screen.
      if (f.type === "datetime-local" && v) v = isoToPTInput(v);
      init[f.k] = v;
    });
    setForm(init);
    setEditOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      // End must be after start (Pacific), same check as the Starts/Ends editor.
      if (entity === "event" && form.starts_at && form.ends_at) {
        const s = ptInputToISO(form.starts_at), e2 = ptInputToISO(form.ends_at);
        if (s && e2 && new Date(e2) <= new Date(s)) {
          toast.error("End time must be after the start time"); setBusy(false); return;
        }
      }
      // Send ONLY changed fields so a no-change save writes nothing and locks nothing.
      const payload = {};
      const changed = (f, outVal) => {
        if (f.type === "datetime-local") {
          const before = item[f.k] || "";
          if (!outVal) return false;
          return !before || new Date(outVal).getTime() !== new Date(before).getTime();
        }
        if (f.type === "number") return Number(outVal) !== (item[f.k] ?? null);
        return String(outVal) !== String(item[f.k] ?? "");
      };
      fields.forEach((f) => {
        let v = form[f.k];
        if (v === undefined || v === null) return;
        if (f.type === "flyer") { if ((v || "") !== (item[f.k] || "")) payload[f.k] = v; return; }
        if (v === "") return;
        if (f.type === "number") { if (changed(f, v)) payload[f.k] = Number(v); return; }
        // Write datetime back as Pacific -> UTC ISO, same helper as the Starts/Ends screen.
        if (f.type === "datetime-local") { const iso = ptInputToISO(v); if (changed(f, iso)) payload[f.k] = iso; return; }
        if (changed(f, v)) payload[f.k] = v;
      });
      if (Object.keys(payload).length === 0) { toast("No changes to save"); setEditOpen(false); setBusy(false); return; }
      if (payload.organizer_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.organizer_email)) {
        toast.error("Enter a valid contact email"); setBusy(false); return;
      }
      if (payload.registration_url && !/^https?:\/\//i.test(payload.registration_url)) {
        toast.error("Registration URL must start with http:// or https://"); setBusy(false); return;
      }
      const path = entity === "event" ? `/admin/events/${id}` : `/admin/content/${entity}/${id}`;
      const { data } = await api.patch(path, payload);
      toast.success(`${LABELS[entity]} updated`);
      setEditOpen(false);
      onChanged?.({ ...item, ...data, ...payload });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save");
    } finally { setBusy(false); }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/admin/content/${entity}/${id}`);
      toast.success(`${LABELS[entity]} deleted`);
      setConfirmOpen(false);
      onChanged?.(null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't delete");
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className={`inline-flex items-center gap-1.5 ${className}`} data-testid={`admin-controls-${entity}-${id}`}>
        {fields.length > 0 && (
          <button onClick={(e) => { e.stopPropagation(); openEdit(); }} data-testid={`admin-edit-${entity}-${id}`} title="Admin edit"
                  className="inline-flex items-center gap-1 rounded-full border border-indigo-200 text-indigo-700 hover:bg-indigo-50 px-2.5 py-1 text-xs font-bold">
            <Icon name="pencil" tone="current" className="h-3.5 w-3.5" />{compact ? "" : "Edit"}
          </button>
        )}
        <button onClick={(e) => { e.stopPropagation(); setConfirmOpen(true); }} data-testid={`admin-delete-${entity}-${id}`} title="Admin delete"
                className="inline-flex items-center gap-1 rounded-full border border-red-200 text-red-600 hover:bg-red-50 px-2.5 py-1 text-xs font-bold">
          <Icon name="trash" tone="current" className="h-3.5 w-3.5" />{compact ? "" : "Delete"}
        </button>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit ${LABELS[entity]}`} eyebrow="Admin" testId={`admin-edit-modal-${entity}`}
             footer={<div className="flex justify-end gap-2"><button onClick={() => setEditOpen(false)} className="px-4 py-2 rounded-full text-sm font-semibold text-slate-500">Cancel</button><button onClick={save} disabled={busy} data-testid="admin-edit-save" className="px-5 py-2 rounded-full text-sm font-semibold bg-[#1F3F5B] text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button></div>}>
        <div className="space-y-3">
          {fields.map((f) => (
            <div key={f.k}>
              <label className="text-xs font-semibold text-slate-500">{f.label}</label>
              {f.type === "select" ? (
                <select value={form[f.k] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [f.k]: e.target.value }))}
                        data-testid={`admin-edit-field-${f.k}`} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white">
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === "flyer" ? (
                <div className="mt-1" data-testid={`admin-edit-field-${f.k}`}>
                  <FlyerUploader value={form[f.k] || ""} onChange={(v) => setForm((s) => ({ ...s, [f.k]: v }))} label="Upload event photo (optional)" />
                </div>
              ) : f.textarea ? (
                <textarea value={form[f.k] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [f.k]: e.target.value }))} rows={4}
                          data-testid={`admin-edit-field-${f.k}`} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              ) : (
                <input type={f.type || "text"} value={form[f.k] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [f.k]: e.target.value }))}
                       data-testid={`admin-edit-field-${f.k}`} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              )}
            </div>
          ))}
        </div>
      </Modal>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm delete" eyebrow="Admin" size="sm" testId={`admin-delete-confirm-${entity}`}
             footer={<div className="flex justify-end gap-2"><button onClick={() => setConfirmOpen(false)} className="px-4 py-2 rounded-full text-sm font-semibold text-slate-500">Cancel</button><button onClick={doDelete} disabled={busy} data-testid="admin-delete-confirm-btn" className="px-5 py-2 rounded-full text-sm font-semibold bg-red-600 text-white disabled:opacity-50">{busy ? "Deleting…" : "Delete permanently"}</button></div>}>
        <p className="text-sm text-slate-600">This will permanently delete this {LABELS[entity]}{(entity === "post" || entity === "discussion") ? " and its comments" : ""}. This can't be undone.</p>
      </Modal>
    </>
  );
}
