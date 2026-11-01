import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import Avatar from "@/components/Avatar";
import LogoCircle from "@/components/LogoCircle";
import SharedAuthorBlock from "@/components/AuthorBlock";
import ReviewReply, { ReportReviewLink } from "@/components/ReviewReply";
import { Stars, FactorList, fmtReviewDate } from "@/components/ReviewRatings";

const FACTORS = [
  { key: "personality", label: "Personality" },
  { key: "skill", label: "Skill" },
  { key: "promptness", label: "Promptness" },
  { key: "communication", label: "Communication" },
];

function AuthorBlock({ a }) {
  // Shared "who wrote this" block. A Boat Pro reviewer shows by BUSINESS NAME +
  // logo (LogoCircle) linking to /directory/:id; everyone else by personal name.
  const isPro = a?.account_type === "boat_pro" && a?.business_name;
  return (
    <SharedAuthorBlock
      identity={isPro ? "business" : "personal"}
      name={isPro ? a.business_name : (a?.name || "A member")}
      avatar={isPro ? a.business_logo : a?.avatar}
      handle={a?.handle}
      businessId={a?.business_listing_id}
      size="h-10 w-10"
    />
  );
}

export default function ReviewsSection({ targetId, kind = "member", title = "Reviews", refreshKey = 0, identity = "business", canReply = false }) {
  const [state, setState] = useState("loading");
  const [data, setData] = useState(null);
  const [limit, setLimit] = useState(5);

  const load = useCallback(() => {
    setState("loading");
    api.get(`/reviews/list/${targetId}?limit=100&identity=${identity}`).then(({ data }) => { setData(data); setState("ready"); }).catch(() => setState("error"));
  }, [targetId, identity]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const deleteReview = async (r) => {
    if (!window.confirm("Delete this review? This cannot be undone.")) return;
    const url = r.type === "two_way"
      ? `/review-sessions/${r.review_session_id}/review/${r.review_author_id}`
      : `/reviews/${r.id}`;
    try { await api.delete(url); toast.success("Review deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't delete review"); }
  };

  const replyTo = async (r, text) => {
    const url = r.type === "two_way"
      ? `/review-sessions/${r.review_session_id}/review/${r.review_author_id}/reply`
      : `/reviews/${r.id}/reply`;
    await api.post(url, { text });
    toast.success("Reply posted");
    load();
  };

  const summary = data?.summary || {};
  const reviews = data?.reviews || [];
  const shown = reviews.slice(0, limit);
  const isOrg = kind === "org" || summary.target_type === "organization";
  const countLabel = `${summary.count} review${summary.count === 1 ? "" : "s"}`;
  const factorRows = FACTORS.filter((f) => summary[f.key] != null).map((f) => ({ ...f, value: summary[f.key] }));

  return (
    <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-6 sm:p-8" data-testid="reviews-section">
      <h2 className="font-display font-bold text-2xl text-[#1F3F5B] dark:text-slate-100">{title}</h2>

      {/* Summary as a list (no tiles). Org = single Overall line. */}
      {state === "ready" && summary.overall != null && (
        isOrg ? (
          <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#1F3F5B] dark:text-slate-100" data-testid="reviews-summary-overall">
            <span className="w-24 shrink-0">Overall</span>
            <span className="tabular-nums">{Number(summary.overall).toFixed(1)}</span>
            <Stars value={summary.overall} />
            <span className="text-slate-500 dark:text-slate-400 font-normal">· {countLabel}</span>
          </div>
        ) : (
          <div className="mt-3" data-testid="reviews-summary-overall">
            <FactorList
              rows={[{ key: "overall", label: "Overall", value: summary.overall, suffix: `· ${countLabel}` }, ...factorRows]}
              stackStarsOnPhone labelWidth="w-32" />
          </div>
        )
      )}

      {state === "loading" && <div className="mt-6 space-y-3" data-testid="reviews-section-loading">{[0, 1].map((i) => <div key={i} className="h-20 rounded-xl bg-slate-100 dark:bg-slate-700 animate-pulse" />)}</div>}

      {state === "error" && (
        <div className="mt-6 text-center" data-testid="reviews-section-error">
          <p className="text-sm text-red-600 dark:text-red-400">We couldn&apos;t load reviews.</p>
          <button onClick={load} data-testid="reviews-section-retry" className="mt-2 min-h-[44px] rounded-full bg-[#1F3F5B] text-white px-5 py-2 font-semibold text-sm">Retry</button>
        </div>
      )}

      {state === "ready" && reviews.length === 0 && <p className="mt-4 text-slate-500 dark:text-slate-400" data-testid="reviews-section-empty">No reviews yet.</p>}

      {state === "ready" && reviews.length > 0 && (
        <div className="mt-6 space-y-4">
          {shown.map((r) => {
            const rows = FACTORS.filter((f) => r.ratings && r.ratings[f.key]).map((f) => ({ ...f, value: r.ratings[f.key] }));
            return (
              <article key={r.id} className="rounded-2xl border border-slate-100 dark:border-slate-700 p-4 [overflow-wrap:anywhere]" data-testid={`review-item-${r.id}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <AuthorBlock a={r.author} />
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Stars value={r.overall} /> {r.created_at && <span>{fmtReviewDate(r.created_at)}</span>}
                  </div>
                </div>
                {r.comment && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 italic">&ldquo;{r.comment}&rdquo;</p>}
                {rows.length > 0 && <div className="mt-2"><FactorList rows={rows} size="h-3.5 w-3.5" /></div>}
                <ReviewReply reply={r.reply} canReply={canReply && !r.reply} onSubmit={(t) => replyTo(r, t)} testId={`reply-${r.id}`} />
                <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                  <ReportReviewLink reviewRef={r.id} testId={`report-${r.id}`} />
                  {r.can_delete && (
                    <button onClick={() => deleteReview(r)} data-testid={`review-delete-${r.id}`}
                            className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest px-3 h-7 rounded-full border border-red-200 text-red-600 hover:bg-red-50">
                      Delete
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          {reviews.length > limit && (
            <div className="text-center">
              <button onClick={() => setLimit((l) => l + 5)} data-testid="reviews-show-more"
                      className="min-h-[44px] rounded-full border border-slate-200 dark:border-slate-700 px-5 py-2 font-semibold text-[#1F3F5B] dark:text-slate-200 text-sm">Show more</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
