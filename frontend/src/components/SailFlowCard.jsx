import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";

// Home-screen SailFlow weather-station card. Opens the nearest station's live
// wind page on SailFlow in a new tab. Mapping is editable in the backend
// config (backend/sailflow_stations.py).
export default function SailFlowCard({ market }) {
  const [state, setState] = useState("loading"); // loading | ready | error
  const [data, setData] = useState(null);
  const [embedFailed, setEmbedFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setState("loading");
    api.get("/sailflow/station", { params: market ? { market } : {} })
      .then(({ data }) => { if (alive) { setData(data); setState(data?.url ? "ready" : "error"); } })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [market]);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4" data-testid="sailflow-card">
      <div className="rounded-3xl bg-gradient-to-br from-[#1F3F5B] to-[#2A7871] text-white p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-5 shadow-xl">
        <div className="h-14 w-14 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
          <Icon name="wind" tone="current" className="h-7 w-7 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.28em] text-[#7fcac4]">Live wind · SailFlow</div>
          {state === "loading" && (
            <div className="mt-2 animate-pulse" data-testid="sailflow-loading">
              <div className="h-5 w-48 bg-white/20 rounded" />
              <div className="h-3 w-32 bg-white/10 rounded mt-2" />
            </div>
          )}
          {state === "error" && (
            <div className="mt-1" data-testid="sailflow-error">
              <div className="font-display font-bold text-lg">Wind conditions unavailable</div>
              <a href="https://sailflow.com" target="_blank" rel="noopener noreferrer" className="text-sm text-[#7fcac4] hover:text-white font-semibold">Open SailFlow →</a>
            </div>
          )}
          {state === "ready" && (
            <>
              <h3 className="font-display font-extrabold text-xl sm:text-2xl mt-1 tracking-tight truncate" data-testid="sailflow-station">{data.station}</h3>
              <div className="text-sm text-slate-200 mt-0.5">{data.market}{data.is_default ? " (nearest station)" : ""}</div>
            </>
          )}
        </div>
        {state === "ready" && (
          <a href={data.url} target="_blank" rel="noopener noreferrer" data-testid="sailflow-open-btn"
             className="inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-3 font-semibold shrink-0">
            View live wind <Icon name="arrow-right" tone="current" className="h-4 w-4" />
          </a>
        )}
      </div>
      {state === "ready" && data.embed_url && !embedFailed && (
        <div className="max-w-7xl mx-auto mt-3 rounded-2xl overflow-hidden ring-1 ring-white/10 bg-[#0f2436]" data-testid="sailflow-embed">
          <iframe title={`Live wind — ${data.station}`} src={data.embed_url} className="w-full" style={{ height: 300, border: 0 }}
                  onError={() => setEmbedFailed(true)} scrolling="no" />
        </div>
      )}
    </section>
  );
}
