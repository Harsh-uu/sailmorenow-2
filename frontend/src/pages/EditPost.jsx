import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";
import MultiPhotoUploader from "@/components/MultiPhotoUploader";

const CONDITIONS = ["New", "Like New", "Good", "Fair", "For parts"];
const FIELD = "mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none";
const LABEL = "text-xs font-bold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400";

// Separate full-page editor for a For-Sale listing (owner). Works at phone,
// tablet and laptop widths. Mark sold/available and Lower price stay separate.
export default function EditPost() {
  const { id } = useParams();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", price: "", condition: "", free: false, image_urls: [], market: "" });

  useEffect(() => {
    api.get("/posts/mine/for-sale")
      .then(({ data }) => {
        const p = (data || []).find((x) => x.id === id);
        if (!p) { setNotFound(true); return; }
        setForm({
          title: p.title || "",
          body: p.body || "",
          price: typeof p.price === "number" ? String(p.price) : "",
          condition: p.condition || "",
          free: p.price === 0,
          image_urls: p.image_urls || (p.image_url ? [p.image_url] : []),
          market: p.market || "",
        });
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const save = async () => {
    if (!form.title.trim()) return toast.error("Add a title");
    if (!form.body.trim()) return toast.error("Add a description");
    setBusy(true);
    try {
      await api.patch(`/posts/${id}`, {
        title: form.title.trim(),
        body: form.body.trim(),
        price: form.free ? 0 : (form.price !== "" ? Number(form.price) : null),
        condition: form.condition || null,
        image_urls: form.image_urls,
      });
      toast.success("Listing updated");
      nav("/community?tab=marketplace");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 text-slate-500 dark:text-slate-400" data-testid="edit-post-loading">Loading…</div>;
  }
  if (notFound) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center" data-testid="edit-post-notfound">
        <p className="font-display font-bold text-xl text-[#1F3F5B] dark:text-slate-100">We couldn't find that listing.</p>
        <button onClick={() => nav("/community?tab=marketplace")} className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#1F3F5B] dark:bg-[#F2A03B] text-white px-5 py-2.5 font-semibold">Back to Marketplace</button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10" data-testid="edit-post-page">
      <button onClick={() => nav(-1)} data-testid="edit-post-back" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-[#1F3F5B] dark:hover:text-slate-200">
        <Icon name="chevron-left" tone="current" className="h-4 w-4" /> Back
      </button>
      <h1 className="mt-3 font-display font-extrabold text-2xl sm:text-3xl text-[#1F3F5B] dark:text-slate-100">Edit listing</h1>
      {form.market ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Marketplace · {form.market}</p> : null}

      <div className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 sm:p-6 space-y-5">
        <div>
          <label className={LABEL}>Title</label>
          <input value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} data-testid="edit-title" className={FIELD} placeholder="What are you selling?" />
        </div>
        <div>
          <label className={LABEL}>Description</label>
          <textarea value={form.body} onChange={(e) => setForm((s) => ({ ...s, body: e.target.value }))} rows={5} data-testid="edit-body" className={FIELD} placeholder="Share the details..." />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Price (USD)</label>
            <input type="number" min="0" step="1" value={form.free ? "" : form.price} disabled={form.free} onChange={(e) => setForm((s) => ({ ...s, price: e.target.value }))} data-testid="edit-price" className={FIELD} placeholder={form.free ? "Free" : "e.g. 1200"} />
            <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={!!form.free} onChange={(e) => setForm((s) => ({ ...s, free: e.target.checked, price: e.target.checked ? "0" : "" }))} data-testid="edit-free" className="h-4 w-4 rounded border-slate-300 text-[#1F3F5B]" />
              List this as Free
            </label>
          </div>
          <div>
            <label className={LABEL}>Condition</label>
            <select value={form.condition} onChange={(e) => setForm((s) => ({ ...s, condition: e.target.value }))} data-testid="edit-condition" className={FIELD}>
              <option value="">Not set</option>
              {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={LABEL}>Photos (up to 6)</label>
          <div className="mt-2">
            <MultiPhotoUploader value={form.image_urls} onChange={(urls) => setForm((s) => ({ ...s, image_urls: urls }))} max={6} />
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
        <button onClick={() => nav(-1)} data-testid="edit-post-cancel" className="rounded-full border border-slate-200 dark:border-slate-700 px-6 py-2.5 font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50">Cancel</button>
        <button onClick={save} disabled={busy} data-testid="edit-post-save" className="rounded-full bg-[#1F3F5B] dark:bg-[#F2A03B] text-white px-7 py-2.5 font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  );
}
