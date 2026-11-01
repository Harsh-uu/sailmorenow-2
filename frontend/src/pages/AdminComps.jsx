import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";

const TIERS = [
  { v: "basic", label: "Basic (Boat Pro)" },
  { v: "featured", label: "Featured (Boat Pro)" },
  { v: "premium", label: "Premium" },
  { v: "community_partner", label: "Community Partner (org)" },
  { v: "founding_partner", label: "Founding Partner (org)" },
];
const fmt = (iso) => {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return "-"; }
};

export default function AdminComps() {
  const [rows, setRows] = useState([]);
  const [statusFilter, setStatusFilter] = useState("active");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState("premium");
  const [reason, setReason] = useState("");
  const [endAt, setEndAt] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(null);

  const load = () => {
    setLoading(true);
    api.get(`/admin/comps?status=${statusFilter}`)
      .then(({ data }) => setRows(data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, [statusFilter]);

  const grant = async () => {
    if (!email.trim() || !reason.trim()) { toast.error("Member email and a reason are required."); return; }
    setBusy(true);
    try {
      await api.post("/admin/comps", {
        email: email.trim(), tier, reason: reason.trim(),
        end_at: endAt ? new Date(endAt + "T12:00:00Z").toISOString() : null,
      });
      toast.success("Complimentary access granted.");
      setEmail(""); setReason(""); setEndAt("");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not grant access."); }
    finally { setBusy(false); }
  };

  const revoke = async (g) => {
    setConfirmRevoke(null); setBusy(true);
    try {
      await api.post(`/admin/comps/${g.id}/revoke`);
      toast.success("Comp revoked. Member moved to free.");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not revoke."); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8" data-testid="admin-comps-page">
      <h1 className="text-2xl font-extrabold smn-heading flex items-center gap-2">
        <Icon name="award" tone="current" className="h-6 w-6 text-[#55B3AD]" /> Complimentary access
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Grant a free tier to a member with no card. Open-ended or until an end date. Never bills.</p>

      {/* Grant form */}
      <div className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5" data-testid="comp-grant-form">
        <div className="grid sm:grid-cols-2 gap-3">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Member email" data-testid="comp-email"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm smn-heading" />
          <select value={tier} onChange={(e) => setTier(e.target.value)} data-testid="comp-tier"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm smn-heading">
            {TIERS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" data-testid="comp-reason"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm smn-heading" />
          <div className="flex items-center gap-2">
            <input type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} data-testid="comp-end"
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm smn-heading" />
            <span className="text-xs text-slate-400">optional end date</span>
          </div>
        </div>
        <button onClick={grant} disabled={busy} data-testid="comp-grant-btn"
          className="mt-3 inline-flex items-center gap-2 bg-[#1F3F5B] dark:bg-[#F2A03B] text-white rounded-full px-5 py-2.5 font-semibold text-sm disabled:opacity-50">
          <Icon name="award" tone="current" className="h-4 w-4" /> Grant complimentary access
        </button>
      </div>

      {/* Filter */}
      <div className="mt-6 flex gap-2" data-testid="comp-filter">
        {["active", "revoked", "expired", "all"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} data-testid={`comp-filter-${s}`}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${statusFilter === s ? "bg-[#1F3F5B] dark:bg-[#F2A03B] text-white border-transparent" : "border-slate-200 dark:border-slate-700 smn-heading"}`}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden" data-testid="comp-list">
        {loading ? (
          <div className="p-6 text-slate-500" data-testid="comp-loading">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-slate-500" data-testid="comp-empty">No {statusFilter} comps.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Member</th><th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Reason</th><th className="px-3 py-2">By</th>
                <th className="px-3 py-2">Start</th><th className="px-3 py-2">End</th>
                <th className="px-3 py-2">Status</th><th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} className="border-t border-slate-100 dark:border-slate-700" data-testid={`comp-row-${g.id}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold smn-heading">{g.member_name || "-"}</div>
                    <div className="text-xs text-slate-400">{g.member_email}</div>
                  </td>
                  <td className="px-3 py-2 capitalize">{g.tier.replace("_", " ")}</td>
                  <td className="px-3 py-2 max-w-[220px] truncate" title={g.reason}>{g.reason}</td>
                  <td className="px-3 py-2 text-xs">{g.granted_by_name}</td>
                  <td className="px-3 py-2 text-xs">{fmt(g.start_at)}</td>
                  <td className="px-3 py-2 text-xs">{g.end_at ? fmt(g.end_at) : "open-ended"}</td>
                  <td className="px-3 py-2"><span className="text-xs font-semibold capitalize">{g.status}</span></td>
                  <td className="px-3 py-2 text-right">
                    {g.status === "active" && (
                      <button onClick={() => setConfirmRevoke(g)} data-testid={`comp-revoke-${g.id}`}
                        className="text-xs font-semibold text-red-600 underline">Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmRevoke && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="comp-revoke-modal">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full">
            <p className="smn-heading font-semibold">Revoke {confirmRevoke.tier.replace("_", " ")} access for {confirmRevoke.member_email}? They move to the free plan now.</p>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setConfirmRevoke(null)} className="px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 text-sm font-semibold">Keep</button>
              <button onClick={() => revoke(confirmRevoke)} disabled={busy} data-testid="comp-revoke-confirm" className="px-4 py-2 rounded-full bg-red-600 text-white text-sm font-semibold disabled:opacity-50">Revoke</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
