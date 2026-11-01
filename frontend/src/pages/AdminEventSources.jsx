import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api, errMsg } from "@/lib/api";
import { toast } from "sonner";

const MARKETS = [
  "Portland/Vancouver", "Hood River", "Eugene", "Olympia", "Tacoma",
  "Greater Seattle", "Kirkland", "Everett", "Anacortes/San Juan Islands", "Bellingham",
];

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never");

function StatusPill({ status }) {
  if (status === "ok") return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold bg-[#55B3AD]/15 text-[#2A7871]">OK</span>;
  if (status === "error") return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">Error</span>;
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">Not run</span>;
}

const FIELD = "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-[#1F3F5B] dark:text-slate-100 focus:border-[#55B3AD] outline-none min-h-[44px]";
const LABEL = "text-xs font-bold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400";

export default function AdminEventSources() {
  const [sources, setSources] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await api.get("/admin/event-sources"); setSources(data.sources || []); }
    catch (e) { toast.error(errMsg(e, "Couldn't load sources")); setSources([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const runNow = async (key) => {
    setBusyKey(key);
    try { const { data } = await api.post(`/admin/event-sources/${key}/run`); const s = (data.sources || [])[0]; toast.success(s ? `${s.label}: ${s.inserted} added, ${s.updated} updated` : "Ran"); await load(); }
    catch (e) { toast.error(errMsg(e, "Run failed")); } finally { setBusyKey(null); }
  };
  const toggle = async (row) => {
    setBusyKey(row.key);
    try { await api.patch(`/admin/event-sources/${row.key}`, { enabled: !row.enabled }); await load(); }
    catch (e) { toast.error(errMsg(e, "Couldn't update")); } finally { setBusyKey(null); }
  };
  const del = async (row) => {
    if (!window.confirm(`Delete "${row.name}"? This is only allowed because it has no imported events.`)) return;
    setBusyKey(row.key);
    try { await api.delete(`/admin/event-sources/${row.key}`); toast.success("Deleted"); await load(); }
    catch (e) { toast.error(errMsg(e, "Couldn't delete")); } finally { setBusyKey(null); }
  };
  const saveEdit = async (key, patch) => {
    try { await api.patch(`/admin/event-sources/${key}`, patch); toast.success("Saved"); await load(); }
    catch (e) { toast.error(errMsg(e, "Couldn't save")); }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8" data-testid="admin-event-sources-page">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <h1 className="font-display font-extrabold text-2xl text-[#1F3F5B] dark:text-slate-100">Event sources</h1>
        <button onClick={() => setShowAdd(true)} data-testid="add-source-btn"
          className="inline-flex items-center gap-1.5 rounded-full bg-[#1F3F5B] text-white px-5 py-2.5 text-sm font-semibold hover:bg-[#152a3d]">
          <Icon name="plus" tone="current" className="h-4 w-4" /> Add source
        </button>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">Calendars read into the events feed. ICS feeds are editable; the custom scraper is read only. Recurring events are expanded for 12 months.</p>

      {sources === null ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm" data-testid="sources-table">
            <thead className="bg-slate-50 dark:bg-slate-900 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Market</th><th className="px-3 py-2">Enabled</th>
                <th className="px-3 py-2">Last run</th><th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Found / Added / Upd / Skip</th>
                <th className="px-3 py-2">Added by</th><th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <SourceRow key={s.key} s={s} busy={busyKey === s.key}
                  onRun={() => runNow(s.key)} onToggle={() => toggle(s)} onDelete={() => del(s)} onSave={saveEdit} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddSourceModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function SourceRow({ s, busy, onRun, onToggle, onDelete, onSave }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const [market, setMarket] = useState(s.default_market || "");
  const [label, setLabel] = useState(s.source_label || "");
  return (
    <tr className="border-t border-slate-200 dark:border-slate-700 align-top" data-testid={`source-row-${s.key}`}>
      <td className="px-3 py-2">
        {editing ? <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} data-testid={`edit-name-${s.key}`} />
          : <div className="font-semibold text-[#1F3F5B] dark:text-slate-100">{s.name}</div>}
        <div className="text-[11px] text-slate-400 break-all max-w-[280px]">{s.url}</div>
      </td>
      <td className="px-3 py-2">{s.type === "ics" ? "ICS feed" : <span className="text-slate-500">custom scraper</span>}</td>
      <td className="px-3 py-2">
        {editing ? (
          <select className={FIELD} value={market} onChange={(e) => setMarket(e.target.value)} data-testid={`edit-market-${s.key}`}>
            <option value="">Auto (from text)</option>
            {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (s.default_market || "Auto")}
      </td>
      <td className="px-3 py-2">
        <button onClick={onToggle} disabled={busy} data-testid={`toggle-${s.key}`}
          className={`rounded-full px-3 py-1 text-xs font-bold ${s.enabled ? "bg-[#55B3AD]/15 text-[#2A7871]" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>
          {s.enabled ? "Yes" : "No"}
        </button>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-slate-500">{fmtTime(s.last_run_at)}</td>
      <td className="px-3 py-2"><StatusPill status={s.last_status} />{s.last_status === "error" && s.last_error ? <div className="text-[11px] text-red-600 max-w-[200px]">{s.last_error}</div> : null}</td>
      <td className="px-3 py-2 whitespace-nowrap">{s.last_fetched ?? 0} / {s.last_inserted ?? 0} / {s.last_updated ?? 0} / {s.last_skipped ?? 0}</td>
      <td className="px-3 py-2 text-slate-500 text-xs">{s.created_by}<div className="text-[11px] text-slate-400">{fmtTime(s.created_at)}</div></td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1 items-end">
          <button onClick={onRun} disabled={busy || !s.enabled} data-testid={`run-${s.key}`} className="text-xs font-semibold text-[#55B3AD] hover:underline disabled:opacity-40">Run now</button>
          {!s.read_only && !editing && <button onClick={() => setEditing(true)} data-testid={`edit-${s.key}`} className="text-xs font-semibold text-slate-500 hover:underline">Edit</button>}
          {editing && <>
            <button onClick={() => { onSave(s.key, { name, default_market: market, source_label: label }); setEditing(false); }} data-testid={`save-${s.key}`} className="text-xs font-semibold text-[#2A7871] hover:underline">Save</button>
            <button onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:underline">Cancel</button>
          </>}
          {!s.read_only && (s.imported_count ? <span className="text-[10px] text-slate-400" title="Disable keeps imported events">disable only</span>
            : <button onClick={onDelete} disabled={busy} data-testid={`delete-${s.key}`} className="text-xs font-semibold text-red-600 hover:underline">Delete</button>)}
        </div>
      </td>
    </tr>
  );
}

function AddSourceModal({ onClose, onAdded }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [market, setMarket] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [label, setLabel] = useState("");
  const [converted, setConverted] = useState(null);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  const checkConvert = async (value) => {
    setConverted(null);
    if (!value.includes("calendar.google.com")) return;
    try { const { data } = await api.post("/admin/event-sources/convert", { url: value }); if (data.is_google_embed) setConverted(data.converted); }
    catch { /* ignore */ }
  };
  const runTest = async () => {
    setBusy(true); setTest(null);
    try { const { data } = await api.post("/admin/event-sources/test", { url: (converted || url).trim() }); setTest(data); toast.success(`${data.future_events} future events found`); }
    catch (e) { toast.error(errMsg(e, "Test failed")); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try {
      await api.post("/admin/event-sources", { name, url: (converted || url).trim(), default_market: market || null, organizer_name: organizer || null, source_label: label || null });
      toast.success("Source added"); onAdded();
    } catch (e) { toast.error(errMsg(e, "Couldn't add")); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose} data-testid="add-source-modal">
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display font-bold text-lg text-[#1F3F5B] dark:text-slate-100 mb-4">Add ICS source</h2>
        <div className="space-y-4">
          <div><div className={LABEL}>Name</div><input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tacoma Yacht Club races" data-testid="add-name" /></div>
          <div>
            <div className={LABEL}>ICS address (https only)</div>
            <input className={FIELD} value={url} onChange={(e) => { setUrl(e.target.value); setConverted(null); setTest(null); }} onBlur={(e) => checkConvert(e.target.value.trim())} placeholder="https://...basic.ics" data-testid="add-url" />
            {converted && (
              <div className="mt-2 rounded-xl bg-[#55B3AD]/10 border border-[#55B3AD]/30 p-3 text-xs" data-testid="convert-suggestion">
                <div className="font-semibold text-[#2A7871] mb-1">This looks like a Google Calendar embed. Use its public ICS address?</div>
                <div className="break-all text-slate-600 dark:text-slate-300">{converted}</div>
                <div className="text-slate-500 mt-1">Saving/testing will use this converted address.</div>
              </div>
            )}
          </div>
          <div><div className={LABEL}>Default market (optional)</div>
            <select className={FIELD} value={market} onChange={(e) => setMarket(e.target.value)} data-testid="add-market">
              <option value="">Auto (detect from text)</option>
              {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div><div className={LABEL}>Organizer name (optional)</div><input className={FIELD} value={organizer} onChange={(e) => setOrganizer(e.target.value)} data-testid="add-organizer" /></div>
          <div><div className={LABEL}>Source label (shows as "Source: ...")</div><input className={FIELD} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={name} data-testid="add-label" /></div>

          <button onClick={runTest} disabled={busy || !(converted || url)} data-testid="test-source-btn"
            className="w-full rounded-full border border-[#55B3AD] text-[#2A7871] px-4 py-2.5 text-sm font-semibold hover:bg-[#55B3AD]/10 disabled:opacity-40">
            {busy ? "Testing..." : "Test this source"}
          </button>
          {test && (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-sm" data-testid="test-result">
              <div className="font-semibold">{test.future_events} future events{test.date_range ? ` (${test.date_range[0]} to ${test.date_range[1]})` : ""}</div>
              <ul className="mt-1 text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                {(test.next_5 || []).map((e, i) => <li key={i}>{e.date} - {e.title}</li>)}
              </ul>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-5 py-2.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-sm">Cancel</button>
          <button onClick={save} disabled={busy || !name || !(converted || url)} data-testid="save-source-btn"
            className="bg-[#1F3F5B] text-white hover:bg-[#152a3d] rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-40">Add source</button>
        </div>
      </div>
    </div>
  );
}
