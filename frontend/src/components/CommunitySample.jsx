import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";
import Avatar from "@/components/Avatar";
import SectionEyebrow from "@/components/SectionEyebrow";
import { useMarket } from "@/context/MarketContext";

const INCLUDE_TYPES = new Set(["general", "update", "note", "discussion", "volunteer_opportunity"]);

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(diff / 3600000);
  if (h > 0) return `${h}h ago`;
  const m = Math.floor(diff / 60000);
  return m > 0 ? `${m}m ago` : "just now";
}

// Rotate the sample window so repeat visitors see fresh posts each visit.
function rotate(list, size) {
  if (list.length <= size) return list;
  let n = 0;
  try { n = parseInt(localStorage.getItem("smn_feed_rot") || "0", 10) || 0; localStorage.setItem("smn_feed_rot", String(n + 1)); } catch {}
  const start = (n * size) % list.length;
  const out = [];
  for (let i = 0; i < size; i++) out.push(list[(start + i) % list.length]);
  return out;
}

export default function CommunitySample() {
  const nav = useNavigate();
  const { market } = useMarket();
  const [posts, setPosts] = useState(null);

  useEffect(() => {
    api.get("/posts").then(({ data }) => {
      let list = (Array.isArray(data) ? data : []).filter((p) => INCLUDE_TYPES.has(p.type) && !p.expired);
      if (market && market !== "all") {
        const local = list.filter((p) => p.market === market);
        if (local.length) list = local; // fall back to all markets if none match
      }
      setPosts(rotate(list, 5));
    }).catch(() => setPosts([]));
  }, [market]);

  if (!posts || posts.length === 0) return null;

  return (
    <section className="py-16 sm:py-20 bg-[var(--smn-bg)] dark:bg-slate-950" data-testid="community-sample">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <SectionEyebrow>From the community</SectionEyebrow>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl smn-heading mt-3">A peek at the feed</h2>
          <p className="mt-3 text-slate-500 dark:text-slate-400">See what PNW sailors are talking about. Create a free account to like, comment and post.</p>
        </div>

        <div className="mt-10 space-y-4">
          {posts.map((p) => (
            <article key={p.id} data-testid={`sample-post-${p.id}`}
                     className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <Avatar src={p.author_avatar} alt={p.author_name} className="h-10 w-10" fallback={p.author_name?.[0] || "S"} />
                <div className="min-w-0">
                  <div className="font-semibold smn-heading truncate flex items-center gap-1">
                    {p.author_name || "Community member"}
                    {p.author_verified && <Icon name="verified" tone="current" className="h-3.5 w-3.5 text-[#55B3AD]" />}
                  </div>
                  <div className="text-xs text-slate-400">{[p.market, timeAgo(p.created_at)].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
              {p.title && <h3 className="font-display font-bold text-lg smn-heading mt-3">{p.title}</h3>}
              {p.body && <p className="mt-1.5 text-slate-600 dark:text-slate-300 text-sm leading-relaxed line-clamp-4">{p.body}</p>}
              {p.image_url && (
                <div className="mt-3 rounded-xl overflow-hidden max-h-64">
                  <img src={p.image_url} alt="" loading="lazy" className="w-full object-cover" />
                </div>
              )}
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-5 text-slate-300 dark:text-slate-600 select-none" aria-hidden="true">
                <span className="inline-flex items-center gap-1.5 text-sm"><Icon name="thumbs-up" tone="current" className="h-4 w-4" /> Like</span>
                <span className="inline-flex items-center gap-1.5 text-sm"><Icon name="message-square" tone="current" className="h-4 w-4" /> Comment</span>
                <span className="inline-flex items-center gap-1.5 text-sm"><Icon name="corner-down-right" tone="current" className="h-4 w-4" /> Reply</span>
                <span className="ml-auto text-[11px] font-semibold uppercase tracking-wide text-[#55B3AD]">Sign in to join</span>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-10 text-center">
          <button onClick={() => nav("/register")} data-testid="sample-signup-btn"
                  className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#1F3F5B] hover:bg-[#152a3d] text-white font-semibold px-7 py-3 transition-colors">
            <Icon name="user-plus" tone="current" className="h-4 w-4" /> Create an account
          </button>
        </div>
      </div>
    </section>
  );
}
