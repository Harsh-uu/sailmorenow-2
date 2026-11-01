import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/context/AuthContext";

// Loads the current user's saved target ids and exposes toggle + isSaved.
export function useSaved() {
  const { user } = useAuth();
  const [ids, setIds] = useState([]);
  const refresh = useCallback(() => {
    if (!user) { setIds([]); return; }
    api.get("/saved/ids").then(({ data }) => setIds(data.ids || [])).catch(() => {});
  }, [user]);
  useEffect(() => { refresh(); }, [refresh]);
  const isSaved = useCallback((id) => ids.includes(id), [ids]);
  const toggle = useCallback(async (targetType, targetId) => {
    if (!user) return toast.error("Sign in to save");
    const saved = ids.includes(targetId);
    setIds((cur) => saved ? cur.filter((x) => x !== targetId) : [...cur, targetId]);
    try {
      if (saved) await api.delete(`/saved/${targetId}`);
      else await api.post("/saved", { target_type: targetType, target_id: targetId });
    } catch {
      setIds((cur) => saved ? [...cur, targetId] : cur.filter((x) => x !== targetId));
      toast.error("Couldn't update saved");
    }
  }, [ids, user]);
  return { isSaved, toggle, refresh };
}

// Bookmark toggle button.
export default function SaveButton({ targetType, targetId, saved, onToggle, size = "sm" }) {
  const cls = size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(targetType, targetId); }}
      data-testid={`save-${targetId}`}
      aria-label={saved ? "Remove from saved" : "Save"}
      title={saved ? "Saved — click to remove" : "Save"}
      className={`inline-flex items-center justify-center rounded-full border p-2 transition ${saved ? "border-[#F2A03B] text-[#F2A03B] bg-[#F2A03B]/10" : "border-slate-200 dark:border-slate-600 text-slate-400 hover:text-[#F2A03B] hover:border-[#F2A03B]"}`}
    >
      <Icon name={saved ? "bookmark-filled" : "bookmark"} tone="current" className={cls} />
    </button>
  );
}
