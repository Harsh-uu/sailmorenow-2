import { useEffect, useState, useRef } from "react";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { canInteract } from "@/lib/plan";
import { useAuth } from "@/context/AuthContext";
import { useMarket } from "@/context/MarketContext";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router-dom";
import { ICON_VERIFIED } from "@/lib/api";
import PostComments from "@/components/PostComments";
import FlagButton from "@/components/FlagButton";
import AdminControls from "@/components/AdminControls";
import Avatar from "@/components/Avatar";
import Sparkline from "@/components/Sparkline";
import Reactions from "@/components/Reactions";
import { PartnerBadge } from "@/components/PartnerBadge";
import Linkify from "@/lib/linkify";
import MultiPhotoUploader from "@/components/MultiPhotoUploader";
import DeleteListingButton from "@/components/DeleteListingButton";
import AuthorActions from "@/components/AuthorActions";
import SaveButton, { useSaved } from "@/components/SaveButton";
import AuthorLink from "@/components/AuthorLink";
import AuthorBlock, { authorFromDoc } from "@/components/AuthorBlock";
import PostingAs from "@/components/PostingAs";
import FilterButton from "@/components/FilterButton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ACCOUNT_LABEL = { sailor: "Sailor", boat_owner: "Boat Owner", boat_pro: "Boat Pro", partner: "Community Partner" };
const CONDITIONS = ["New", "Like New", "Good", "Fair", "For parts"];
const MONTH_FMT = (d) => new Date(d).toLocaleString(undefined, { month: "long", year: "numeric" });
const monthKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`; };

function ActivityDot({ last_active_at }) {
  if (!last_active_at) return null;
  const days = (Date.now() - new Date(last_active_at).getTime()) / 86400000;
  const [color, label] = days <= 1 ? ["bg-emerald-500", "Active today"]
    : days <= 7 ? ["bg-teal-500", "Active this week"]
    : days <= 30 ? ["bg-slate-400", "Active this month"]
    : ["bg-slate-300", "Dormant"];
  return <span title={label} className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

const TYPES = [
  { id: "sailing_opportunity", label: "Sailing opportunity" },
  { id: "volunteer_opportunity", label: "Volunteer opportunity" },
  { id: "general", label: "General" },
];

const EMPTY_DRAFT = { type: "sailing_opportunity", title: "", body: "", market: "", allow_comments: true, price: "", condition: "", free: false, image_urls: [], identity: "personal" };

function FilterChip({ label, onRemove, testId }) {
  return (
    <span data-testid={testId} className="inline-flex items-center gap-1 rounded-full bg-[var(--smn-surface)] text-[var(--smn-text)] border border-[var(--smn-border)] pl-3 pr-1.5 py-1 text-xs font-semibold">
      <span className="truncate max-w-[10rem]">{label}</span>
      <button onClick={onRemove} data-testid={`${testId}-remove`} aria-label={`Remove ${label}`} className="inline-flex items-center justify-center h-5 w-5 rounded-full hover:bg-[var(--smn-border)]"><Icon name="close" tone="current" className="h-3 w-3" /></button>
    </span>
  );
}

export default function Feed({ lockType = null }) {
  const { user } = useAuth();
  const { market, setMarket } = useMarket();
  const { isSaved, toggle: toggleSaved } = useSaved();
  const [posts, setPosts] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [sp] = useSearchParams();
  const qType = !lockType && TYPES.some((t) => t.id === sp.get("type")) ? sp.get("type") : "";
  const [type, setType] = useState(lockType || qType || "");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT, type: lockType || "sailing_opportunity" });
  const [loading, setLoading] = useState(true);
  const [trending, setTrending] = useState([]);
  const [textFilter, setTextFilter] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const articleRefs = useRef({});
  // Expanding/collapsing keeps the post's header in view (just under the sticky
  // month bar) instead of jumping the page.
  const scrollToArticle = (id) => {
    requestAnimationFrame(() => {
      const el = articleRefs.current[id];
      if (!el) return;
      const y = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: y, behavior: "smooth" });
    });
  };
  const expandPost = (id) => { setExpandedId(id); scrollToArticle(id); };
  const collapsePost = (id) => { setExpandedId(null); scrollToArticle(id); };
  const [toolsOpenId, setToolsOpenId] = useState(null);
  const [collapsedMonths, setCollapsedMonths] = useState({});
  const [jumpMonth, setJumpMonth] = useState("");
  const [mpQ, setMpQ] = useState("");
  const [mpMin, setMpMin] = useState("");
  const [mpMax, setMpMax] = useState("");
  const [mpCond, setMpCond] = useState("");
  // Draft copies edited inside the Filters panel; committed on Apply.
  const [fpOpen, setFpOpen] = useState(false);
  const [dMpQ, setDMpQ] = useState("");
  const [dMpMin, setDMpMin] = useState("");
  const [dMpMax, setDMpMax] = useState("");
  const [dMpCond, setDMpCond] = useState("");
  const mpActiveCount = [mpQ, mpMin, mpMax, mpCond].filter((v) => v !== "").length;
  const openFilters = () => { setDMpQ(mpQ); setDMpMin(mpMin); setDMpMax(mpMax); setDMpCond(mpCond); setFpOpen(true); };
  const applyFilters = () => { setMpQ(dMpQ.trim()); setMpMin(dMpMin); setMpMax(dMpMax); setMpCond(dMpCond); setFpOpen(false); };
  const clearFilters = () => { setMpQ(""); setMpMin(""); setMpMax(""); setMpCond(""); setDMpQ(""); setDMpMin(""); setDMpMax(""); setDMpCond(""); };

  useEffect(() => { api.get("/markets").then(({ data }) => { setMarkets(data.markets); }); }, []);
  useEffect(() => {
    api.get("/searches/suggestions").then(({ data }) => setTrending(data.suggestions || [])).catch(() => {});
  }, []);
  // Deep link from Crew Bank's "Add a sailing opportunity": open the existing
  // composer with the type preselected (draft defaults to sailing_opportunity).
  const composeHandled = useRef(false);
  useEffect(() => {
    if (composeHandled.current || !user) return;
    if (sp.get("compose") === "1" && !lockType) {
      composeHandled.current = true;
      setDraft((d) => ({ ...d, type: qType || "sailing_opportunity", identity: user.active_identity || "personal" }));
      setCreating(true);
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => {
    setLoading(true);
    const params = { market, type: (lockType || type) || undefined };
    if (lockType === "for_sale") {
      if (mpQ.trim()) params.q = mpQ.trim();
      if (mpMin !== "") params.min_price = Number(mpMin);
      if (mpMax !== "") params.max_price = Number(mpMax);
      if (mpCond) params.condition = mpCond;
    }
    api.get("/posts", { params })
      .then(({ data }) => setPosts(data)).finally(() => setLoading(false));
  };
  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
  }, [market, type, mpQ, mpMin, mpMax, mpCond]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = (textFilter
    ? posts.filter((p) => {
        const hay = ((p.title || "") + " " + (p.body || "")).toLowerCase();
        return hay.includes(textFilter.toLowerCase());
      })
    : posts).filter((p) => lockType ? true : p.type !== "for_sale");
  // On the Marketplace, sold listings drop to the bottom.
  if (lockType === "for_sale") filtered.sort((a, b) => (a.sold ? 1 : 0) - (b.sold ? 1 : 0));

  const submit = async () => {
    if (!user) return toast.error("Sign in to post");
    if (editingId) {
      if (!draft.body.trim()) return toast.error("Body can't be empty");
      try {
        const { data } = await api.patch(`/posts/${editingId}`, { body: draft.body.trim() });
        setPosts((cur) => cur.map((x) => x.id === editingId ? { ...x, ...data } : x));
        toast.success("Saved");
        setEditingId(null);
        setCreating(false);
        setDraft({ ...EMPTY_DRAFT, type: lockType || "sailing_opportunity" });
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Couldn't save");
      }
      return;
    }
    if (!draft.title || !draft.body || !draft.market) return toast.error("Fill title, body, and market");
    try {
      const payload = {
        ...draft,
        image_urls: draft.type === "for_sale" ? (draft.image_urls || []) : undefined,
        image_url: draft.type === "for_sale" && draft.image_urls?.length ? draft.image_urls[0] : undefined,
        price: draft.type === "for_sale" && draft.price !== "" ? Number(draft.price) : null,
        condition: draft.type === "for_sale" ? (draft.condition || null) : null,
        identity: draft.identity || undefined,
      };
      await api.post("/posts", payload);
      toast.success("Posted!");
      setDraft({ ...EMPTY_DRAFT, type: lockType || "sailing_opportunity" });
      setCreating(false);
      load();
    } catch (e) {
      if (e?.upgradeHandled) return;
      const msg = e?.response?.data?.detail || "Failed";
      toast.error(msg);
    }
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setDraft({ ...EMPTY_DRAFT, type: p.type, title: p.title || "", body: p.body || "", market: p.market || "", identity: p.author_identity || "personal" });
    setCreating(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Group the visible posts under month headings, newest first. The current
  // month is expanded; older months start collapsed.
  const groups = (() => {
    const map = new Map();
    for (const p of filtered) {
      const k = monthKey(p.created_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  })();
  const currentMonthKey = monthKey(new Date());
  const markSold = async (id) => {
    try {
      const { data } = await api.post(`/posts/${id}/sold`);
      setPosts((cur) => cur.map((p) => p.id === id ? { ...p, sold: data.sold } : p));
      toast.success(data.sold ? "Marked as sold" : "Marked available");
    } catch { toast.error("Couldn't update"); }
  };
  const toggleFoundCrew = async (p) => {
    const next = !p.found_crew;
    setPosts((cur) => cur.map((x) => x.id === p.id ? { ...x, found_crew: next } : x));
    try {
      await api.post(`/posts/${p.id}/${next ? "found-crew" : "still-looking"}`);
      toast.success(next ? "Marked as crew found" : "Back to looking for crew");
    } catch {
      setPosts((cur) => cur.map((x) => x.id === p.id ? { ...x, found_crew: !next } : x));
      toast.error("Couldn't update");
    }
  };
  const saveSearch = async () => {
    try {
      await api.post("/marketplace/searches", {
        q: mpQ.trim() || null, condition: mpCond || null,
        min_price: mpMin !== "" ? Number(mpMin) : null,
        max_price: mpMax !== "" ? Number(mpMax) : null, market,
      });
      toast.success("Search saved — we'll notify you when matching gear is listed");
    } catch (e) { toast.error(e?.response?.data?.detail || "Add a filter first"); }
  };
  const lowerPrice = async (p) => {
    const next = window.prompt(`Lower the price for "${p.title}" (current $${p.price ?? "?"})`, p.price ?? "");
    if (next === null) return;
    const val = Number(next);
    if (Number.isNaN(val) || val < 0) return toast.error("Enter a valid price");
    try {
      const { data } = await api.post(`/posts/${p.id}/price`, { price: val });
      setPosts((cur) => cur.map((x) => x.id === p.id ? { ...x, price: val, prev_price: data.price_dropped ? p.price : x.prev_price, price_dropped_at: data.price_dropped ? new Date().toISOString() : x.price_dropped_at } : x));
      toast.success(data.price_dropped ? "Price dropped — bumped to the top" : "Price updated");
    } catch { toast.error("Couldn't update price"); }
  };
  const isCollapsed = (k) => (k in collapsedMonths ? collapsedMonths[k] : k !== currentMonthKey);
  const toggleMonth = (k) => setCollapsedMonths((m) => ({ ...m, [k]: !isCollapsed(k) }));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="feed-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#55B3AD]">Community feed</div>
          <h1 className="font-display font-extrabold text-[#1F3F5B] text-3xl sm:text-4xl mt-1">Get on the water.</h1>
        </div>
        {user && (
          <button
            onClick={() => { if (!creating) setDraft((d) => ({ ...d, identity: user.active_identity || "personal" })); setCreating(!creating); }}
            data-testid="new-post-btn"
            className="inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2.5 font-semibold"
          >
            <Icon name="add" tone="current" className="h-4 w-4" /> New post
          </button>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3" data-testid="feed-controls">
        {!lockType && (
          <Select value={type || "all"} onValueChange={(v) => setType(v === "all" ? "" : v)}>
            <SelectTrigger data-testid="feed-type" aria-label="Post type" className="w-[210px] rounded-full border-[var(--smn-border)] bg-[var(--smn-surface)] min-h-[44px] px-4 text-sm font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" data-testid="type-opt-all">All posts</SelectItem>
              {TYPES.map((t) => <SelectItem key={t.id} value={t.id} data-testid={`type-opt-${t.id}`}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={market} onValueChange={setMarket}>
          <SelectTrigger data-testid="feed-market" aria-label="Market" className="w-[180px] rounded-full border-[var(--smn-border)] bg-[var(--smn-surface)] min-h-[44px] px-4 text-sm font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="market-opt-all">All markets</SelectItem>
            {markets.map((m) => <SelectItem key={m} value={m} data-testid={`market-opt-${m}`}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        {lockType === "for_sale" && (
          <Popover open={fpOpen} onOpenChange={(o) => (o ? openFilters() : setFpOpen(false))}>
            <PopoverTrigger asChild>
              <FilterButton count={mpActiveCount} testId="marketplace-filters-btn" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 rounded-2xl border-[var(--smn-border)] bg-[var(--smn-surface)] p-4" data-testid="marketplace-filters-panel">
              <div className="text-xs font-bold uppercase tracking-widest text-[var(--smn-text-muted)] mb-2">Filters</div>
              <div className="flex items-center gap-2 rounded-xl border border-[var(--smn-border)] px-3 py-2 mb-3">
                <Icon name="search" tone="current" className="h-4 w-4 text-[var(--smn-text-muted)]" />
                <input value={dMpQ} onChange={(e) => setDMpQ(e.target.value)} data-testid="marketplace-search" placeholder="Search gear…" className="flex-1 bg-transparent text-sm outline-none text-[var(--smn-text)]" />
              </div>
              <div className="flex items-center gap-2 mb-3">
                <input type="number" min="0" value={dMpMin} onChange={(e) => setDMpMin(e.target.value)} data-testid="marketplace-min-price" placeholder="Min $" className="w-full rounded-xl border border-[var(--smn-border)] bg-transparent px-3 py-2 text-sm outline-none text-[var(--smn-text)]" />
                <input type="number" min="0" value={dMpMax} onChange={(e) => setDMpMax(e.target.value)} data-testid="marketplace-max-price" placeholder="Max $" className="w-full rounded-xl border border-[var(--smn-border)] bg-transparent px-3 py-2 text-sm outline-none text-[var(--smn-text)]" />
              </div>
              <div className="mb-4">
                <Select value={dMpCond || "any"} onValueChange={(v) => setDMpCond(v === "any" ? "" : v)}>
                  <SelectTrigger data-testid="marketplace-condition" aria-label="Condition" className="w-full rounded-xl border-[var(--smn-border)] bg-transparent text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any condition</SelectItem>
                    {CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <button onClick={clearFilters} data-testid="marketplace-clear" className="text-sm font-semibold text-[var(--smn-text-secondary)] hover:text-[var(--smn-text)]">Clear</button>
                <div className="flex items-center gap-3">
                  {user && <button onClick={saveSearch} data-testid="save-search-btn" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--smn-navy)] hover:opacity-80"><Icon name="bell" tone="current" className="h-4 w-4" /> Save</button>}
                  <button onClick={applyFilters} data-testid="marketplace-apply" className="rounded-full bg-[var(--smn-navy)] text-white px-5 min-h-[40px] text-sm font-semibold">Apply</button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {lockType === "for_sale" && mpActiveCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="marketplace-active-filters">
          {mpQ && <FilterChip label={`"${mpQ}"`} onRemove={() => setMpQ("")} testId="active-q" />}
          {mpMin !== "" && <FilterChip label={`Min $${mpMin}`} onRemove={() => setMpMin("")} testId="active-min" />}
          {mpMax !== "" && <FilterChip label={`Max $${mpMax}`} onRemove={() => setMpMax("")} testId="active-max" />}
          {mpCond && <FilterChip label={mpCond} onRemove={() => setMpCond("")} testId="active-cond" />}
        </div>
      )}

      {trending.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="trending-topics">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 inline-flex items-center gap-1">
            <Icon name="trending-up" tone="current" className="h-3 w-3" /> Trending
          </span>
          {trending.map((t, i) => (
            <button key={`t-${i}`} onClick={() => setTextFilter(t.q === textFilter ? "" : t.q)}
                    data-testid={`trending-${i}`}
                    className={`inline-flex items-center gap-2 rounded-full text-xs font-semibold px-3 py-1 border transition-colors ${t.q === textFilter
                      ? "bg-teal-600 text-white border-teal-600"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-teal-50 hover:border-teal-300"}`}>
              {t.q}
              {Array.isArray(t.trend) && t.trend.length > 0 && (
                <Sparkline data={t.trend} width={44} height={14}
                           color={t.q === textFilter ? "#ffffff" : "#F2A03B"}
                           testId={`trending-spark-${i}`} />
              )}
              <span className="text-[10px] font-mono text-slate-500">×{t.count}</span>
            </button>
          ))}
          {textFilter && (
            <button onClick={() => setTextFilter("")} data-testid="trending-clear"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-red-500">
              <Icon name="close" tone="current" className="h-3 w-3" /> clear
            </button>
          )}
        </div>
      )}

      {creating && user && (
        <div className="mt-6 bg-white rounded-2xl p-6 border border-slate-100" data-testid="new-post-form">
          {editingId && <div className="text-sm font-bold text-[#1F3F5B] mb-3" data-testid="post-edit-heading">Edit post</div>}
          {!editingId && <PostingAs value={draft.identity} onChange={(id) => setDraft({ ...draft, identity: id })} testId="post-posting-as" />}
          <div className="flex flex-wrap gap-2 mt-3" style={(lockType || editingId) ? { display: "none" } : undefined}>
            {TYPES.map((t) => (
              <button key={t.id} onClick={() => setDraft({ ...draft, type: t.id })} className={`px-3 py-1.5 rounded-full text-sm border ${draft.type === t.id ? "bg-[#1F3F5B] text-white border-[#1F3F5B]" : "bg-white border-slate-200"}`}>{t.label}</button>
            ))}
          </div>
          <input value={draft.title} readOnly={!!editingId} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title" data-testid="post-title" className={`mt-4 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none ${editingId ? "bg-slate-50 text-slate-500" : ""}`} />
          <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={4} placeholder="Tell the community more…" data-testid="post-body" className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none" />
          {editingId ? (
            <div className="mt-3 text-xs text-slate-500" data-testid="post-edit-market">Market: <span className="font-semibold text-slate-700">{draft.market || "All markets"}</span> (cannot be changed)</div>
          ) : (
          <select value={draft.market} onChange={(e) => setDraft({ ...draft, market: e.target.value })} data-testid="post-market" className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2">
            <option value="">Select market…</option>
            {markets.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          )}
          {draft.type === "for_sale" && (
            <div className="mt-3 space-y-2" data-testid="for-sale-fields">
              <div className="grid grid-cols-2 gap-3">
                <input type="number" min="0" step="1" value={draft.free ? "" : draft.price} disabled={draft.free} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder={draft.free ? "Free" : "Price (USD)"} data-testid="post-price" className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-[#55B3AD] outline-none disabled:bg-slate-50 disabled:text-slate-400" />
                <select value={draft.condition} onChange={(e) => setDraft({ ...draft, condition: e.target.value })} data-testid="post-condition" className="w-full rounded-xl border border-slate-200 px-3 py-2">
                  <option value="">Condition…</option>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                <input type="checkbox" checked={!!draft.free} onChange={(e) => setDraft({ ...draft, free: e.target.checked, price: e.target.checked ? "0" : "" })} data-testid="post-free" className="h-4 w-4 rounded border-slate-300 text-[#1F3F5B]" />
                List this as Free
              </label>
            </div>
          )}
          {draft.type === "for_sale" && (
            <div className="mt-3" data-testid="for-sale-photos">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Photos (up to 6)</div>
              <MultiPhotoUploader value={draft.image_urls} onChange={(urls) => setDraft({ ...draft, image_urls: urls })} max={6} />
            </div>
          )}
          {!editingId && (
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" data-testid="post-allow-comments" checked={draft.allow_comments} onChange={(e) => setDraft({ ...draft, allow_comments: e.target.checked })} />
            Allow comments on this post
          </label>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => { setCreating(false); setEditingId(null); }} className="text-slate-600 px-4 py-2 rounded-full hover:bg-slate-100">Cancel</button>
            <button onClick={submit} data-testid="submit-post" className="bg-[#1F3F5B] hover:bg-[#152a3d] text-white rounded-full px-5 py-2 font-semibold">{editingId ? "Save changes" : "Post"}</button>
          </div>
          {!editingId && !canInteract(user) && user.account_type === "partner" && <p className="mt-3 text-xs text-slate-500">Free organizations: 1 post per month, and a marketplace listing counts as that post. <a className="text-[#F2A03B] font-semibold" href="/pricing">Become a Community Partner</a> for unlimited posts.</p>}
        </div>
      )}

      {!loading && groups.length > 1 && (
        <div className="mt-6 flex items-center gap-2" data-testid="month-jump">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Jump to</span>
          <select value={jumpMonth} onChange={(e) => { const k = e.target.value; setJumpMonth(k); if (k) { setCollapsedMonths((m) => ({ ...m, [k]: false })); const el = document.getElementById(`month-${k}`); el?.scrollIntoView({ behavior: "smooth", block: "start" }); } }}
                  data-testid="month-jump-select" className="rounded-full border border-slate-200 px-3 py-1.5 text-sm">
            <option value="">Month…</option>
            {groups.map(([k, items]) => <option key={k} value={k}>{MONTH_FMT(items[0].created_at)} ({items.length})</option>)}
          </select>
        </div>
      )}

      <div className="mt-8 space-y-6">
        {loading ? <div className="text-slate-500">Loading…</div> : filtered.length === 0 ? (
          <div className="text-center rounded-xl border border-dashed border-[var(--smn-border)] p-8" data-testid="feed-empty">
            <p className="text-[var(--smn-text-secondary)]">{textFilter ? `No posts match "${textFilter}".` : lockType === "for_sale" ? "No gear matches these filters." : "No posts yet in this market."}</p>
            {(textFilter || (lockType === "for_sale" && mpActiveCount > 0)) && (
              <button onClick={() => { setTextFilter(""); clearFilters(); }} data-testid="feed-clear-filters"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--smn-border)] px-4 min-h-[40px] text-sm font-semibold text-[var(--smn-text)] hover:border-[var(--smn-teal)]">
                <Icon name="close" tone="current" className="h-4 w-4" /> Clear filters
              </button>
            )}
          </div>
        ) : groups.map(([k, items]) => (
          <section key={k} id={`month-${k}`} data-testid={`month-group-${k}`}>
            <button onClick={() => toggleMonth(k)} data-testid={`month-toggle-${k}`}
                    className="w-full flex items-center justify-between gap-2 text-left sticky top-16 z-10 bg-[var(--smn-bg,white)]/90 backdrop-blur py-2">
              <span className="font-display font-extrabold text-[#1F3F5B] text-lg flex items-center gap-2">
                <Icon name={isCollapsed(k) ? "chevron-right" : "chevron-down"} tone="current" className="h-4 w-4" />
                {MONTH_FMT(items[0].created_at)}
              </span>
              <span className="text-xs text-slate-400">{items.length} {items.length === 1 ? "post" : "posts"}</span>
            </button>
            {!isCollapsed(k) && (
              <div className="mt-3 space-y-4">
                {items.map((p) => {
                  const expanded = expandedId === p.id;
                  const isForSale = p.type === "for_sale";
                  return (
                  <article key={p.id} ref={(el) => { articleRefs.current[p.id] = el; }} className={`rounded-2xl p-6 border shadow-sm transition-colors ${p.sold ? "bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 opacity-75 saturate-50" : "bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700"}`} data-testid={`post-${p.id}`}>
                    {isForSale && p.sold && <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest px-3 py-1 rounded-full bg-slate-700 text-white" data-testid={`sold-badge-${p.id}`}><Icon name="check" tone="current" className="h-3.5 w-3.5" /> Sold</div>}
                    {isForSale && !p.sold && p.price_dropped_at && (Date.now() - new Date(p.price_dropped_at).getTime()) < 7 * 86400000 && (
                      <div className="mb-2 ml-1 inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-[#F2A03B] text-white" data-testid={`price-drop-badge-${p.id}`}>Price drop</div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                      <AuthorBlock
                        {...authorFromDoc(p)}
                        size="h-9 w-9"
                        testId={`author-${p.id}`}
                        nameClassName="text-sm font-semibold text-slate-800"
                        extras={p.author_identity !== "business" ? (
                          <>
                            {p.author_verified && <img src={ICON_VERIFIED} alt="Verified" title="Identity verified" className="h-4 w-4" />}
                            <PartnerBadge kind={p.author_partner_badge} />
                            <ActivityDot last_active_at={p.author_last_active_at} />
                          </>
                        ) : null}
                        subline={(
                          <div className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                            {p.author_identity !== "business" && p.author_account_type && (
                              <span className="inline-block text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                {ACCOUNT_LABEL[p.author_account_type] || p.author_account_type}
                              </span>
                            )}
                            <span>{p.market} · {new Date(p.created_at).toLocaleDateString()}{p.edited_at ? " · edited" : ""}</span>
                          </div>
                        )}
                      />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:ml-auto">
                      {user && p.author_id && p.author_id !== user.user_id && (
                        <Link to={`/messages?to=${p.author_id}`} onClick={(e) => e.stopPropagation()} data-testid={`contact-author-${p.id}`}
                          className="inline-flex items-center gap-1 h-7 text-xs font-semibold text-[#1F3F5B] hover:text-[#152a3d] rounded-full border border-slate-200 px-3">
                          <Icon name="message-square" tone="current" className="h-3.5 w-3.5" /> Contact
                        </Link>
                      )}
                      {isForSale && !p.sold && user && p.author_id && p.author_id !== user.user_id && (
                        <Link to={`/messages?to=${p.author_id}${typeof p.price === "number" ? `&offer=${p.price}` : ""}`} onClick={(e) => e.stopPropagation()} data-testid={`make-offer-${p.id}`}
                          className="inline-flex items-center gap-1 h-7 text-xs font-semibold text-white bg-[#2A7871] hover:bg-[#23635d] rounded-full px-3">
                          <Icon name="tag" tone="current" className="h-3.5 w-3.5" /> Make an offer
                        </Link>
                      )}
                      <FlagButton targetType="post" targetId={p.id} hidden={user?.user_id === p.author_id} size="xs" label="" />
                      {!(isForSale && user?.user_id === p.author_id) && (
                        <AdminControls entity="post" item={p} compact
                          onChanged={(next) => setPosts((cur) => next ? cur.map((x) => x.id === p.id ? next : x) : cur.filter((x) => x.id !== p.id))} />
                      )}
                      {!isForSale && (
                        <AuthorActions canEdit={p.can_edit} canDelete={p.can_delete} noun="post" testIdBase={`post-${p.id}`}
                          onEdit={() => startEdit(p)} deleteUrl={`/posts/${p.id}`}
                          onDeleted={() => setPosts((cur) => cur.filter((x) => x.id !== p.id))} />
                      )}
                      <SaveButton targetType="post" targetId={p.id} saved={isSaved(p.id)} onToggle={toggleSaved} size="xs" />
                      {isForSale && user?.user_id === p.author_id && (
                        <button onClick={(e) => { e.stopPropagation(); setToolsOpenId(toolsOpenId === p.id ? null : p.id); }} data-testid={`owner-edit-toggle-${p.id}`}
                          className="inline-flex items-center gap-1 h-7 text-[10px] font-bold uppercase tracking-widest px-3 rounded-full border border-[#1F3F5B] text-[#1F3F5B] dark:border-[#8Fb4d6] dark:text-[#8Fb4d6] hover:bg-[#1F3F5B]/5">
                          <Icon name="edit" tone="current" className="h-3 w-3" /> Edit
                          <Icon name={toolsOpenId === p.id ? "chevron-up" : "chevron-down"} tone="current" className="h-3 w-3" />
                        </button>
                      )}
                      <span className={`inline-flex items-center h-7 leading-none text-[10px] font-bold uppercase tracking-widest px-2.5 rounded-full ${p.type === "volunteer_opportunity" ? "bg-orange-100 text-orange-900" : isForSale ? "bg-emerald-100 text-emerald-900" : "bg-teal-100 text-teal-900"}`}>
                        {(p.type || "post").replace("_", " ")}
                      </span>
                      </div>
                    </div>
                    {p.type === "sailing_opportunity" && (p.found_crew || user?.user_id === p.author_id) && (
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        {p.found_crew && (
                          <span data-testid={`crew-found-tag-${p.id}`} className="inline-flex items-center gap-1 h-7 text-[10px] font-bold uppercase tracking-widest px-2.5 rounded-full bg-teal-100 text-teal-900">
                            <Icon name="check" tone="current" className="h-3 w-3" /> Crew found
                          </span>
                        )}
                        {user?.user_id === p.author_id && (
                          <button onClick={(e) => { e.stopPropagation(); toggleFoundCrew(p); }} data-testid={`found-crew-toggle-${p.id}`}
                            className="inline-flex items-center h-7 text-[10px] font-bold uppercase tracking-widest px-3 rounded-full border border-[#55B3AD] text-[#2A7871] hover:bg-[#55B3AD]/10">
                            {p.found_crew ? "Still looking" : "Found crew"}
                          </button>
                        )}
                      </div>
                    )}
                    {isForSale && user?.user_id === p.author_id && toolsOpenId === p.id && (
                      <div className="flex flex-wrap items-center gap-2 mt-3" data-testid={`owner-tools-${p.id}`}>
                        <button onClick={() => markSold(p.id)} data-testid={`mark-sold-${p.id}`}
                          className="inline-flex items-center h-7 text-[10px] font-bold uppercase tracking-widest px-3 rounded-full border border-[#55B3AD] text-[#2A7871] hover:bg-[#55B3AD]/10">
                          {p.sold ? "Mark available" : "Mark sold"}
                        </button>
                        {!p.sold && (
                          <button onClick={() => lowerPrice(p)} data-testid={`lower-price-${p.id}`}
                            className="inline-flex items-center h-7 text-[10px] font-bold uppercase tracking-widest px-3 rounded-full border border-[#F2A03B] text-[#d98c30] hover:bg-[#F2A03B]/10">
                            Lower price
                          </button>
                        )}
                        <Link to={`/community/listing/${p.id}/edit`} data-testid={`edit-listing-${p.id}`}
                          className="inline-flex items-center h-7 text-[10px] font-bold uppercase tracking-widest px-3 rounded-full border border-[#1F3F5B] text-[#1F3F5B] dark:border-[#8Fb4d6] dark:text-[#8Fb4d6] hover:bg-[#1F3F5B]/5">
                          Edit details
                        </Link>
                        <DeleteListingButton post={p} onDeleted={(delId) => setPosts((cur) => cur.filter((x) => x.id !== delId))} />
                      </div>
                    )}
                    <div className="cursor-pointer" onClick={() => { if (!expanded) expandPost(p.id); }} data-testid={`post-toggle-${p.id}`}>
                      <h3 className="font-display font-bold text-lg text-[#1F3F5B] mt-3 flex items-center gap-2">
                        {p.title}
                        {isForSale && typeof p.price === "number" && <span className="text-sm font-extrabold text-emerald-700" data-testid={`post-price-${p.id}`}>{p.price === 0 ? "Free" : `$${p.price.toLocaleString()}`}</span>}
                        {isForSale && typeof p.prev_price === "number" && p.price_dropped_at && p.prev_price > (p.price ?? 0) && <span className="text-xs font-semibold text-slate-400 line-through" data-testid={`post-prevprice-${p.id}`}>${p.prev_price.toLocaleString()}</span>}
                      </h3>
                      {isForSale && p.condition && <div className="text-xs text-slate-500 mt-0.5" data-testid={`post-condition-${p.id}`}>Condition: {p.condition}</div>}
                      <p className={`mt-2 text-slate-700 leading-relaxed whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-2"}`}>
                        <Linkify text={p.body} />
                      </p>
                      {!expanded && <span className="text-xs font-semibold text-[#55B3AD]">Read more</span>}
                    </div>
                    {/* Marketplace listing photo shows in the feed automatically; no placeholder when there's none. */}
                    {isForSale && !expanded && p.image_url && (
                      <img src={p.image_url} alt={p.title} className="mt-3 w-full max-h-72 object-cover rounded-xl" data-testid={`post-thumb-${p.id}`} />
                    )}
                    {expanded && (p.image_urls?.length > 1 ? (
                      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" data-testid={`post-gallery-${p.id}`}>
                        {p.image_urls.map((u, gi) => <img key={gi} src={u} alt={`${p.title} ${gi + 1}`} className="h-56 rounded-xl object-cover shrink-0" data-testid={`post-image-${p.id}-${gi}`} />)}
                      </div>
                    ) : (p.image_url && <img src={p.image_url} alt={p.title} className="mt-3 w-full max-h-96 object-cover rounded-xl" data-testid={`post-image-${p.id}`} />))}
                    {expanded && <>
                      <div className="mt-4"><Reactions targetType="post" targetId={p.id} /></div>
                      <PostComments post={p} defaultOpen />
                      <button onClick={() => collapsePost(p.id)} data-testid={`show-less-${p.id}`}
                              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#55B3AD] hover:text-[#2A7871]">
                        <Icon name="chevron-up" tone="current" className="h-3.5 w-3.5" /> Show less
                      </button>
                    </>}
                  </article>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
