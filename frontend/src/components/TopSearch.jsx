import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/**
 * Compact top-bar search. Click the icon to open the input; type ≥2 chars to
 * fetch results across posts, discussions and events. Enter or click a result
 * to navigate. Escape or blur closes the dropdown.
 */
export default function TopSearch() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [pinBusy, setPinBusy] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  const loadSaved = async () => {
    if (!user) { setSaved([]); return; }
    try { const { data } = await api.get("/searches"); setSaved(data.searches || []); }
    catch { setSaved([]); }
  };
  const loadSuggestions = async () => {
    try { const { data } = await api.get("/searches/suggestions"); setSuggestions(data.suggestions || []); }
    catch { setSuggestions([]); }
  };

  const pin = async () => {
    const query = q.trim();
    if (query.length < 2) return;
    setPinBusy(true);
    try { await api.post("/searches", { q: query }); await loadSaved(); }
    catch { /* silent */ } finally { setPinBusy(false); }
  };
  const unpin = async (id) => {
    setPinBusy(true);
    try { await api.delete(`/searches/${id}`); await loadSaved(); }
    catch { /* silent */ } finally { setPinBusy(false); }
  };

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    loadSaved();
    loadSuggestions();
    const onDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults(null); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/search?q=${encodeURIComponent(query)}`);
        if (!cancelled) setResults(data);
      } catch {
        if (!cancelled) setResults({ posts: [], discussions: [], events: [] });
      } finally { if (!cancelled) setLoading(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const total = useMemo(() =>
    (results?.posts?.length || 0) + (results?.discussions?.length || 0) + (results?.events?.length || 0) + (results?.orgs?.length || 0)
  , [results]);

  const go = (path) => { setOpen(false); setQ(""); setResults(null); nav(path); };

  return (
    <div ref={containerRef} className="relative">
      <button onClick={() => setOpen((v) => !v)} data-testid="topbar-search-toggle"
              className="p-2 rounded-full hover:bg-slate-100" title="Search Sail More Now">
        {open ? <Icon name="close" tone="current" className="h-5 w-5 text-[#1F3F5B]" /> : <Icon name="search" tone="current" className="h-5 w-5 text-[#1F3F5B]" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[min(90vw,420px)] bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden z-50" data-testid="topbar-search-panel">
          <div className="p-2 border-b border-slate-100">
            <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
              <Icon name="search" tone="current" className="h-4 w-4 text-slate-400" />
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                     data-testid="topbar-search-input"
                     placeholder="Search posts, discussions, events…"
                     className="bg-transparent flex-1 text-sm focus:outline-none" />
              {loading && <span className="text-[10px] text-slate-400 uppercase tracking-widest">Searching…</span>}
              {user && q.trim().length >= 2 && (
                <button onClick={pin} disabled={pinBusy} data-testid="search-pin-btn"
                        title="Pin this search"
                        className="text-slate-400 hover:text-[#F2A03B] p-1 rounded-full">
                  <Icon name="reviews" tone="current" className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          {user && saved.length > 0 && q.trim().length < 2 && (
            <div className="p-2 border-b border-slate-100" data-testid="saved-searches">
              <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Saved searches</div>
              <div className="flex flex-wrap gap-1">
                {saved.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 text-xs font-semibold rounded-full pl-3 pr-1 py-1"
                        data-testid={`saved-search-${s.id}`}>
                    <button onClick={() => setQ(s.q)} className="hover:underline">{s.q}</button>
                    <button onClick={() => unpin(s.id)} disabled={pinBusy}
                            data-testid={`unpin-${s.id}`}
                            title="Unpin"
                            className="text-amber-600 hover:text-red-500 p-0.5 rounded-full">
                      <Icon name="close" tone="current" className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {user && suggestions.length > 0 && q.trim().length < 2 && (
            <div className="p-2 border-b border-slate-100" data-testid="search-suggestions">
              <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                <Icon name="trending-up" tone="current" className="h-3 w-3" /> What members search for
              </div>
              <div className="flex flex-wrap gap-1">
                {suggestions.map((s, i) => (
                  <button key={`sug-${i}`} onClick={() => setQ(s.q)}
                          data-testid={`suggestion-${i}`}
                          className="inline-flex items-center gap-1 bg-slate-50 text-slate-700 hover:bg-teal-50 hover:text-teal-800 text-xs font-semibold rounded-full px-3 py-1">
                    {s.q}
                    <span className="text-[10px] font-mono text-slate-400">×{s.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="max-h-[60vh] overflow-y-auto">
            {q.trim().length < 2 && (
              <div className="p-6 text-center text-sm text-slate-400" data-testid="topbar-search-hint">
                Type at least 2 characters to search.
              </div>
            )}
            {q.trim().length >= 2 && results && total === 0 && !loading && (
              <div className="p-6 text-center text-sm text-slate-400" data-testid="topbar-search-empty">
                Nothing found for "{q}"
              </div>
            )}
            {results?.posts?.length > 0 && (
              <div className="py-1">
                <div className="px-4 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                  <Icon name="message-square" tone="current" className="h-3 w-3" /> Community feed
                </div>
                {results.posts.map((p) => (
                  <button key={p.id} onClick={() => go("/feed")} data-testid={`search-result-post-${p.id}`}
                          className="w-full text-left px-4 py-2 hover:bg-slate-50">
                    <div className="text-sm font-semibold text-[#1F3F5B] truncate">{p.title || "(untitled)"}</div>
                    <div className="text-xs text-slate-500 truncate">{(p.body || "").slice(0, 120)}</div>
                  </button>
                ))}
              </div>
            )}
            {results?.discussions?.length > 0 && (
              <div className="py-1 border-t border-slate-100">
                <div className="px-4 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                  <Icon name="clipboard-check" tone="current" className="h-3 w-3" /> Community Hub
                </div>
                {results.discussions.map((d) => (
                  <Link key={d.id} to={`/community-hub/${d.id}`} onClick={() => setOpen(false)}
                        data-testid={`search-result-discussion-${d.id}`}
                        className="block px-4 py-2 hover:bg-slate-50">
                    <div className="text-sm font-semibold text-[#1F3F5B] truncate">{d.title}</div>
                    <div className="text-xs text-slate-500 truncate">{(d.body || "").slice(0, 120)}</div>
                  </Link>
                ))}
              </div>
            )}
            {results?.orgs?.length > 0 && (
              <div className="py-1 border-t border-slate-100">
                <div className="px-4 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                  <Icon name="org" tone="current" className="h-3 w-3" /> Clubs &amp; Orgs
                </div>
                {results.orgs.map((o) => (
                  <Link key={o.user_id} to={o.handle ? `/u/${o.handle}` : "/directory"} onClick={() => setOpen(false)}
                        data-testid={`search-result-org-${o.user_id}`}
                        className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
                    {o.logo ? <img src={o.logo} alt="" className="h-7 w-7 rounded-lg object-cover shrink-0" /> : <span className="h-7 w-7 rounded-lg bg-[#1F3F5B]/10 flex items-center justify-center shrink-0"><Icon name="org" tone="current" className="h-4 w-4 text-[#1F3F5B]" /></span>}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#1F3F5B] truncate">{o.org_name || o.name}</div>
                      <div className="text-xs text-slate-500 truncate">{(o.org_categories?.length ? o.org_categories[0] : o.org_category) || "Club / Org"}{o.primary_market ? ` · ${o.primary_market}` : ""}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            {results?.events?.length > 0 && (
              <div className="py-1 border-t border-slate-100">
                <div className="px-4 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                  <Icon name="calendar" tone="current" className="h-3 w-3" /> Events
                </div>
                {results.events.map((e) => (
                  <button key={e.id} onClick={() => go("/events")} data-testid={`search-result-event-${e.id}`}
                          className="w-full text-left px-4 py-2 hover:bg-slate-50">
                    <div className="text-sm font-semibold text-[#1F3F5B] truncate">{e.title}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {(e.starts_at || "").slice(0, 10)}{e.location ? ` · ${e.location}` : e.market ? ` · ${e.market}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
