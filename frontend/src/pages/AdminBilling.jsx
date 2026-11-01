import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export default function AdminBilling() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState(30);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    api.get("/admin/billing/trial").then(({ data }) => {
      setEnabled(!!data.trial_enabled);
      setDays(Number(data.trial_days) || 30);
    }).catch(() => toast.error("Couldn't load trial settings")).finally(() => setLoaded(true));
  }, [user, loading, nav]);

  const save = async (nextEnabled, nextDays) => {
    setSaving(true);
    try {
      const { data } = await api.post("/admin/billing/trial", {
        trial_enabled: nextEnabled, trial_days: nextDays,
      });
      setEnabled(!!data.trial_enabled);
      setDays(Number(data.trial_days) || 30);
      toast.success("Trial settings saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save");
    } finally { setSaving(false); }
  };

  if (loading) return null;
  if (!user || user.platform_role !== "admin") {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center" data-testid="admin-billing-denied">
        <Icon name="shield-alert" tone="current" className="h-12 w-12 text-orange-500 mx-auto" />
        <h1 className="mt-4 text-2xl font-display font-bold text-[#1F3F5B]">Admin access required.</h1>
      </div>
    );
  }

  const toggle = () => save(!enabled, days);

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10" data-testid="admin-billing-page">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#F2A03B] flex items-center gap-2">
        <Icon name="shield-alert" tone="current" className="h-3.5 w-3.5" /> Admin
      </div>
      <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl mt-2 tracking-tight">Trials & billing</h1>
      <p className="text-slate-500 mt-2 text-sm">Turn the free trial on or off for new sign-ups, and set how many days it lasts. People already in a trial keep it.</p>

      <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm" data-testid="admin-trial-card">
        {!loaded ? (
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-display font-bold text-[#1F3F5B] text-base">Free trial</div>
                <div className="text-sm text-slate-500 mt-0.5" data-testid="admin-trial-state">
                  Currently <span className={`font-bold ${enabled ? "text-[#2A7871]" : "text-slate-500"}`}>{enabled ? "ON" : "OFF"}</span>
                  {enabled ? ` · ${days} days` : ""}
                </div>
              </div>
              <button
                onClick={toggle}
                disabled={saving}
                data-testid="admin-trial-toggle"
                aria-pressed={enabled}
                className={`relative inline-flex h-8 w-14 shrink-0 rounded-full transition-colors ${enabled ? "bg-[#55B3AD]" : "bg-slate-300"} ${saving ? "opacity-60" : ""}`}
              >
                <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-7" : "translate-x-1"}`} />
              </button>
            </div>

            <div className="mt-6">
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Trial length (days)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={365} value={days}
                  onChange={(e) => setDays(e.target.value)}
                  data-testid="admin-trial-days"
                  className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-[#55B3AD] outline-none"
                />
                <button
                  onClick={() => save(enabled, Math.max(1, Math.min(365, Number(days) || 30)))}
                  disabled={saving}
                  data-testid="admin-trial-save-days"
                  className="inline-flex items-center gap-1.5 bg-[#F2A03B] hover:bg-[#d98c30] disabled:opacity-50 text-white rounded-full px-5 py-2.5 text-sm font-semibold"
                >
                  <Icon name="check" tone="current" className="h-4 w-4" /> {saving ? "Saving…" : "Save days"}
                </button>
              </div>
            </div>

            <p className="mt-6 text-xs text-slate-400" data-testid="admin-trial-note">
              When off, no trial wording appears anywhere and plans show normal pricing. Changes are logged.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
