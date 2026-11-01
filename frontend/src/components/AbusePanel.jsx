import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, errMsg } from "@/lib/api";
import { toast } from "sonner";

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export default function AbusePanel() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [bans, setBans] = useState([]);
  const loadBans = () => api.get("/admin/ip-bans").then(({ data }) => setBans(data || [])).catch(() => {});
  const ban = async (ip) => {
    if (!window.confirm(`Ban ${ip}? Every request from this IP will get a 403.`)) return;
    try { await api.post("/admin/ip-bans", { ip, reason: "Repeated rate-limit blocks" }); toast.success(`${ip} banned`); loadBans(); }
    catch (e) { toast.error(errMsg(e, "Failed")); }
  };
  const unban = async (ip) => {
    try { await api.delete(`/admin/ip-bans/${encodeURIComponent(ip)}`); toast.success(`${ip} unbanned`); loadBans(); }
    catch { toast.error("Failed"); }
  };
  const bannedSet = new Set(bans.map((b) => b.ip));
  const load = () => { loadBans(); return api.get("/admin/abuse", { params: { days } }).then(({ data }) => setData(data)).catch(() => setData({ error: true })); };
  useEffect(() => { load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;

  return (
    <div className="mt-8 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5" data-testid="abuse-panel">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Icon name="shield-alert" tone="current" className="h-5 w-5 text-orange-500" />
          <div>
            <div className="font-display font-bold smn-heading text-lg leading-tight">Rate-limit blocks</div>
            <div className="text-xs text-slate-500">IPs that hit a throttle (contact, event posts, comments, analytics). Bots show up here first.</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[1, 7, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)} data-testid={`abuse-days-${d}`}
              className={`rounded-full px-3 py-1 text-xs font-semibold border ${days === d ? "bg-[#1F3F5B] text-white border-[#1F3F5B]" : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"}`}>{d}d</button>
          ))}
          <button onClick={load} data-testid="abuse-refresh" className="p-1.5 rounded-full border border-slate-200 dark:border-slate-600 text-slate-500 hover:border-[#55B3AD]"><Icon name="refresh" tone="current" className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {data.error ? <div className="mt-3 text-sm text-red-500">Failed to load.</div> : (
        <>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900 px-3 py-2" data-testid="abuse-total"><div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Blocks</div><div className="font-display font-extrabold text-xl smn-heading">{data.total_blocks}</div></div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900 px-3 py-2" data-testid="abuse-ips"><div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Offending IPs</div><div className="font-display font-extrabold text-xl smn-heading">{data.by_ip.length}</div></div>
            {data.by_bucket.slice(0, 2).map((b) => (
              <div key={b.bucket} className="rounded-xl bg-slate-50 dark:bg-slate-900 px-3 py-2"><div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold truncate">{b.bucket}</div><div className="font-display font-extrabold text-xl smn-heading">{b.blocks} <span className="text-xs font-normal text-slate-500">/ {b.unique_ips} IP{b.unique_ips === 1 ? "" : "s"}</span></div></div>
            ))}
          </div>

          {data.by_ip.length === 0 ? (
            <div className="mt-4 text-sm text-slate-500 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-6 text-center" data-testid="abuse-empty">No rate-limit blocks in the last {days} day{days === 1 ? "" : "s"}. Smooth sailing.</div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm" data-testid="abuse-table">
                <thead><tr className="text-left text-[10px] uppercase tracking-widest text-slate-500"><th className="py-2 pr-3">IP</th><th className="py-2 pr-3">Blocks</th><th className="py-2 pr-3">Endpoints</th><th className="py-2 pr-3">Last seen</th><th className="py-2 pr-3 hidden md:table-cell">User agent</th><th className="py-2">Action</th></tr></thead>
                <tbody>
                  {data.by_ip.map((r) => (
                    <tr key={r.ip} className="border-t border-slate-100 dark:border-slate-700" data-testid={`abuse-row-${r.ip}`}>
                      <td className="py-2 pr-3 font-mono text-xs smn-heading">{r.ip}</td>
                      <td className="py-2 pr-3"><span className={`inline-flex items-center justify-center min-w-[28px] rounded-full px-2 py-0.5 text-xs font-bold ${r.blocks >= 20 ? "bg-red-100 text-red-700" : r.blocks >= 5 ? "bg-orange-100 text-orange-700" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>{r.blocks}</span></td>
                      <td className="py-2 pr-3"><div className="flex flex-wrap gap-1">{r.buckets.map((b) => <span key={b} className="text-[10px] px-2 py-0.5 rounded-full bg-[#55B3AD]/15 text-[#2A7871] dark:text-[#7fcac4] font-semibold">{b}</span>)}</div></td>
                      <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">{ago(r.last_at)}</td>
                      <td className="py-2 pr-3 text-xs text-slate-400 truncate max-w-[260px] hidden md:table-cell" title={r.ua}>{r.ua || "—"}</td>
                      <td className="py-2">
                        {bannedSet.has(r.ip)
                          ? <button onClick={() => unban(r.ip)} data-testid={`unban-${r.ip}`} className="inline-flex items-center gap-1 rounded-full bg-red-600 text-white px-3 py-1 text-xs font-bold hover:bg-red-700"><Icon name="verified" tone="current" className="h-3.5 w-3.5" /> Banned · undo</button>
                          : <button onClick={() => ban(r.ip)} data-testid={`ban-${r.ip}`} className="inline-flex items-center gap-1 rounded-full border border-red-200 text-red-600 px-3 py-1 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-950/40"><Icon name="ban" tone="current" className="h-3.5 w-3.5" /> Ban IP</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {bans.length > 0 && (
            <div className="mt-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900 px-3 py-2" data-testid="ban-list">
              <div className="text-[10px] font-bold uppercase tracking-widest text-red-700 dark:text-red-300 mb-1">Banned IPs ({bans.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {bans.map((b) => (
                  <span key={b.ip} className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-slate-800 border border-red-200 px-2.5 py-1 text-xs font-mono" title={`${b.reason || ""} · by ${b.banned_by || "admin"}`} data-testid={`banned-${b.ip}`}>
                    {b.ip}<button onClick={() => unban(b.ip)} className="text-slate-400 hover:text-red-600 ml-1" aria-label={`Unban ${b.ip}`}>×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.live.some((l) => l.active_ips > 0) && (
            <div className="mt-3 text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1" data-testid="abuse-live">
              <span className="font-bold uppercase tracking-widest">Live pressure:</span>
              {data.live.filter((l) => l.active_ips > 0).map((l) => <span key={l.bucket}>{l.bucket}: {l.active_ips} IP{l.active_ips === 1 ? "" : "s"} (hottest {l.hot_hits} hits)</span>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
