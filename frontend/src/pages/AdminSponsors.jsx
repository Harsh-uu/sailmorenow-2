import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

const EMPTY = { name: "", image_url: "", link_url: "", active: true };

export default function AdminSponsors() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const reload = () => api.get("/admin/sponsors").then(({ data }) => setItems(data)).catch((e) => setErr(e?.response?.data?.detail || "Failed to load"));
  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    if (user.platform_role !== "admin") { setErr("Admin access required."); return; }
    reload();
  }, [user, loading, nav]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const resetForm = () => { setForm(EMPTY); setEditId(null); };

  const save = async () => {
    if (!form.image_url.trim() || !form.link_url.trim()) { toast.error("Image URL and link URL are required."); return; }
    setBusy(true);
    try {
      if (editId) await api.patch(`/admin/sponsors/${editId}`, form);
      else await api.post("/admin/sponsors", form);
      toast.success(editId ? "Sponsor updated" : "Sponsor added");
      resetForm();
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't save"); }
    finally { setBusy(false); }
  };

  const edit = (s) => { setForm({ name: s.name || "", image_url: s.image_url, link_url: s.link_url, active: s.active }); setEditId(s.id); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const toggleActive = async (s) => { try { await api.patch(`/admin/sponsors/${s.id}`, { active: !s.active }); reload(); } catch { toast.error("Couldn't update"); } };
  const remove = async (s) => { if (!window.confirm("Remove this sponsor?")) return; try { await api.delete(`/admin/sponsors/${s.id}`); reload(); } catch { toast.error("Couldn't remove"); } };

  if (err) return <div className="max-w-3xl mx-auto p-10 text-red-500" data-testid="admin-sponsors-error">{err}</div>;
  if (!items) return <div className="max-w-3xl mx-auto p-10 text-slate-500">Loading…</div>;

  const inputCls = "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 focus:border-[#55B3AD] outline-none text-sm";

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="admin-sponsors-page">
      <div className="flex items-center gap-3 mb-6">
        <Icon name="award" tone="current" className="h-6 w-6 text-[#55B3AD]" />
        <div>
          <h1 className="font-display font-extrabold text-[#1F3F5B] dark:text-white text-3xl sm:text-4xl tracking-tight">Community Sponsors</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Banners rotate below the Events calendar. Active sponsors only.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-5 mb-8">
        <div className="font-display font-bold smn-heading mb-3">{editId ? "Edit sponsor" : "Add a sponsor"}</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <input value={form.name} onChange={set("name")} placeholder="Sponsor name (optional)" data-testid="sponsor-name-input" className={inputCls} />
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={!!form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} data-testid="sponsor-active-input" /> Active
          </label>
          <input value={form.image_url} onChange={set("image_url")} placeholder="Banner image URL (or upload →)" data-testid="sponsor-image-input" className={inputCls} />
          <label data-testid="sponsor-upload-label" className="inline-flex items-center gap-2 text-sm font-semibold rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-2 cursor-pointer hover:border-[#55B3AD] text-[#1F3F5B] dark:text-slate-100">
            <Icon name="upload" tone="current" className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload image"}
            <input type="file" accept="image/*" className="hidden" data-testid="sponsor-upload-input" disabled={uploading}
              onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                setUploading(true);
                try {
                  const fd = new FormData(); fd.append("file", f);
                  const { data } = await api.post("/admin/sponsors/upload-image", fd, { headers: { "Content-Type": "multipart/form-data" } });
                  setForm((s) => ({ ...s, image_url: data.image_url }));
                  toast.success("Image uploaded");
                } catch (er) { toast.error(er?.response?.data?.detail || "Upload failed"); }
                finally { setUploading(false); e.target.value = ""; }
              }} />
          </label>
          <input value={form.link_url} onChange={set("link_url")} placeholder="Link URL (https://…)" data-testid="sponsor-link-input" className={inputCls} />
        </div>
        {form.image_url ? <img src={form.image_url} alt="" className="mt-3 max-h-28 rounded-lg border border-slate-200 dark:border-slate-700" /> : null}
        <div className="mt-4 flex gap-2">
          <button onClick={save} disabled={busy} data-testid="sponsor-save-btn" className="inline-flex items-center gap-1 bg-[#1F3F5B] hover:bg-[#152a3d] disabled:opacity-40 text-white rounded-full px-5 py-2 text-sm font-semibold">
            <Icon name={editId ? "check" : "add"} tone="current" className="h-4 w-4" /> {busy ? "Saving…" : editId ? "Save changes" : "Add sponsor"}
          </button>
          {editId ? <button onClick={resetForm} className="text-sm text-slate-500 px-4 py-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button> : null}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center text-slate-500 dark:text-slate-400 py-10" data-testid="admin-sponsors-empty">No sponsors yet. Visitors will see a "Become a Sponsor" card on the Events page.</div>
      ) : (
        <div className="space-y-3">
          {items.map((s) => (
            <div key={s.id} data-testid={`admin-sponsor-${s.id}`} className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
              <img src={s.image_url} alt="" className="h-14 w-28 object-cover rounded-lg bg-slate-100 dark:bg-slate-900 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold smn-heading truncate">{s.name || "(untitled sponsor)"}</div>
                <a href={s.link_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#2A7871] dark:text-[#7fcac4] truncate block hover:underline">{s.link_url}</a>
              </div>
              <button onClick={() => toggleActive(s)} data-testid={`sponsor-toggle-${s.id}`} className={`text-xs font-semibold rounded-full px-3 py-1 ${s.active ? "bg-[#55B3AD]/15 text-[#2A7871]" : "bg-slate-100 dark:bg-slate-700 text-slate-500"}`}>{s.active ? "Active" : "Hidden"}</button>
              <button onClick={() => edit(s)} data-testid={`sponsor-edit-${s.id}`} className="text-slate-500 hover:text-[#1F3F5B] dark:hover:text-white"><Icon name="edit" tone="current" className="h-4 w-4" /></button>
              <button onClick={() => remove(s)} data-testid={`sponsor-delete-${s.id}`} className="text-slate-400 hover:text-red-600"><Icon name="trash" tone="current" className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
