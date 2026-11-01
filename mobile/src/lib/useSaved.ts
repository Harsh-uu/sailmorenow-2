import { useCallback, useEffect, useState } from "react";
import { api } from "@/src/lib/api";

// Loads the current user's saved target ids and exposes isSaved + toggle.
export function useSaved() {
  const [ids, setIds] = useState<string[]>([]);
  const refresh = useCallback(() => {
    api.get<{ ids: string[] }>("/saved/ids").then((d) => setIds(d.ids || [])).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const isSaved = useCallback((id: string) => ids.includes(id), [ids]);
  const toggle = useCallback(async (targetType: "post" | "discussion", targetId: string) => {
    const saved = ids.includes(targetId);
    setIds((cur) => saved ? cur.filter((x) => x !== targetId) : [...cur, targetId]);
    try {
      if (saved) await api.del(`/saved/${targetId}`);
      else await api.post("/saved", { target_type: targetType, target_id: targetId });
    } catch {
      setIds((cur) => saved ? [...cur, targetId] : cur.filter((x) => x !== targetId));
    }
  }, [ids]);
  return { isSaved, toggle, refresh };
}
