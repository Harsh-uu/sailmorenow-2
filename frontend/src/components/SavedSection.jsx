import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Icon } from "@/components/Icon";

const TYPE_LABEL = {
  for_sale: "For Sale", volunteer_opportunity: "Volunteer", sailing_opportunity: "Sailing", general: "Post",
  blog: "Blog", forum: "Forum",
};

// "Saved" list on the profile — feed, For Sale, forum and blog items, with remove.
export default function SavedSection() {
  const [items, setItems] = useState(null);
  const load = () => api.get("/saved").then(({ data }) => setItems(data)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const remove = async (id) => {
    setItems((cur) => cur.filter((x) => x.id !== id));
    try { await api.delete(`/saved/${id}`); } catch { toast.error("Couldn't remove"); load(); }
  };
  const linkFor = (it) => it.saved_type === "discussion" ? `/community-hub/${it.id}` : (it.type === "for_sale" ? "/community?tab=marketplace" : "/community");
  const tagFor = (it) => it.saved_type === "discussion" ? (TYPE_LABEL[it.kind] || "Hub") : (TYPE_LABEL[it.type] || "Post");

  return (
    <section className="mt-8 bg-white rounded-2xl p-8 border border-slate-100" data-testid="saved-section">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#55B3AD]">Saved</div>
      <h2 className="font-display font-bold text-xl text-[#1F3F5B] mt-1">Your bookmarks</h2>
      <p className="text-sm text-slate-500 mt-1">Posts, listings, forum topics and blogs you've saved to read later.</p>
      <div className="mt-5 space-y-2">
        {items === null ? (
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-slate-500 text-sm" data-testid="saved-empty">Nothing saved yet. Tap the bookmark on any post, listing, forum topic or blog to keep it here.</div>
        ) : items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-4 py-3" data-testid={`saved-item-${it.id}`}>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-slate-100 text-slate-600 shrink-0">{tagFor(it)}</span>
            <Link to={linkFor(it)} className="flex-1 min-w-0 font-semibold text-[#1F3F5B] truncate hover:underline">{it.title}</Link>
            {it.type === "for_sale" && typeof it.price === "number" && <span className="text-sm font-extrabold text-emerald-700 shrink-0">${it.price.toLocaleString()}</span>}
            <button onClick={() => remove(it.id)} data-testid={`saved-remove-${it.id}`} title="Remove from saved"
              className="shrink-0 rounded-full border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-300 p-2">
              <Icon name="delete" tone="current" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
