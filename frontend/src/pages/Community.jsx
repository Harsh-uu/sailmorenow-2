import { useSearchParams } from "react-router-dom";
import Feed from "@/pages/Feed";
import CommunityHub from "@/pages/CommunityHub";

const TABS = [
  { id: "feed", label: "Feed" },
  { id: "marketplace", label: "Marketplace" },
  { id: "forum", label: "Forum" },
  { id: "blog", label: "Blog" },
];

// Unified Community surface — mirrors the mobile layout: one page, three tabs
// (Feed / Forum / Blog). Replaces the old separate Feed and Hub pages.
export default function Community() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "feed";
  const select = (id) => { setParams(id === "feed" ? {} : { tab: id }, { replace: true }); };

  return (
    <div data-testid="community-page">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#55B3AD]">Community</div>
        <div className="mt-3 inline-flex rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1" data-testid="community-tabs">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => select(t.id)} data-testid={`community-tab-${t.id}`}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${tab === t.id ? "bg-[#1F3F5B] dark:bg-[#F2A03B] text-white" : "text-slate-600 dark:text-slate-300 hover:text-[#1F3F5B] dark:hover:text-white"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "feed" && <Feed />}
      {tab === "marketplace" && <Feed lockType="for_sale" />}
      {tab === "forum" && <CommunityHub embedded lockKind="forum" />}
      {tab === "blog" && <CommunityHub embedded lockKind="blog" />}
    </div>
  );
}
