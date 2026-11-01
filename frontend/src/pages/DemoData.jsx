import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useDemoTour } from "@/components/DemoTour";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { toast } from "sonner";

const COLL_LABEL = {
  users: "Demo users", boat_pros: "Vendor listings", posts: "Feed posts",
  events: "Events", event_registrations: "RSVPs", reviews: "Reviews",
};

function fmt(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
}

export default function DemoData() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const { start } = useDemoTour();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [size, setSize] = useState("full");

  useEffect(() => { if (!loading && (!user || user.platform_role !== "admin")) nav("/"); }, [user, loading, nav]);

  const load = () => api.get("/admin/demo/status").then(({ data }) => setStatus(data)).catch(() => setStatus(null));
  useEffect(() => { if (user?.platform_role === "admin") load(); }, [user]);

  if (loading || !user) return null;

  const seed = async () => {
    setBusy("seed");
    try { const { data } = await api.post("/admin/demo/seed", { size }); setStatus(data.status); toast.success(`Loaded ${size} demo data`); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't load demo data"); }
    finally { setBusy(""); }
  };
  const reset = async () => {
    if (!window.confirm("Reset to Clean Launch? This permanently deletes ALL demo data (demo users, listings, posts, events, RSVPs, reviews). Real users, settings and configuration are kept.")) return;
    setBusy("reset");
    try { const { data } = await api.post("/admin/demo/reset"); setStatus(data.status); toast.success("Reset to clean launch"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't reset demo data"); }
    finally { setBusy(""); }
  };

  const active = status?.active;
  const seededAt = fmt(status?.seeded_at);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="font-display font-extrabold text-3xl text-[#1F3F5B] dark:text-slate-100 flex items-center gap-2">
        <Icon name="rocket" tone="current" className="h-7 w-7" /> Demo data
      </h1>
      <p className="mt-2 text-slate-500 dark:text-slate-400">
        Populate the app with realistic sample data for pre-launch demos, then wipe it clean. Demo records are tagged in the database, so Reset removes <strong>only</strong> demo data — real users, settings and configuration are never touched.
      </p>

      <div className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6" data-testid="demo-status">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[#1F3F5B] dark:text-slate-100">Current state</span>
          <span className={`text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`} data-testid="demo-state">
            {active ? "Demo data loaded" : "Clean launch"}
          </span>
        </div>
        {active && seededAt && (
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400" data-testid="demo-snapshot">
            Last loaded <strong>{seededAt}</strong>{status?.size ? ` · ${status.size} set` : ""}
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {status ? Object.entries(status.counts).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
              <div className="text-2xl font-display font-extrabold text-[#1F3F5B] dark:text-slate-100" data-testid={`demo-count-${k}`}>{v}</div>
              <div className="text-xs text-slate-500">{COLL_LABEL[k] || k}</div>
            </div>
          )) : <div className="col-span-full text-slate-400">Loading…</div>}
        </div>
      </div>

      <div className="mt-6">
        <div className="text-sm font-semibold text-[#1F3F5B] dark:text-slate-100 mb-2">How much to load?</div>
        <div className="inline-flex rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1" data-testid="demo-size-toggle">
          {[["small", "Small", "A quick walkthrough"], ["full", "Full", "The complete sample set"]].map(([key, label, note]) => (
            <button key={key} onClick={() => setSize(key)} data-testid={`demo-size-${key}`}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${size === key ? "bg-[#1F3F5B] text-white" : "text-slate-600 dark:text-slate-300"}`}
                    title={note}>{label}</button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-col sm:flex-row gap-3">
        <button onClick={seed} disabled={!!busy} data-testid="demo-seed-btn"
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-[#1F3F5B] hover:bg-[#152a3d] text-white font-semibold px-6 py-3 disabled:opacity-50 transition-colors">
          <Icon name="sparkles" tone="current" className="h-4 w-4" /> {busy === "seed" ? "Loading…" : `Load ${size} demo data`}
        </button>
        <button onClick={reset} disabled={!!busy || !active} data-testid="demo-reset-btn"
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-full border-2 border-red-200 text-red-600 hover:bg-red-50 font-semibold px-6 py-3 disabled:opacity-40 transition-colors">
          <Icon name="refresh" tone="current" className="h-4 w-4" /> {busy === "reset" ? "Resetting…" : "Reset to Clean Launch"}
        </button>
      </div>

      <button onClick={start} disabled={!active} data-testid="demo-tour-start"
              className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-full border border-[#55B3AD] text-[#2A7871] dark:text-[#7fcac4] font-semibold px-6 py-3 disabled:opacity-40 hover:bg-[#55B3AD]/10 transition-colors">
        <Icon name="rocket" tone="current" className="h-4 w-4" /> Start guided demo tour
      </button>

      <p className="mt-3 text-xs text-slate-400">Both actions are logged to the admin audit trail. Loading is safe to run more than once. The guided tour walks a prospect through directory → feed → marketplace → events → per-event crew → Crew Bank.</p>
    </div>
  );
}
