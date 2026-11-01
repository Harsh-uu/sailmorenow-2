import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useMarket } from "@/context/MarketContext";
import { useAuth } from "@/context/AuthContext";
import Rating from "@/components/Rating";
import LogoCircle from "@/components/LogoCircle";
import WaveDivider from "@/components/WaveDivider";
import SectionEyebrow from "@/components/SectionEyebrow";
import MultiSelectPicker from "@/components/MultiSelectPicker";

function ProCard({ p }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const tier = p.tier || "basic";
  const isPremium = tier === "premium";
  const isOwner = !!user && user.user_id === p.user_id;
  // Per-tier card colour (navy Premium, teal Featured, white Basic) and ordering
  // are preserved; the tier NAME is never shown publicly.
  const base = isPremium
    ? "bg-[#1F3F5B] text-white border-2 border-[#F2A03B]"
    : tier === "featured"
      ? "bg-white dark:bg-slate-800 border-2 border-[#55B3AD]/60"
      : "bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700";
  const openCard = () => nav(`/directory/${p.user_id}`, { state: { from: "directory" } });
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openCard}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(); } }}
      data-testid={`pro-card-${p.user_id}`}
      className={`relative min-w-0 rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all block cursor-pointer ${base}`}
    >
      {isOwner && (
        <Link to="/boat-pro-listing" state={{ from: "directory" }} onClick={(e) => e.stopPropagation()}
          data-testid={`pro-card-edit-${p.user_id}`}
          className={`absolute top-4 right-4 inline-flex items-center gap-1.5 rounded-full px-3 min-h-[36px] text-xs font-bold ${isPremium ? "bg-white/15 text-white hover:bg-white/25" : "bg-slate-100 dark:bg-slate-700 text-[#1F3F5B] dark:text-slate-100 hover:bg-slate-200"}`}>
          <Icon name="edit" tone="current" className="h-3.5 w-3.5" /> Edit
        </Link>
      )}
      <div className={`flex items-center gap-4 min-w-0 ${isOwner ? "pr-20" : ""}`}>
        <LogoCircle
          src={p.logo_url || p.photo_url}
          size="h-14 w-14"
          alt={p.company_name}
          testId={`pro-avatar-${p.user_id}`}
          fallback={<span className={`font-display font-bold text-xl ${isPremium ? "text-[#1F3F5B]" : "smn-heading"}`}>{p.company_name?.[0] || "P"}</span>}
        />
        <div className="min-w-0">
          <h3 className={`font-display font-bold text-lg leading-tight flex items-center gap-1 ${isPremium ? "text-white" : "smn-heading"}`}>
            {p.company_name}
            {p.identity_verified && <Icon name="verified" tone="current" className={`h-4 w-4 shrink-0 ${isPremium ? "text-white" : "text-[#55B3AD]"}`} data-testid={`pro-verified-${p.user_id}`} />}
          </h3>
          {p.is_complete && <span title="This listing has all key details filled in — owners can trust it's ready to work with." className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide mt-1 px-1.5 py-0.5 rounded ${isPremium ? "bg-white/20 text-white" : "bg-teal-100 text-teal-900"}`} data-testid="complete-badge">✓ Complete listing</span>}
          <div className={`text-xs mt-1 truncate ${isPremium ? "text-slate-200" : "text-slate-500 dark:text-slate-400"}`}>
            {(p.categories || []).slice(0, 3).join(" · ")}
          </div>
          {p.handle && (
            <Link to={`/u/${p.handle}`} onClick={(e) => e.stopPropagation()}
                  data-testid={`pro-handle-${p.user_id}`}
                  className={`text-[11px] font-mono mt-1 inline-block hover:underline ${isPremium ? "text-slate-200" : "text-slate-500 dark:text-slate-400"}`}>
              @{p.handle}
            </Link>
          )}
        </div>
      </div>
      {(tier !== "basic") && p.short_bio && (
        <p className={`mt-4 text-sm line-clamp-3 ${isPremium ? "text-slate-200" : "text-slate-600 dark:text-slate-300"}`}>{p.short_bio}</p>
      )}
      <div className="mt-4 flex items-center justify-between">
        <Rating value={p.rating || 0} count={p.review_count || 0} />
        <span className={`text-xs ${isPremium ? "text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>{p.markets?.slice(0, 2).join(", ")}</span>
      </div>
    </div>
  );
}

export default function Directory() {
  const { market, setMarket } = useMarket();
  const { user } = useAuth();
  const [pros, setPros] = useState([]);
  const [q, setQ] = useState("");
  // Remember the last specialty selection on web too (mobile already persists).
  const [category, setCategory] = useState(() => localStorage.getItem("smn_dir_category") || "");
  const [categories, setCategories] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { localStorage.setItem("smn_dir_category", category); }, [category]);
  useEffect(() => { api.get("/markets").then(({ data }) => { setCategories(data.categories); setMarkets(data.markets || []); }); }, []);
  useEffect(() => {
    setLoading(true);
    api.get("/boat-pros", { params: { market, category: category || undefined, q: q || undefined } })
      .then(({ data }) => setPros(data))
      .finally(() => setLoading(false));
  }, [market, category, q]);

  return (
    <div data-testid="directory-page" className="bg-[var(--smn-bg)] dark:bg-slate-950">
      <section className="smn-hero text-white -mt-16 pt-24 sm:pt-28 pb-16 relative overflow-hidden">
        <img src="/icon-512.png" alt="" aria-hidden="true" className="hidden sm:block absolute -left-20 -bottom-16 w-[360px] opacity-10 pointer-events-none select-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionEyebrow tone="white" className="!text-[#55B3AD]">Marine service directory</SectionEyebrow>
          <div className="flex items-start justify-between gap-4 flex-wrap mt-3">
            <h1 className="font-display font-extrabold text-3xl sm:text-5xl tracking-tight">Trusted Boat Pros</h1>
            {user?.account_type === "boat_pro" && (
              <Link to="/boat-pro-listing" state={{ from: "directory" }} data-testid="directory-edit-my-listing"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#F2A03B] hover:bg-[#d98c30] text-white px-5 min-h-[44px] text-sm font-semibold shrink-0">
                <Icon name="edit" tone="current" className="h-4 w-4" /> Edit my listing
              </Link>
            )}
          </div>
          <p className="text-slate-300 mt-3 max-w-2xl">Riggers, mechanics, sailmakers, surveyors, and more — vetted by the PNW sailing community.</p>
        </div>
      </section>
      <WaveDivider className="text-[#17324a] dark:text-slate-950" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-12">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[240px]">
            <Icon name="search" tone="current" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              data-testid="directory-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by company or keyword…"
              className="w-full pl-10 pr-4 py-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:border-[#55B3AD] focus:ring-2 focus:ring-[#55B3AD]/20 outline-none"
            />
          </div>
          <MultiSelectPicker
            label="Market"
            title="Filter by market"
            testId="directory-market"
            single
            options={[{ value: "all", label: "All markets" }, ...markets.map((m) => ({ value: m, label: m }))]}
            value={[market]}
            onChange={(next) => setMarket(next[0] || "all")}
            ariaLabel={`Market: ${market === "all" ? "All markets" : market}`}
          />
          <MultiSelectPicker
            label="Specialty"
            title="Filter by specialty"
            testId="directory-category"
            single
            placeholder="All specialties"
            options={[{ value: "", label: "All specialties" }, ...categories.map((c) => ({ value: c, label: c }))]}
            value={[category]}
            onChange={(next) => setCategory(next[0] || "")}
            ariaLabel={`Specialty: ${category || "All specialties"}`}
          />
          {(market !== "all" || category) && (
            <button
              type="button"
              data-testid="directory-clear-filters"
              onClick={() => { setMarket("all"); setCategory(""); }}
              aria-label="Clear filters"
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--smn-border)] bg-[var(--smn-surface)] px-4 min-h-[44px] text-sm font-semibold text-[var(--smn-text)] hover:border-[#F2A03B] transition-colors"
            >
              <Icon name="close" tone="current" className="h-4 w-4 shrink-0 text-slate-400" /> Clear filters
            </button>
          )}
        </div>

        {!user && (
          <div data-testid="directory-guest-cta" className="mt-6 rounded-2xl border border-[#F2A03B]/40 bg-[#F2A03B]/[0.07] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="font-display font-bold smn-heading text-lg">Browsing as a guest</div>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">Contact details are hidden. Create a free account to message Boat Pros, see phone, email & website, and leave reviews.</p>
            </div>
            <Link to="/register" data-testid="directory-guest-signup" className="inline-flex items-center gap-2 bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-6 py-3 font-semibold shrink-0">
              Create an account <Icon name="arrow-right" tone="current" className="h-4 w-4" />
            </Link>
          </div>
        )}

        {!user && !loading && !category && !q ? (
          <div className="mt-8 space-y-10" data-testid="directory-guest-preview">
            {categories.map((cat) => {
              const inCat = pros.filter((p) => (p.categories || []).includes(cat)).slice(0, 3);
              if (inCat.length === 0) return null;
              return (
                <div key={cat} data-testid={`guest-cat-${cat}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display font-bold smn-heading text-xl">{cat}</h3>
                    <Link to="/register" className="text-sm font-semibold text-[#2A7871] dark:text-[#7fcac4] hover:underline">See all →</Link>
                  </div>
                  <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {inCat.map((p) => <ProCard key={p.user_id} p={p} />)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="pro-grid">
          {loading ? (
            <div className="col-span-full text-slate-500 dark:text-slate-400">Loading…</div>
          ) : pros.length === 0 ? (
            <div className="col-span-full text-slate-500 dark:text-slate-400">No Boat Pros found for these filters.</div>
          ) : pros.map((p) => <ProCard key={p.user_id} p={p} />)}
        </div>
        )}
      </div>
    </div>
  );
}
