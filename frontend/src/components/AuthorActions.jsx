import { useState } from "react";
import { toast } from "sonner";
import Modal from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";

// Author-only Edit/Delete controls for a post or discussion. Visibility is
// driven ONLY by the backend can_edit / can_delete booleans. Delete uses the
// app's in-app confirm Modal (same pattern as DeleteListingButton).
export default function AuthorActions({ canEdit, canDelete, onEdit, deleteUrl, onDeleted, noun = "post", testIdBase }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!canEdit && !canDelete) return null;

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.delete(deleteUrl);
      toast.success("Deleted");
      setOpen(false);
      onDeleted?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {canEdit && (
        <button onClick={(e) => { e.stopPropagation(); onEdit?.(); }} data-testid={`${testIdBase}-edit`}
          className="inline-flex items-center gap-1 h-7 text-[10px] font-bold uppercase tracking-widest px-3 rounded-full border border-[#1F3F5B] text-[#1F3F5B] dark:border-[#8Fb4d6] dark:text-[#8Fb4d6] hover:bg-[#1F3F5B]/5">
          <Icon name="edit" tone="current" className="h-3 w-3" /> Edit
        </button>
      )}
      {canDelete && (
        <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} data-testid={`${testIdBase}-delete`}
          className="inline-flex items-center gap-1 h-7 text-[10px] font-bold uppercase tracking-widest px-3 rounded-full border border-red-200 text-red-600 hover:bg-red-50">
          <Icon name="delete" tone="current" className="h-3 w-3" /> Delete
        </button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={`Delete this ${noun}?`} size="sm" testId={`${testIdBase}-delete-confirm`}
        footer={<div className="flex justify-end gap-2">
          <button onClick={() => setOpen(false)} data-testid={`${testIdBase}-delete-cancel`} className="px-4 py-2 rounded-full text-sm font-semibold text-slate-500">Cancel</button>
          <button onClick={doDelete} disabled={busy} data-testid={`${testIdBase}-delete-confirm-btn`} className="px-5 py-2 rounded-full text-sm font-semibold bg-red-600 text-white disabled:opacity-50">{busy ? "Deleting…" : "Delete"}</button>
        </div>}>
        <p className="text-sm text-slate-600 dark:text-slate-300">This cannot be undone.</p>
      </Modal>
    </>
  );
}
