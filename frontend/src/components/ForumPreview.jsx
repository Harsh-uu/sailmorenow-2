import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";
import SectionEyebrow from "@/components/SectionEyebrow";

/**
 * Landing-page teaser for the Community Hub forum. Fetches the four most
 * recent forum threads and renders them as compact cards; on empty/loading
 * the whole section quietly collapses so the marketing page never shows
 * a "nothing here yet" state.
 */
export default function ForumPreview({ wrap = (n) => n }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    api.get("/discussions", { params: { kind: "forum", limit: 4 } })
      .then(({ data }) => setItems(Array.isArray(data) ? data : (data?.discussions || [])))
      .catch(() => setItems([]));
  }, []);
  if (!items || items.length === 0) return null;
  return wrap(
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" data-testid="forum-preview">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <SectionEyebrow>From the forum</SectionEyebrow>
          <h2 className="font-display font-extrabold smn-heading text-3xl sm:text-4xl mt-2 tracking-tight">What sailors are talking about.</h2>
        </div>
        <Link to="/community-hub" data-testid="forum-preview-more"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[#1F3F5B] dark:text-slate-200 hover:text-[#152a3d] dark:hover:text-white">
          Open the forum <Icon name="arrow-right" tone="current" className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-6 grid sm:grid-cols-2 gap-4">
        {items.slice(0, 4).map((d) => (
          <Link key={d.id} to={`/community-hub/${d.id}`}
                data-testid={`forum-preview-${d.id}`}
                className="group bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#B45309] dark:text-[#F2A03B] flex items-center gap-1">
              <Icon name="messages" size={12} tone="current" /> Forum
            </div>
            <div className="mt-2 font-display font-bold smn-heading text-lg leading-snug line-clamp-2 group-hover:text-[#B45309] dark:group-hover:text-[#F2A03B]">
              {d.title || "(untitled)"}
            </div>
            {d.body && (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">{d.body}</p>
            )}
            <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
              <span>{d.author_name || d.author_handle || "Anonymous"}</span>
              <span>·</span>
              <span>{(d.created_at || "").slice(0, 10)}</span>
              {typeof d.reply_count === "number" && (
                <><span>·</span><span>{d.reply_count} repl{d.reply_count === 1 ? "y" : "ies"}</span></>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
