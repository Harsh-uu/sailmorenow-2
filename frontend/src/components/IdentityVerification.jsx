import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";

export default function IdentityVerification({ user, onVerified }) {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(user.identity_verified ? "verified" : null);
  const [busy, setBusy] = useState(false);

  const refresh = () => api.get("/identity/status").then(({ data }) => { setStatus(data.status); if (data.verified) onVerified?.(); }).catch(() => {});
  useEffect(() => {
    if (params.get("identity") === "return") { refresh(); params.delete("identity"); setParams(params, { replace: true }); }
    else if (!user.identity_verified) refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/identity/session");
      if (data.already_verified) { setStatus("verified"); return; }
      window.location.assign(data.url);
    } catch (e) { if (e?.response?.status !== 402) toast.error(errMsg(e, "Couldn't start verification")); setBusy(false); }
  };

  const verified = status === "verified" || user.identity_verified;
  return (
    <div data-testid="identity-section">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-xl">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Verify your government ID with <b>Stripe Identity</b> to earn the <b>ID Verified</b> badge on your profile, posts and crew signups. Skippers and Boat Pros trust verified members first. Takes about two minutes with your phone camera — Sail More Now never sees or stores your document.
          </p>
        </div>
        {verified ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#55B3AD]/15 text-[#2A7871] dark:text-[#7fcac4] px-4 py-2 text-sm font-bold" data-testid="id-verified-badge"><Icon name="verified" tone="current" className="h-4 w-4" /> ID Verified</span>
        ) : status === "processing" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-4 py-2 text-sm font-semibold" data-testid="id-processing"><Icon name="spinner" tone="current" className="h-4 w-4 animate-spin" /> Processing — check back shortly</span>
        ) : (
          <button onClick={start} disabled={busy} data-testid="start-identity-btn" className="inline-flex items-center gap-1.5 rounded-full bg-[#1F3F5B] hover:bg-[#152a3d] text-white px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {busy ? <Icon name="spinner" tone="current" className="h-4 w-4 animate-spin" /> : <Icon name="external-link" tone="current" className="h-4 w-4" />} {status === "requires_input" ? "Resume verification" : "Verify my identity"}
          </button>
        )}
      </div>
    </div>
  );
}
