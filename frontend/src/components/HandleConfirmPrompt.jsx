import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Icon } from "@/components/Icon";
import { toast } from "sonner";

/**
 * Step 8a, item 8. Shown once per sign-in to Boat Pros whose personal handle was
 * auto-suggested during the identity split (personal_handle_pending). "Keep"
 * accepts the suggestion; "Save" stores an edited handle. Either clears the
 * flag. Dismissing leaves the flag set so the prompt returns next sign-in.
 */
const HANDLE_RE = /^[A-Za-z0-9_]{3,20}$/;

export default function HandleConfirmPrompt() {
  const { user, refresh } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [value, setValue] = useState(user?.handle || "");
  const [busy, setBusy] = useState(false);

  if (!user || !user.personal_handle_pending || dismissed) return null;

  const current = user.handle || "";
  const changed = value.trim().toLowerCase() !== current.toLowerCase();
  const valid = HANDLE_RE.test(value.trim());

  const submit = async (handle) => {
    setBusy(true);
    try {
      await api.put("/account/personal", { handle });
      toast.success("Personal username confirmed");
      setDismissed(true);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save username");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="handle-confirm-prompt"
         className="fixed bottom-4 right-4 z-[70] w-[min(92vw,22rem)] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display font-bold text-[#1F3F5B] dark:text-slate-100 text-base">Confirm your personal username</h3>
        <button onClick={() => setDismissed(true)} data-testid="handle-confirm-dismiss" aria-label="Dismiss"
                className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          <Icon name="close" tone="current" className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        We suggested @{current} for your personal profile. Keep it or choose another.
      </p>
      <div className="mt-3 flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2">
        <span className="text-slate-400">@</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} data-testid="handle-confirm-input"
               className="flex-1 bg-transparent text-sm outline-none text-[#1F3F5B] dark:text-slate-100" maxLength={20} />
      </div>
      {value.trim() && !valid && (
        <p className="mt-1 text-xs text-red-500" data-testid="handle-confirm-error">3-20 letters, numbers or _</p>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button onClick={() => submit(current)} disabled={busy} data-testid="handle-confirm-keep"
                className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50">
          Keep
        </button>
        <button onClick={() => submit(value.trim())} disabled={busy || !changed || !valid} data-testid="handle-confirm-save"
                className="rounded-full px-5 py-2 text-sm font-semibold bg-[#1F3F5B] dark:bg-[#F2A03B] text-white hover:opacity-90 disabled:opacity-50">
          Save
        </button>
      </div>
    </div>
  );
}
