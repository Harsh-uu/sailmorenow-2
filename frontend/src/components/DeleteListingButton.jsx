import { useState } from "react";
import { toast } from "sonner";
import Modal from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";

// Delete control for a For-Sale listing (owner). Always shows a confirmation
// step before deleting. `variant="pill"` matches the small owner-card actions;
// `variant="icon"` is a compact trash icon for list rows.
export default function DeleteListingButton({ post, onDeleted, variant = "pill" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/posts/${post.id}`);
      toast.success("Listing deleted");
      setOpen(false);
      onDeleted?.(post.id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {variant === "icon" ? (
        <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} data-testid={`delete-listing-${post.id}`} title="Delete listing"
          className="shrink-0 inline-flex items-center justify-center rounded-full border border-red-200 text-red-600 hover:bg-red-50 h-8 w-8">
          <Icon name="delete" tone="current" className="h-4 w-4" />
        </button>
      ) : (
        <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} data-testid={`delete-listing-${post.id}`}
          className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border border-red-200 text-red-600 hover:bg-red-50">
          Delete
        </button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Delete this post?" size="sm" testId={`delete-listing-confirm-${post.id}`}
        footer={<div className="flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-full text-sm font-semibold text-slate-500">Keep it</button>
          <button onClick={doDelete} disabled={busy} data-testid="delete-listing-confirm-btn" className="px-5 py-2 rounded-full text-sm font-semibold bg-red-600 text-white disabled:opacity-50">{busy ? "Deleting…" : "Delete post"}</button>
        </div>}>
        <p className="text-sm text-slate-600 dark:text-slate-300">This cannot be undone. The listing and its comments will be removed.</p>
      </Modal>
    </>
  );
}
