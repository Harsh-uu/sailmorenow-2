import { useState } from "react";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import Modal from "@/components/Modal";

const REASONS = [
  { key: "inappropriate", label: "Against the Code of Conduct" },
  { key: "inaccurate", label: "Some information is inaccurate" },
  { key: "other", label: "Other" },
];

/**
 * Small "Report" button + modal. `targetType` is 'discussion' | 'comment' | 'post' | 'event'.
 * The author of the target can't see their own flag button - pass `hidden` to hide.
 */
export default function FlagButton({ targetType, targetId, hidden = false, size = "sm", label = "Report" }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0].key);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  if (hidden || !user) return null;

  const submit = async () => {
    const reasonLabel = REASONS.find((r) => r.key === reason)?.label || reason;
    const composed = detail.trim() ? `${reasonLabel} - ${detail.trim()}` : reasonLabel;
    setBusy(true);
    try {
      const { data } = await api.post("/reports", {
        target_type: targetType, target_id: targetId, reason: composed, category: reason,
      });
      toast.success(data?.duplicate
        ? "Already reported - thank you."
        : data?.hidden
          ? "Reported. This content is hidden pending moderator review."
          : "Report sent to moderators.");
      setOpen(false); setDetail("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to send report");
    } finally { setBusy(false); }
  };

  const sizeCls = size === "xs" ? "text-[10px] px-2 py-1" : "text-xs px-3 py-1.5";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
              data-testid={`flag-${targetType}-${targetId}`}
              className={`inline-flex items-center gap-1 rounded-full border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 font-semibold ${sizeCls}`}>
        <Icon name="flag" tone="current" className="h-3 w-3" /> {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Report to moderators" testId="flag-modal">
        <div className="p-5 space-y-4 text-sm">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 block">Why are you reporting this?</label>
            <div className="space-y-2">
              {REASONS.map((r) => {
                const active = reason === r.key;
                return (
                  <button key={r.key} type="button" onClick={() => setReason(r.key)}
                          data-testid={`flag-reason-${r.key}`}
                          className={`w-full flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${active ? "border-[#55B3AD] bg-teal-50" : "border-slate-200 hover:border-slate-300"}`}>
                    <Icon name={active ? "success" : "circle"} tone="current" className={`h-5 w-5 shrink-0 ${active ? "text-[#55B3AD]" : "text-slate-400"}`} />
                    <span className={`font-semibold ${active ? "text-[#1F3F5B]" : "text-slate-700"}`}>{r.label}</span>
                  </button>
                );
              })}
            </div>
            {reason === "inappropriate" && (
              <p className="text-[12px] text-amber-600 mt-2 flex items-start gap-1.5" data-testid="flag-hide-note">
                <Icon name="warning" tone="current" className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                This will hide the content from public view until a moderator reviews it.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5 block">Details (optional)</label>
            <textarea data-testid="flag-details" rows={3} value={detail} onChange={(e) => setDetail(e.target.value)}
                      placeholder="Anything the moderator should know?"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:border-[#55B3AD] outline-none resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setOpen(false)} className="text-slate-600 px-4 py-2 rounded-full font-semibold hover:bg-slate-100">Cancel</button>
            <button onClick={submit} disabled={busy} data-testid="flag-submit"
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-full px-5 py-2 font-semibold">
              {busy ? "Sending…" : "Send report"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
