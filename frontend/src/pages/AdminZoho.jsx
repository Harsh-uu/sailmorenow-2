import { useEffect, useState, useCallback } from "react";
import { Icon } from "@/components/Icon";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

function Pill({ ok, yes = "Yes", no = "No" }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${ok ? "bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-200" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200"}`}>
      {ok ? yes : no}
    </span>
  );
}

function dryRunFresh(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && Date.now() - t < 60 * 60 * 1000;
}

export default function AdminZoho() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState(null);
  const [campaigns, setCampaigns] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState("");
  const [dry, setDry] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);
  const [confirmLive, setConfirmLive] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [confirmSync, setConfirmSync] = useState(false);
  const [job, setJob] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [promised, setPromised] = useState(null);

  const loadStatus = useCallback(async () => {
    const { data } = await api.get("/admin/zoho/crm/status");
    setStatus(data);
    return data;
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/"); return; }
    if (user.platform_role !== "admin") { setErr("Admin access required."); return; }
    loadStatus().catch((e) => setErr(e?.response?.data?.detail || "Failed to load Zoho status"));
    api.get("/admin/zoho/campaigns/check").then(({ data }) => setCampaigns(data)).catch(() => setCampaigns(null));
    api.get("/admin/zoho/crm/job").then(({ data }) => setJob(data)).catch(() => {});
    api.get("/admin/promised").then(({ data }) => setPromised(data)).catch(() => setPromised(null));
  }, [user, loading, nav, loadStatus]);

  // Poll the background job while it is running.
  useEffect(() => {
    if (!job || job.status !== "running") return undefined;
    const t = setInterval(async () => {
      try {
        const { data } = await api.get("/admin/zoho/crm/job");
        setJob(data);
        if (data.status !== "running") { clearInterval(t); loadStatus(); }
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(t);
  }, [job, loadStatus]);

  const run = async (key, fn) => {
    setBusy(key); setActionMsg(null);
    try {
      const res = await fn();
      await loadStatus();
      return res;
    } catch (e) {
      setActionMsg({ bad: true, text: e?.response?.data?.detail || "That action failed. Try again." });
    } finally {
      setBusy("");
    }
  };

  const doDryRun = () => run("dry", async () => {
    const { data } = await api.post("/admin/zoho/crm/backfill/dry-run");
    setDry(data);
    setActionMsg({ text: `Dry run complete: ${data.eligible_count} eligible, ${data.excluded_count} excluded.` });
  });
  const doRetry = () => run("retry", async () => {
    const { data } = await api.post("/admin/zoho/crm/retry-failed");
    setActionMsg({ text: `Requeued ${data.requeued ?? 0} failed rows. The drain worker sends them within about 2 minutes.` });
  });
  const startJob = async (url, label) => {
    setActionMsg(null);
    try {
      await api.post(url);
      const { data } = await api.get("/admin/zoho/crm/job");
      setJob(data);
      setActionMsg({ text: `${label} started. Progress updates below.` });
    } catch (e) {
      setActionMsg({ bad: true, text: e?.response?.data?.detail || "Could not start the job." });
    }
  };
  const doReconcile = () => startJob("/admin/zoho/crm/reconcile", "Reconcile");
  const doLive = () => { setConfirmLive(false); startJob("/admin/zoho/crm/backfill/run", "Live backfill"); };
  const doExchange = () => run("exchange", async () => {
    await api.post("/admin/zoho/crm/exchange-code", { code: codeInput });
    setCodeInput("");
    setActionMsg({ text: "Connected. Refresh token stored securely. Now run a connection test." });
  });
  const doSetToken = () => run("settoken", async () => {
    await api.post("/admin/zoho/crm/set-token", { refresh_token: tokenInput });
    setTokenInput("");
    setActionMsg({ text: "Refresh token saved securely. Now run a connection test." });
  });
  const doDisconnect = () => run("disconnect", async () => {
    await api.post("/admin/zoho/crm/disconnect");
    setTestResult(null);
    setActionMsg({ text: "Disconnected. Stored token deleted and sync turned off." });
  });
  const doTest = () => run("test", async () => {
    const { data } = await api.post("/admin/zoho/crm/test");
    setTestResult(data);
    setActionMsg(data.connected ? { text: "Connection test passed." } : { bad: true, text: data.error || "Connection test failed." });
  });
  const doToggleSync = (on) => run("toggle", async () => {
    const { data } = await api.post("/admin/zoho/crm/sync-toggle", { on });
    setConfirmSync(false);
    setActionMsg({ text: data.sync_enabled ? "CRM sync is ON." : "CRM sync is OFF." });
  });
  const doToggleCampaigns = (on) => run("camp-toggle", async () => {
    if (on && !window.confirm("Turning this on lets Zoho send confirmation and marketing emails to people who subscribe.")) return;
    const { data } = await api.post("/admin/zoho/campaigns/toggle", { on });
    setActionMsg({ text: data.campaigns_enabled ? "Zoho Campaigns is ON (can send email)." : "Zoho Campaigns is OFF. No email will be sent." });
    loadStatus();
  });
  const doExclude = (handle) => run("exclude", async () => {
    await api.post("/admin/zoho/crm/exclude", { handle });
    setDry((d) => d ? { ...d, test_suspects: (d.test_suspects || []).filter((s) => s.handle !== handle) } : d);
    setActionMsg({ text: `@${handle} added to the never-sync list.` });
    loadStatus();
  });

  if (err) return <div className="max-w-5xl mx-auto p-10 text-center text-slate-500 dark:text-slate-400" data-testid="zoho-error">{err}</div>;
  if (!status) return <div className="max-w-5xl mx-auto p-10 text-slate-500 dark:text-slate-400">Loading...</div>;

  const o = status.outbox || {};
  const liveReady = dryRunFresh(status.last_dry_run_at) && status.crm_enabled;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="admin-zoho-page">
      <div className="flex items-center gap-3">
        <Icon name="refresh" tone="current" className="h-7 w-7 text-[#55B3AD]" />
        <div>
          <h1 className="font-display font-extrabold smn-heading text-3xl">Zoho sync</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">CRM Contacts outbox status, backfill and the Campaigns connection.</p>
        </div>
      </div>

      {/* Promised, manual - benefits Jenn fulfills by hand (from the plan matrix) */}
      <section className="mt-6" data-testid="promised-section">
        <div className="text-xs font-bold uppercase tracking-widest text-[#F2A03B] mb-3">Promised, manual</div>
        <div className="rounded-2xl border border-[#F2A03B]/30 bg-[#F2A03B]/[0.05] dark:bg-[#F2A03B]/[0.08] p-5">
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">Benefits promised in the plans that are fulfilled by hand (not automated). Source: the plan matrix.</p>
          {!promised ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">Loading...</div>
          ) : promised.items.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">Nothing promised.</div>
          ) : (
            <ul className="space-y-2" data-testid="promised-list">
              {promised.items.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm" data-testid={`promised-item-${i}`}>
                  <Icon name="sparkles" tone="current" className="h-4 w-4 mt-0.5 text-[#d98c30] shrink-0" />
                  <span><b className="smn-heading">{p.account_type} - {p.level}:</b> {p.benefit} ({p.detail})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* CRM status */}
      <section className="mt-6">
        <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] mb-3">Zoho CRM (Contacts)</div>
        <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-3" data-testid="crm-status">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2"><span className="text-sm text-slate-500 dark:text-slate-400">Sync enabled</span><Pill ok={status.crm_enabled} yes="On" no="Off" /></div>
            <div className="flex items-center gap-2"><span className="text-sm text-slate-500 dark:text-slate-400">Credentials present</span><Pill ok={status.credentials_present} /></div>
            <div className="text-sm text-slate-500 dark:text-slate-400">API domain: <span className="font-mono text-slate-700 dark:text-slate-200">{status.api_domain}</span></div>
          </div>
          {!status.crm_enabled && (
            <div className="text-xs rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-3 py-2" data-testid="crm-gated-note">
              Sync is gated off (ZOHO_CRM_ENABLED is false). New sign-ups are still queued safely in the outbox and will send once sync is turned on.
            </div>
          )}
        </div>
      </section>

      {/* CRM connection (secure credential screen) */}
      <section className="mt-6">
        <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] mb-3">CRM connection</div>
        <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-5" data-testid="crm-connection">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2"><span className="text-sm text-slate-500 dark:text-slate-400">Client id/secret</span><Pill ok={status.client_present} /></div>
            <div className="flex items-center gap-2"><span className="text-sm text-slate-500 dark:text-slate-400">Token stored</span><Pill ok={status.token_present} yes={status.token_source === "stored" ? "Yes (saved)" : "Yes (env)"} /></div>
            {status.token_updated_at && <div className="text-xs text-slate-400">Updated {new Date(status.token_updated_at).toLocaleString()}</div>}
          </div>

          {/* Sync toggle */}
          <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 px-4 py-3">
            <div>
              <div className="text-sm font-semibold smn-heading">CRM sync {status.crm_enabled ? "is ON" : "is OFF"}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">New sign-ups and changes push to Zoho Contacts only when this is on.</div>
            </div>
            {status.crm_enabled ? (
              <button onClick={() => doToggleSync(false)} disabled={!!busy} data-testid="sync-off-btn"
                className="px-4 py-2 rounded-full font-semibold text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 disabled:opacity-50">Turn off</button>
            ) : (
              <button onClick={() => setConfirmSync(true)} disabled={!!busy || !status.token_present} data-testid="sync-on-btn"
                title={status.token_present ? "" : "Connect a token first."}
                className="px-4 py-2 rounded-full font-semibold text-sm bg-[#55B3AD] text-white disabled:opacity-40">Turn on</button>
            )}
          </div>

          {/* Connection test */}
          <div>
            <button onClick={doTest} disabled={!!busy || !status.token_present} data-testid="btn-conn-test"
              className="px-4 py-2 rounded-full font-semibold text-sm bg-[#1F3F5B] text-white disabled:opacity-40">
              {busy === "test" ? "Testing..." : "Test connection"}
            </button>
            {status.last_conn_test && (
              <span className="ml-3 text-xs text-slate-400">Last test: {status.last_conn_test.ok ? "passed" : "failed"} {status.last_conn_test.at ? new Date(status.last_conn_test.at).toLocaleString() : ""}</span>
            )}
            {testResult && (
              <div className="mt-3" data-testid="test-result">
                <div className="flex items-center gap-2"><span className="text-sm text-slate-500 dark:text-slate-400">Connected</span><Pill ok={testResult.connected} /></div>
                {testResult.error && <div className="text-sm text-red-700 dark:text-red-300 mt-1">{testResult.error}</div>}
                {testResult.market_map?.live && (
                  <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700" data-testid="test-market-map">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 pb-1">Market mapping (app market -&gt; value sent)</div>
                    {(testResult.market_map.rows || []).map((r, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                        <span className="font-mono text-slate-700 dark:text-slate-200 truncate">{r.app}</span>
                        <span className={`font-mono shrink-0 ${String(r.sends).includes("fallback") ? "text-amber-700 dark:text-amber-400" : "text-teal-800 dark:text-teal-300"}`}>{r.sends}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Grant code exchange */}
          <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
            <label className="block text-sm font-semibold smn-heading mb-1">Connect with a Zoho grant code</label>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">In Zoho Developer Console, open your Self Client, add the CRM scopes, generate a code, and paste it here within a few minutes. The code is exchanged on the server and never shown or stored; only the resulting token is kept, encrypted.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="password" autoComplete="off" value={codeInput} onChange={(e) => setCodeInput(e.target.value)}
                placeholder="Paste grant code" data-testid="grant-code-input"
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
              <button onClick={doExchange} disabled={!!busy || !codeInput.trim()} data-testid="btn-exchange"
                className="px-4 py-2 rounded-full font-semibold text-sm bg-[#F2A03B] text-[#10233A] disabled:opacity-40">
                {busy === "exchange" ? "Connecting..." : "Connect"}
              </button>
            </div>
          </div>

          {/* Direct refresh token fallback */}
          <div>
            <label className="block text-sm font-semibold smn-heading mb-1">Or paste a refresh token directly</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="password" autoComplete="off" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Paste refresh token" data-testid="refresh-token-input"
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
              <button onClick={doSetToken} disabled={!!busy || !tokenInput.trim()} data-testid="btn-set-token"
                className="px-4 py-2 rounded-full font-semibold text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 disabled:opacity-50">
                {busy === "settoken" ? "Saving..." : "Save token"}
              </button>
            </div>
          </div>

          {status.token_present && (
            <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
              <button onClick={doDisconnect} disabled={!!busy} data-testid="btn-disconnect"
                className="px-4 py-2 rounded-full font-semibold text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900 disabled:opacity-50">
                {busy === "disconnect" ? "Disconnecting..." : "Disconnect (delete stored token)"}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Confirm turn sync on */}
      {confirmSync && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" data-testid="sync-confirm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-md w-full">
            <h3 className="font-extrabold smn-heading text-lg">Turn CRM sync on?</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">
              This starts pushing real users to Zoho Contacts. It requires a connection test that passed in the last hour. Continue?
            </p>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setConfirmSync(false)} className="px-4 py-2 rounded-full text-sm font-semibold text-slate-600 dark:text-slate-300" data-testid="sync-cancel">Cancel</button>
              <button onClick={() => doToggleSync(true)} disabled={busy === "toggle"} className="px-4 py-2 rounded-full text-sm font-semibold bg-[#55B3AD] text-white disabled:opacity-50" data-testid="sync-confirm-btn">
                {busy === "toggle" ? "Turning on..." : "Turn sync on"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Outbox counts */}
      <section className="mt-6">
        <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] mb-3">Outbox</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" data-testid="outbox-counts">
          {[["pending", "Pending", "bg-white dark:bg-slate-800"], ["sent", "Sent", "bg-teal-50 dark:bg-teal-950/30"], ["failed", "Failed", "bg-red-50 dark:bg-red-950/30"], ["skipped", "Skipped", "bg-slate-50 dark:bg-slate-900/40"]].map(([k, label, bg]) => (
            <div key={k} className={`rounded-2xl border border-slate-100 dark:border-slate-700 ${bg} p-5`} data-testid={`outbox-${k}`}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</div>
              <div className="text-3xl font-extrabold smn-heading mt-1">{o[k] ?? 0}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Actions */}
      <section className="mt-8">
        <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] mb-3">Actions</div>
        <div className="flex flex-wrap gap-3">
          <button onClick={doDryRun} disabled={!!busy} data-testid="btn-dry-run"
            className="px-4 py-2 rounded-full font-semibold text-sm bg-[#1F3F5B] text-white disabled:opacity-50">
            {busy === "dry" ? "Running..." : "Dry run backfill"}
          </button>
          <button onClick={doRetry} disabled={!!busy} data-testid="btn-retry"
            className="px-4 py-2 rounded-full font-semibold text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 disabled:opacity-50">
            {busy === "retry" ? "Working..." : "Retry failed"}
          </button>
          <button onClick={doReconcile} disabled={!!busy} data-testid="btn-reconcile"
            className="px-4 py-2 rounded-full font-semibold text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 disabled:opacity-50">
            {busy === "reconcile" ? "Working..." : "Reconcile"}
          </button>
          <button onClick={() => setConfirmLive(true)} disabled={!!busy || !liveReady} data-testid="btn-live-backfill"
            title={liveReady ? "" : "Run a dry run within the last hour and turn sync on first."}
            className="px-4 py-2 rounded-full font-semibold text-sm bg-[#F2A03B] text-[#10233A] disabled:opacity-40">
            Live backfill
          </button>
        </div>
        {!liveReady && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2" data-testid="live-hint">
            Live backfill unlocks after a dry run in the last hour and only when sync is turned on.
          </p>
        )}
        {actionMsg && (
          <div className={`mt-3 text-sm rounded-lg px-3 py-2 ${actionMsg.bad ? "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300" : "bg-teal-50 dark:bg-teal-950/30 text-teal-900 dark:text-teal-200"}`} data-testid="action-msg">
            {actionMsg.text}
          </div>
        )}
        {job && job.status && job.status !== "idle" && (
          <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-4 py-3" data-testid="job-progress">
            <div className="flex items-center gap-2 text-sm font-semibold smn-heading capitalize">
              {job.kind} job: {job.status}
              {job.status === "running" && <span className="h-2 w-2 rounded-full bg-[#55B3AD] animate-pulse" />}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Sent {job.sent ?? 0}, failed {job.failed ?? 0}, skipped {job.skipped ?? 0}, remaining {job.remaining ?? 0} of {job.total ?? 0}
              {job.message ? ` (${job.message})` : ""}
            </div>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-2">Last dry run: {status.last_dry_run_at ? new Date(status.last_dry_run_at).toLocaleString() : "never"}</p>
      </section>

      {/* Confirm live backfill */}
      {confirmLive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" data-testid="live-confirm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-md w-full">
            <h3 className="font-extrabold smn-heading text-lg">Run a live backfill?</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">
              This enqueues every eligible user and sends them to Zoho CRM. It is idempotent (safe to re-run), but it does make live writes to Zoho. Continue?
            </p>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setConfirmLive(false)} className="px-4 py-2 rounded-full text-sm font-semibold text-slate-600 dark:text-slate-300" data-testid="live-cancel">Cancel</button>
              <button onClick={doLive} disabled={busy === "live"} className="px-4 py-2 rounded-full text-sm font-semibold bg-[#F2A03B] text-[#10233A] disabled:opacity-50" data-testid="live-confirm-btn">
                {busy === "live" ? "Running..." : "Run live backfill"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dry-run result */}
      {dry && (
        <section className="mt-8" data-testid="dry-result">
          <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] mb-3">Dry run result</div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5" data-testid="dry-eligible">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Eligible ({dry.eligible_count})</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(dry.eligible_handles || []).map((h, i) => (
                  <span key={i} className="text-xs font-mono px-2 py-0.5 rounded bg-teal-50 dark:bg-teal-950/30 text-teal-900 dark:text-teal-200">@{h}</span>
                ))}
                {(dry.eligible_handles || []).length === 0 && <span className="text-sm text-slate-500 dark:text-slate-400">None</span>}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5" data-testid="dry-excluded">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Excluded ({dry.excluded_count})</div>
              <div className="mt-2 space-y-1">
                {(dry.excluded || []).map((x, i) => (
                  <div key={i} className="text-xs flex items-center justify-between gap-2">
                    <span className="font-mono text-slate-700 dark:text-slate-200 truncate">@{x.handle}</span>
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">{x.reason}</span>
                  </div>
                ))}
                {(dry.excluded || []).length === 0 && <span className="text-sm text-slate-500 dark:text-slate-400">None</span>}
              </div>
            </div>
          </div>
          {dry.test_suspects && dry.test_suspects.length > 0 && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-5 mt-4" data-testid="dry-suspects">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-800 dark:text-amber-300">Looks like a test account ({dry.test_suspects.length}) - review, NOT auto-excluded</div>
              <div className="mt-2 divide-y divide-amber-100 dark:divide-amber-900/40">
                {dry.test_suspects.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-2 text-sm" data-testid={`suspect-${i}`}>
                    <div className="min-w-0">
                      <span className="font-mono text-slate-700 dark:text-slate-200">@{s.handle}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">{s.reason}</span>
                    </div>
                    <button onClick={() => doExclude(s.handle)} disabled={!!busy} data-testid={`suspect-exclude-${i}`}
                      className="px-3 py-1 rounded-full text-xs font-semibold border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 shrink-0 disabled:opacity-50">Never sync</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dry.market_map && (
            <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 mt-4" data-testid="dry-market-map">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Market field mapping (app market -&gt; value sent to Zoho)</div>
              {!dry.market_map.live ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Connect CRM credentials to preview the exact values that will be sent.</p>
              ) : (
                <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-700">
                  {(dry.market_map.rows || []).map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-1.5 text-sm" data-testid={`market-row-${i}`}>
                      <span className="font-mono text-slate-700 dark:text-slate-200 truncate">{r.app}</span>
                      <span className="text-slate-400 shrink-0">sends</span>
                      <span className={`font-mono shrink-0 ${String(r.sends).includes("fallback") ? "text-amber-700 dark:text-amber-400" : "text-teal-800 dark:text-teal-300"}`}>{r.sends}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Recent failures */}
      <section className="mt-8">
        <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] mb-3">Recent failures</div>
        <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden" data-testid="recent-failures">
          {(status.recent_failures || []).length === 0 && <div className="p-6 text-slate-500 dark:text-slate-400">No failures.</div>}
          {(status.recent_failures || []).map((f, i) => {
            const d = f.error_detail || {};
            const open = expanded[f.user_id];
            return (
              <div key={i} className="px-4 py-3" data-testid={`failure-${i}`}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold smn-heading truncate">
                      <span className="font-mono text-xs text-slate-400">{f.user_id}</span>
                      {d.code ? <span className="ml-2 text-red-700 dark:text-red-300">{d.code}</span> : null}
                      {d.api_name ? <span className="ml-1 font-mono text-xs text-amber-700 dark:text-amber-400">{d.api_name}</span> : null}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 truncate">{d.message || f.last_error}</div>
                  </div>
                  <span className="text-[10px] uppercase tracking-widest text-slate-400 shrink-0">{f.attempts} tries</span>
                  <button onClick={() => setExpanded((e) => ({ ...e, [f.user_id]: !e[f.user_id] }))}
                    className="text-xs font-semibold text-[#55B3AD] shrink-0" data-testid={`failure-expand-${i}`}>
                    {open ? "Hide" : "Details"}
                  </button>
                </div>
                {open && (
                  <pre className="mt-2 text-[11px] whitespace-pre-wrap break-all text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2" data-testid={`failure-detail-${i}`}>{f.last_error}</pre>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Campaigns connection */}
      <section className="mt-8">
        <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] mb-3">Zoho Campaigns (newsletter)</div>
        <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5" data-testid="campaigns-status">
          {campaigns === null ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">Checking...</div>
          ) : (
            <div className="space-y-3">
              {/* Campaigns kill switch (can send email). Default OFF. */}
              <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 px-4 py-3" data-testid="campaigns-killswitch">
                <div>
                  <div className="text-sm font-semibold smn-heading">Zoho Campaigns (can send email) {status.campaigns_enabled ? "is ON" : "is OFF"}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">When off, the app makes no Campaigns calls, so Zoho cannot send any confirmation or marketing email. CRM Contact sync (no email) is unaffected.</div>
                </div>
                {status.campaigns_enabled ? (
                  <button onClick={() => doToggleCampaigns(false)} disabled={!!busy} data-testid="campaigns-off-btn"
                    className="px-4 py-2 rounded-full font-semibold text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 disabled:opacity-50">Turn off</button>
                ) : (
                  <button onClick={() => doToggleCampaigns(true)} disabled={!!busy} data-testid="campaigns-on-btn"
                    className="px-4 py-2 rounded-full font-semibold text-sm bg-[#55B3AD] text-white disabled:opacity-40">Turn on</button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="flex items-center gap-2"><span className="text-sm text-slate-500 dark:text-slate-400">Connected</span><Pill ok={campaigns.connected} /></div>
                <div className="flex items-center gap-2"><span className="text-sm text-slate-500 dark:text-slate-400">List key</span><Pill ok={campaigns.has_list_key} /></div>
              </div>
              {(campaigns.missing_env || []).length > 0 && (
                <div className="text-xs text-amber-800 dark:text-amber-300">Missing env: {campaigns.missing_env.join(", ")}</div>
              )}
              {(campaigns.list_names || []).length > 0 && (
                <div className="text-sm text-slate-600 dark:text-slate-300">Lists: {campaigns.list_names.join(", ")}</div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Exclusions */}
      <section className="mt-8 mb-6">
        <div className="text-xs font-bold uppercase tracking-widest text-[#55B3AD] mb-3">Sync exclusions</div>
        <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 text-sm text-slate-600 dark:text-slate-300 space-y-1" data-testid="exclusions">
          <div>Usernames never synced: <span className="font-mono">{(status.exclusions?.handles || []).join(", ") || "none"}</span></div>
          <div>Name markers: <span className="font-mono">{(status.exclusions?.name_markers || []).join(", ")}</span></div>
          <div>Rules: {(status.exclusions?.rules || []).join("; ")}</div>
        </div>
      </section>
    </div>
  );
}
