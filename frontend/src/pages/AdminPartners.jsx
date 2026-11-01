import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import Avatar from "@/components/Avatar";
import Modal from "@/components/Modal";
import { toast } from "sonner";

const STATUS_LABEL = { free: "Free", community_partner: "Community Partner", founding_partner: "Founding Partner" };
const STATUS_OPTS = [
  { value: "free", label: "Free" },
  { value: "community_partner", label: "Community Partner" },
  { value: "founding_partner", label: "Founding Partner" },
];
const FOUNDING_CAP = 5;

function StatusChip({ status }) {
  if (status === "founding_partner")
    return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold bg-[#F2A03B]/15 text-[#9a5a12] dark:bg-[#F2A03B]/25 dark:text-[#F2A03B]"><Icon name="flag" tone="current" className="h-3 w-3" /> Founding Partner</span>;
  if (status === "community_partner")
    return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold bg-[#55B3AD]/15 text-[#2A7871] dark:bg-[#55B3AD]/25 dark:text-[#7fcac4]"><Icon name="flag" tone="current" className="h-3 w-3" /> Community Partner</span>;
  return <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">Free</span>;
}

// Three-way, full-width status control (responsive: 3 columns at every width).
function StatusControl({ value, onChange, disabled, testId }) {
  return (
    <div role="radiogroup" aria-label="Org status" data-testid={testId}
         className="grid grid-cols-3 w-full sm:w-auto rounded-xl border border-[var(--smn-border)] bg-[var(--smn-surface)] p-0.5 gap-0.5">
      {STATUS_OPTS.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} aria-label={o.label}
                  disabled={disabled} onClick={() => onChange(o.value)} data-testid={`${testId}-${o.value}`}
                  className={`inline-flex items-center justify-center text-center rounded-lg px-2 min-h-[40px] text-[11px] sm:text-xs font-semibold leading-tight transition-colors disabled:opacity-50 ${
                    active ? "bg-[var(--smn-navy)] text-white" : "text-[var(--smn-text-secondary)] hover:text-[var(--smn-text)]"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AdminPartners() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [orgs, setOrgs] = useState(null);
  const [counts, setCounts] = useState({});
  const [markets, setMarkets] = useState(["Portland/Vancouver", "Greater Seattle"]);
  const [busyId, setBusyId] = useState(null);
  const [pending, setPending] = useState(null); // { org, status, kind:"free"|"cap", marketLabel }

  const search = useCallback((query) => {
    api.get("/admin/partners/search", { params: { q: query } })
      .then(({ data }) => {
        setOrgs(data.orgs || []);
        setCounts(data.founding_counts || {});
        if (Array.isArray(data.founding_markets)) setMarkets(data.founding_markets);
      })
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load"));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    if (user.platform_role !== "admin") { setErr("Admin access required."); return; }
    search("");
  }, [user, loading, nav, search]);

  useEffect(() => {
    if (!user || user.platform_role !== "admin") return;
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q, user, search]);

  const apply = async (org, status) => {
    setBusyId(org.user_id);
    try {
      const { data } = await api.post("/admin/org-status", { user_id: org.user_id, status });
      setOrgs((list) => (list || []).map((o) => (o.user_id === org.user_id
        ? { ...o, status, partner_badge: status === "founding_partner" ? "founding" : status === "community_partner" ? "partner" : null, is_community_partner: status !== "free" }
        : o)));
      if (data?.founding_counts) setCounts(data.founding_counts);
      toast.success(`${org.name} is now ${STATUS_LABEL[status]}`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't update"); }
    finally { setBusyId(null); }
  };

  // Decide whether a status change needs a confirmation or cap warning first.
  const requestChange = (org, status) => {
    if (status === org.status) return;
    if (status === "free" && org.status !== "free") {
      setPending({ org, status, kind: "free" });
      return;
    }
    if (status === "founding_partner" && org.status !== "founding_partner") {
      const bucket = markets.includes(org.primary_market) ? org.primary_market : "other";
      const current = counts[bucket] || 0;
      if (current >= FOUNDING_CAP) {
        const marketLabel = bucket === "other" ? "an unlisted market" : bucket;
        setPending({ org, status, kind: "cap", marketLabel, current });
        return;
      }
    }
    apply(org, status);
  };

  const confirmPending = () => {
    if (!pending) return;
    const { org, status } = pending;
    setPending(null);
    apply(org, status);
  };

  if (err) return <div className="max-w-3xl mx-auto p-10 text-red-500" data-testid="admin-partners-error">{err}</div>;

  const marketCountLine = [...markets.map((m) => `${m}: ${counts[m] || 0} of ${FOUNDING_CAP}`), `Other: ${counts.other || 0}`].join(" · ");

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="admin-partners-page">
      <div className="flex items-center gap-3 mb-4">
        <Icon name="flag" tone="current" className="h-6 w-6 text-[#F2A03B]" />
        <div>
          <h1 className="font-display font-extrabold text-[#1F3F5B] dark:text-white text-3xl sm:text-4xl tracking-tight">Community Partners</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Set each Club/Org account to Free, Community Partner or Founding Partner. Payments happen off app.</p>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-[#1F3F5B]/[0.03] dark:bg-slate-900 p-4" data-testid="admin-founding-counts">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#55B3AD] mb-1">Founding Partners per market (limit {FOUNDING_CAP})</div>
        <div className="text-sm font-semibold text-[#1F3F5B] dark:text-slate-100">{marketCountLine}</div>
      </div>

      <div className="relative mb-6">
        <Icon name="search" tone="current" className="h-4 w-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} data-testid="admin-partners-search"
          placeholder="Search orgs by name, username or email…"
          className="w-full rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-11 pr-4 py-2.5 text-sm outline-none focus:border-[#55B3AD]" />
      </div>

      {!orgs ? (
        <div className="text-slate-500">Loading…</div>
      ) : orgs.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center text-slate-500" data-testid="admin-partners-empty">No org accounts found.</div>
      ) : (
        <div className="space-y-3">
          {orgs.map((o) => (
            <div key={o.user_id} data-testid={`admin-partner-row-${o.user_id}`}
              className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <Avatar src={o.logo} alt={o.name} className="h-12 w-12 bg-white shrink-0" fallback={<Icon name="org" tone="brand" />} />
                <div className="min-w-0 flex-1">
                  <div className="font-display font-bold smn-heading truncate">{o.name}</div>
                  <div className="text-xs text-slate-500 truncate">@{o.handle} · {o.email || "no email"}{o.primary_market ? ` · ${o.primary_market}` : ""}</div>
                  <div className="mt-1"><StatusChip status={o.status} /></div>
                </div>
              </div>
              <StatusControl value={o.status} disabled={busyId === o.user_id}
                onChange={(s) => requestChange(o, s)} testId={`admin-partner-status-${o.user_id}`} />
            </div>
          ))}
        </div>
      )}

      <Modal open={!!pending} onClose={() => setPending(null)}
             title={pending?.kind === "cap" ? "Founding Partner limit reached" : "Switch to Free?"}
             testId="admin-status-confirm" size="sm">
        {pending && (
          <div className="p-5">
            <p className="text-slate-700 dark:text-slate-200 text-sm leading-relaxed">
              {pending.kind === "cap"
                ? `This would be Founding Partner number ${(pending.current || 0) + 1} in ${pending.marketLabel} (limit ${FOUNDING_CAP}). Continue?`
                : "Switch to Free? Gallery photos will be hidden, not deleted."}
            </p>
            <div className="mt-5 flex flex-col sm:flex-row-reverse gap-2">
              <button data-testid="admin-status-confirm-ok" onClick={confirmPending}
                      className={`inline-flex items-center justify-center rounded-full px-5 min-h-[44px] font-semibold text-sm text-white ${pending.kind === "cap" ? "bg-[#F2A03B] hover:bg-[#d98c30]" : "bg-[#1F3F5B] hover:bg-[#152a3d]"}`}>
                {pending.kind === "cap" ? "Continue" : "Switch to Free"}
              </button>
              <button data-testid="admin-status-confirm-cancel" onClick={() => setPending(null)}
                      className="inline-flex items-center justify-center text-slate-600 dark:text-slate-300 rounded-full px-5 min-h-[44px] font-semibold text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
