import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

// Web up/down reactions with visible counts (parity with mobile Reactions).
// Works for target_type post | discussion | comment.
export default function Reactions({ targetType, targetId, className = "" }) {
  const { user } = useAuth();
  const [state, setState] = useState({ up: 0, down: 0, mine: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/reactions/${targetType}/${targetId}`)
      .then(({ data }) => alive && setState(data))
      .catch(() => {});
    return () => { alive = false; };
  }, [targetType, targetId]);

  const react = async (value) => {
    if (!user) return toast.error("Sign in to react");
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/reactions", { target_type: targetType, target_id: targetId, value });
      setState(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally {
      setBusy(false);
    }
  };

  // Active pill colors use non-flipped Tailwind shades so they read identically
  // in light and dark mode; inactive uses the surface + border tokens.
  const base = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50";
  const idle = "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300";

  return (
    <div className={`flex items-center gap-2 ${className}`} data-testid={`reactions-${targetId}`}>
      <button
        type="button"
        onClick={() => react(1)}
        disabled={busy}
        data-testid={`react-up-${targetId}`}
        title="Helpful / like"
        className={`${base} ${state.mine === 1 ? "bg-teal-100 border-teal-300 text-teal-900" : `${idle} hover:border-[#55B3AD]`}`}
      >
        <Icon name="thumbs-up" tone="current" className="h-4 w-4" /> {state.up}
      </button>
      <button
        type="button"
        onClick={() => react(-1)}
        disabled={busy}
        data-testid={`react-down-${targetId}`}
        title="Not helpful / dislike"
        className={`${base} ${state.mine === -1 ? "bg-orange-100 border-orange-300 text-orange-900" : `${idle} hover:border-[#F2A03B]`}`}
      >
        <Icon name="thumbs-down" tone="current" className="h-4 w-4" /> {state.down}
      </button>
    </div>
  );
}
