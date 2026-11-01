import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

// Plain-language guidance for each delivery issue. No message bodies are ever
// shown or stored; we only reason off the recorded failure reason + route.
function hintFor(it) {
  const r = (it.reason || "").toLowerCase();
  if (r.includes("restricted") || r.includes("invalid") || r.includes("401") || r.includes("no proxy key") || r.includes("no_key"))
    return "The email sending key may be missing, invalid or restricted. Check the email keys in settings.";
  if (r.includes("429") || r.includes("rate") || r.includes("exhausted") || r.includes("quota"))
    return "Hit a temporary rate limit or daily quota. It was retried automatically; if the person didn't get it, ask them to try again from the app.";
  if (r.includes("422") || r.includes("http_4"))
    return "The recipient address may be wrong or was rejected. Double-check the address.";
  if (it.route === "fallback")
    return "This was sent via the backup route instead of Resend, so it still delivered. If it keeps happening, check the reason.";
  return "Check the recipient address, or ask the person to retry the action from the app.";
}

const ROUTE_BADGE = {
  fallback: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-700",
};

export default function AdminEmailDelivery() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    const params = { status };
    if (from) params.date_from = from;
    if (to) params.date_to = to;
    api.get("/admin/email-failures", { params })
      .then(({ data }) => setItems(data.items || []))
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load"));
  };

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    if (user.platform_role !== "admin") { setErr("Admin access required."); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, status, from, to]);

  const resolve = async (it) => {
    setBusy(true);
    try {
      await api.post(`/admin/email-failures/${it.id}/resolve`, { resolved: !it.resolved });
      setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, resolved: !it.resolved } : x)));
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't update"); }
    finally { setBusy(false); }
  };

  const clearResolved = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/email-failures/clear-resolved");
      toast.success(`Cleared ${data.deleted} resolved ${data.deleted === 1 ? "entry" : "entries"}.`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't clear"); }
    finally { setBusy(false); }
  };

  if (err) return <div className="max-w-3xl mx-auto p-10 text-red-500" data-testid="admin-email-error">{err}</div>;
  if (!items) return <div className="max-w-3xl mx-auto p-10 text-slate-500">Loading…</div>;

  const unresolved = items.filter((x) => !x.resolved).length;
  const resolvedCount = items.filter((x) => x.resolved).length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="admin-email-page">
      <div className="flex items-center gap-3 mb-6">
        <Icon name="mail" tone="current" className="h-6 w-6 text-[#55B3AD]" />
        <div className="min-w-0">
          <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl tracking-tight">Email delivery</h1>
          <div className="text-xs text-slate-500 mt-1">{unresolved} unresolved &middot; {items.length} shown &middot; entries auto-remove after 90 days</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="email-filters">
        {["all", "failed", "fallback"].map((s) => (
          <button key={s} onClick={() => setStatus(s)} data-testid={`email-filter-${s}`}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold border capitalize ${status === s ? "bg-[#1F3F5B] text-white border-[#1F3F5B]" : "bg-white text-slate-600 border-slate-200"}`}>
            {s}
          </button>
        ))}
        <div className="flex items-center gap-1.5 ml-auto text-xs text-slate-500">
          <label className="flex items-center gap-1">From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="email-date-from"
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs" /></label>
          <label className="flex items-center gap-1">To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="email-date-to"
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs" /></label>
          {(from || to) && (
            <button onClick={() => { setFrom(""); setTo(""); }} data-testid="email-date-clear"
              className="text-slate-400 hover:text-slate-700 underline">clear</button>
          )}
        </div>
      </div>

      <div className="flex justify-end mb-3">
        <button onClick={clearResolved} disabled={busy || resolvedCount === 0} data-testid="email-clear-resolved"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-red-600 disabled:opacity-40">
          <Icon name="delete" tone="current" className="h-3.5 w-3.5" /> Clear resolved {resolvedCount ? `(${resolvedCount})` : ""}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center text-slate-500" data-testid="email-empty">
          No delivery issues. Every email is going out cleanly.
        </div>
      ) : (
        <div className="space-y-3" data-testid="email-list">
          {items.map((it) => (
            <article key={it.id} data-testid={`email-row-${it.id}`}
              className={`bg-white rounded-2xl border p-4 ${it.resolved ? "border-slate-100 opacity-60" : "border-slate-200"}`}>
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span data-testid={`email-route-${it.id}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ROUTE_BADGE[it.route] || "bg-slate-100 text-slate-500"}`}>
                      {it.route === "fallback" ? "Sent via backup" : "Failed"}
                    </span>
                    <span className="font-semibold text-[#1F3F5B] truncate">{it.subject || "(no subject)"}</span>
                    {it.resolved && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                        <Icon name="success" tone="current" className="h-3 w-3" /> Resolved
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 inline-flex items-center gap-1">
                    <Icon name="mail" tone="current" className="h-3 w-3" /> {it.to}
                    <span className="text-slate-300">&middot;</span>
                    <Icon name="clock" tone="current" className="h-3 w-3" /> {new Date(it.at).toLocaleString()}
                  </div>
                </div>
                <button onClick={() => resolve(it)} disabled={busy} data-testid={`email-resolve-${it.id}`}
                  className={`shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${it.resolved ? "bg-white border border-slate-200 text-slate-600" : "bg-[#1F3F5B] text-white hover:bg-[#152a3d]"}`}>
                  <Icon name={it.resolved ? "refresh" : "success"} tone="current" className="h-3.5 w-3.5" />
                  {it.resolved ? "Reopen" : "Mark resolved"}
                </button>
              </div>
              <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-500" data-testid={`email-reason-${it.id}`}><b className="text-slate-700">Reason:</b> {it.reason}</div>
                <div className="text-xs text-[#2A7871] mt-1" data-testid={`email-hint-${it.id}`}><Icon name="info" tone="current" className="h-3 w-3 inline mr-1" />{hintFor(it)}</div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
