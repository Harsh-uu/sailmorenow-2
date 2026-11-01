import { useEffect, useState, useCallback, useRef } from "react";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/context/AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { canInteract } from "@/lib/plan";
import { toast } from "sonner";
import Modal from "@/components/Modal";
import MutualReviewForm from "@/components/MutualReviewForm";
import Avatar from "@/components/Avatar";
import LogoCircle from "@/components/LogoCircle";
import PlanPrompt from "@/components/PlanPrompt";
import ReviewReply, { ReportReviewLink } from "@/components/ReviewReply";
import ReviewDisputeForm, { MyDisputesPanel } from "@/components/ReviewDisputeForm";
import { Stars, FactorList } from "@/components/ReviewRatings";

const FACTORS = [
  { key: "personality", label: "Personality" },
  { key: "skill", label: "Skill" },
  { key: "promptness", label: "Promptness" },
  { key: "communication", label: "Communication" },
];

function verb(rel) { return (rel === "customer_pro" || rel === "pro_pro") ? "worked" : "sailed"; }

function fmtDaysLeft(revealAt, now) {
  if (!revealAt) return null;
  const ms = new Date(revealAt).getTime() - now;
  if (ms <= 0) return "today";
  const d = Math.ceil(ms / 86_400_000);
  return d === 1 ? "1 day" : `${d} days`;
}
function fmtGoLiveDate(revealAt) {
  if (!revealAt) return "";
  const d = new Date(revealAt);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function AuthorBlock({ p }) {
  const isPro = p?.account_type === "boat_pro" && p?.business_name;
  const name = isPro ? p.business_name : (p?.user_name || "A member");
  return (
    <div className="flex items-center gap-3 min-w-0">
      {isPro
        ? <LogoCircle src={p.business_logo} size="h-11 w-11" alt={name} fallback={<Icon name="directory" tone="current" className="h-5 w-5 text-slate-400" />} />
        : <Avatar src={p?.user_avatar} className="h-11 w-11" alt={name} />}
      <div className="min-w-0">
        <div className="font-semibold text-[#1F3F5B] dark:text-slate-100 leading-tight break-words">{name}</div>
      </div>
    </div>
  );
}

function OverallLine({ review }) {
  if (!review) return null;
  const r = review.ratings || {};
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
      <Stars value={r.overall} /> <span className="tabular-nums">{r.overall ? Number(r.overall).toFixed(1) : "-"}</span>
    </span>
  );
}

function ReviewBody({ review }) {
  if (!review) return null;
  const r = review.ratings || {};
  const rows = FACTORS.filter((f) => r[f.key]).map((f) => ({ ...f, value: r[f.key] }));
  return (
    <div className="mt-2">
      {review.comment && <p className="text-sm text-slate-600 dark:text-slate-300 italic break-words">&ldquo;{review.comment}&rdquo;</p>}
      {rows.length > 0 && <div className="mt-2" data-testid="review-optional-ratings"><FactorList rows={rows} size="h-3.5 w-3.5" /></div>}
    </div>
  );
}

export default function Reviews() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const highlightId = params.get("session");
  const tabParam = params.get("tab");
  const [sessions, setSessions] = useState([]);
  const [state, setState] = useState("loading"); // loading | ready | error
  const [now, setNow] = useState(Date.now());
  const [active, setActive] = useState(null); // tab key: requests | waiting | live
  const [composeFor, setComposeFor] = useState(null); // review-back
  const [editFor, setEditFor] = useState(null);        // edit my pending review
  const [withdrawFor, setWithdrawFor] = useState(null);
  const [disputeFor, setDisputeFor] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState(null);
  const cardRefs = useRef({});
  const tabRefs = useRef({});
  const didAutoCompose = useRef(false);

  useEffect(() => { if (!loading && !user) nav("/"); }, [user, loading, nav]);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/review-sessions/mine");
      setSessions(data || []);
      setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      const crossed = sessions.some((s) => s.status === "pending" && s.reveal_at && new Date(s.reveal_at).getTime() <= Date.now());
      if (crossed) load();
    }, 30_000);
    return () => clearInterval(t);
  }, [sessions, load]);

  const me = (s) => s.participants.find((p) => p.user_id === user?.user_id);
  const other = (s) => s.participants.find((p) => p.user_id !== user?.user_id);
  const iAmReviewer = (s) => !!me(s)?.is_reviewer;

  const requests = user ? sessions.filter((s) => s.status === "pending" && !iAmReviewer(s)) : [];
  const waiting = user ? sessions.filter((s) => s.status === "pending" && iAmReviewer(s)) : [];
  const live = user ? sessions.filter((s) => s.live) : [];
  const groups = { requests, waiting, live };
  const TABS = [
    { key: "requests", label: "Review requests", count: requests.length },
    { key: "waiting", label: "Waiting", count: waiting.length },
    { key: "live", label: "Live", count: live.length },
    { key: "disputes", label: "Disputes", count: null },
  ];
  const nothing = !requests.length && !waiting.length && !live.length;

  // First non-empty tab once data loads (requests -> waiting -> live), unless
  // the URL asks for a specific tab (e.g. ?tab=disputes from a notification).
  useEffect(() => {
    if (state !== "ready" || active) return;
    if (tabParam && TABS.some((t) => t.key === tabParam)) { setActive(tabParam); return; }
    const first = requests.length ? "requests" : waiting.length ? "waiting" : live.length ? "live" : "requests";
    setActive(first);
  }, [state, active, tabParam, requests.length, waiting.length, live.length]);

  // ?session= : switch to the tab holding it, scroll + flash, and (paid) open
  // the review-back composer for a review request.
  useEffect(() => {
    if (!highlightId || state !== "ready") return;
    const found = sessions.find((s) => s.id === highlightId);
    if (!found) return;
    const tab = requests.some((s) => s.id === highlightId) ? "requests"
      : waiting.some((s) => s.id === highlightId) ? "waiting"
      : live.some((s) => s.id === highlightId) ? "live" : null;
    if (tab) setActive(tab);
    if (tab === "requests" && canInteract(user) && !didAutoCompose.current) {
      didAutoCompose.current = true;
      setComposeFor(found);
    }
    const el = cardRefs.current[highlightId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlash(highlightId);
      const t = setTimeout(() => setFlash(null), 2600);
      return () => clearTimeout(t);
    }
  }, [highlightId, state, sessions]); // eslint-disable-line

  if (!user) return null;

  const isPaid = canInteract(user);
  const setRef = (id) => (el) => { if (el) cardRefs.current[id] = el; };
  const ringFor = (id) => (flash === id ? "ring-2 ring-[#55B3AD] ring-offset-2" : "");

  const onTabKey = (e, idx) => {
    let next = null;
    if (e.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next == null) return;
    e.preventDefault();
    const key = TABS[next].key;
    setActive(key);
    tabRefs.current[key]?.focus();
  };

  // --- Actions ---------------------------------------------------------------
  const submitReviewBack = async (s, { ratings, comment }) => {
    setBusyId(`${s.id}:back`);
    try {
      await api.post(`/review-sessions/${s.id}/accept`, { ratings, comment });
      toast.success("Your review is in. Both reviews are now live.");
      setComposeFor(null);
      await load();
    } catch (e) {
      const st = e?.response?.status;
      const d = e?.response?.data?.detail;
      if (st === 409) { toast.message("This review was already handled."); setComposeFor(null); await load(); }
      else if (st === 403) {
        toast.error((d && d.message) || "Reviewing back is a paid feature.", {
          action: { label: "Upgrade", onClick: () => nav("/my-plan") },
        });
      } else toast.error((d && d.message) || d || "Could not send your review. Try again.");
    } finally { setBusyId(null); }
  };

  const submitEdit = async (s, { ratings, comment, context_note }) => {
    setBusyId(`${s.id}:edit`);
    try {
      await api.put(`/review-sessions/${s.id}/review`, { ratings, comment, context_note });
      toast.success("Review updated.");
      setEditFor(null);
      await load();
    } catch (e) {
      const st = e?.response?.status;
      const d = e?.response?.data?.detail;
      if (st === 409) { toast.message("This review can no longer be edited."); setEditFor(null); await load(); }
      else toast.error((d && d.message) || d || "Could not save your changes. Try again.");
    } finally { setBusyId(null); }
  };

  const doWithdraw = async (s) => {
    setBusyId(`${s.id}:withdraw`);
    try {
      await api.post(`/review-sessions/${s.id}/withdraw`);
      toast.success("Review withdrawn.");
      setWithdrawFor(null);
      await load();
    } catch (e) {
      const st = e?.response?.status;
      if (st === 409) { toast.message("This review can no longer be withdrawn."); await load(); }
      else toast.error(e?.response?.data?.detail?.message || e?.response?.data?.detail || "Could not withdraw. Try again.");
      setWithdrawFor(null);
    } finally { setBusyId(null); }
  };

  const replyToLive = async (s, authorId, text) => {
    await api.post(`/review-sessions/${s.id}/review/${authorId}/reply`, { text });
    toast.success("Reply posted.");
    await load();
  };

  // --- Cards -----------------------------------------------------------------
  const RequestCard = (s) => {
    const author = other(s);
    const left = fmtDaysLeft(s.reveal_at, now);
    return (
      <article key={s.id} ref={setRef(s.id)} data-testid={`review-session-${s.id}`}
               className={`bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 shadow-sm transition-shadow ${ringFor(s.id)}`}>
        <AuthorBlock p={author} />
        <div className="mt-2 text-sm text-slate-600 dark:text-slate-400 break-words">
          <b className="text-[#1F3F5B] dark:text-slate-200">{author?.business_name || author?.user_name || "Someone"}</b> says you {verb(s.relationship)} with them and left you a review.
        </div>
        <div className="mt-3 text-xs text-slate-500 flex items-center gap-1" data-testid={`countdown-${s.id}`}>
          <Icon name="clock" tone="current" className="h-3.5 w-3.5" /> Goes live in <b className="text-slate-700 dark:text-slate-300">{left}</b>
        </div>
        {isPaid ? (
          <div className="mt-4">
            <button onClick={() => setComposeFor(s)} data-testid={`review-back-${s.id}`}
                    className="min-h-[44px] rounded-full bg-[#F2A03B] hover:bg-[#d98c30] text-white px-5 py-2 font-semibold">Review them back</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400" data-testid={`free-golive-${s.id}`}>
              It goes live on <b className="text-slate-700 dark:text-slate-300">{fmtGoLiveDate(s.reveal_at)}</b>. Upgrade to review them back.
            </p>
            <PlanPrompt featureKey="write_reviews" testId={`req-plan-prompt-${s.id}`} />
          </div>
        )}
        <div className="mt-3">
          <ReportReviewLink onReport={() => setDisputeFor({ mode: "report", session_id: s.id, review_author_id: author?.user_id })} testId={`report-${s.id}`} />
        </div>
      </article>
    );
  };

  const WaitingCard = (s) => {
    const o = other(s);
    const left = fmtDaysLeft(s.reveal_at, now);
    return (
      <article key={s.id} ref={setRef(s.id)} data-testid={`review-session-${s.id}`}
               className={`bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 shadow-sm ${ringFor(s.id)}`}>
        <AuthorBlock p={o} />
        <div className="mt-3 text-sm text-slate-600 dark:text-slate-400" data-testid={`countdown-${s.id}`}>
          Waiting for <b className="text-[#1F3F5B] dark:text-slate-200">{o?.business_name || o?.user_name || "them"}</b> to review you back. Goes live in <b className="text-slate-700 dark:text-slate-300">{left}</b>.
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => setEditFor(s)} data-testid={`edit-mine-${s.id}`}
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 px-5 py-2 font-semibold text-[#1F3F5B] dark:text-slate-200">
            <Icon name="edit" tone="current" className="h-4 w-4" /> Edit</button>
          <button onClick={() => setWithdrawFor(s)} data-testid={`withdraw-${s.id}`}
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-full border border-red-200 text-red-600 hover:bg-red-50 px-5 py-2 font-semibold">
            Withdraw</button>
        </div>
      </article>
    );
  };

  const LiveCard = (s) => {
    const o = other(s);
    // The review ABOUT me is the one authored by the other person (targets me).
    const aboutMe = s.other_review;      // their review of me -> I may reply
    const byMe = s.my_review;            // my review of them  -> they may reply
    return (
      <article key={s.id} ref={setRef(s.id)} data-testid={`review-session-${s.id}`}
               className={`bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 shadow-sm ${ringFor(s.id)}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <AuthorBlock p={o} />
          <span className="text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100" data-testid={`live-label-${s.id}`}>Live</span>
        </div>
        {aboutMe && (
          <div className="mt-3" data-testid={`live-about-me-${s.id}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">Their review of you</div>
              <OverallLine review={aboutMe} />
            </div>
            <ReviewBody review={aboutMe} />
            <ReviewReply reply={aboutMe.reply} canReply={!aboutMe.reply}
                         onSubmit={(t) => replyToLive(s, aboutMe.author_id, t)} testId={`reply-${s.id}`} />
            <div className="mt-2"><ReportReviewLink onReport={() => setDisputeFor({ mode: "report", session_id: s.id, review_author_id: aboutMe.author_id })} testId={`report-${s.id}`} /></div>
          </div>
        )}
        {byMe && (
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800" data-testid={`live-by-me-${s.id}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold uppercase tracking-widest text-[#2A7871] dark:text-teal-300">Your review</div>
              <OverallLine review={byMe} />
            </div>
            <ReviewBody review={byMe} />
            {byMe.reply && <ReviewReply reply={byMe.reply} testId={`reply-mine-${s.id}`} />}
            <div className="mt-2">
              <button type="button" onClick={() => setDisputeFor({ mode: "self_removal", session_id: s.id, review_author_id: byMe.author_id })}
                      data-testid={`remove-mine-${s.id}`}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 underline">
                <Icon name="delete" tone="current" className="h-3 w-3" /> Remove my review
              </button>
            </div>
          </div>
        )}
      </article>
    );
  };

  const renderGroup = (key) => {
    if (key === "disputes") return <MyDisputesPanel />;
    const items = groups[key];
    if (!items.length) {
      const msg = key === "requests" ? "No review requests right now."
        : key === "waiting" ? "You have no reviews waiting."
        : "No live reviews yet.";
      return <p className="text-center text-slate-500 py-8" data-testid={`empty-${key}`}>{msg}</p>;
    }
    const render = key === "requests" ? RequestCard : key === "waiting" ? WaitingCard : LiveCard;
    return <div className="space-y-3">{items.map(render)}</div>;
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10" data-testid="reviews-page">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#F2A03B] flex items-center gap-2">
        <Icon name="reviews" tone="current" className="h-3.5 w-3.5" /> Reviews
      </div>
      <h1 className="font-display font-extrabold text-[#1F3F5B] dark:text-slate-100 text-3xl sm:text-4xl mt-2 tracking-tight">Reviews</h1>

      <div aria-live="polite" className="sr-only" data-testid="reviews-live-region">{state === "loading" ? "Loading reviews" : ""}</div>

      {state === "loading" && (
        <div className="mt-8 space-y-3" data-testid="reviews-loading">
          {[0, 1].map((i) => <div key={i} className="h-28 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
        </div>
      )}

      {state === "error" && (
        <div className="mt-8 rounded-2xl border border-red-100 bg-red-50 p-6 text-center" data-testid="reviews-error">
          <p className="text-sm text-red-700">We couldn&apos;t load your reviews.</p>
          <button onClick={() => { setState("loading"); load(); }} data-testid="reviews-retry"
                  className="mt-3 min-h-[44px] rounded-full bg-[#1F3F5B] text-white px-5 py-2 font-semibold">Retry</button>
        </div>
      )}

      {state === "ready" && nothing && (
        <div className="mt-10 text-center text-slate-500" data-testid="reviews-empty">No reviews yet.</div>
      )}

      {state === "ready" && !nothing && (
        <>
          {/* Tab strip: scrolls itself on narrow screens (no page overflow). */}
          <div className="mt-8 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
            <div role="tablist" aria-label="Reviews" className="inline-flex gap-2 min-w-max border-b border-slate-200 dark:border-slate-800" data-testid="reviews-tablist">
              {TABS.map((t, idx) => {
                const selected = active === t.key;
                return (
                  <button key={t.key} role="tab" id={`tab-${t.key}`} aria-selected={selected}
                          aria-controls={`panel-${t.key}`} tabIndex={selected ? 0 : -1}
                          ref={(el) => { if (el) tabRefs.current[t.key] = el; }}
                          onClick={() => setActive(t.key)} onKeyDown={(e) => onTabKey(e, idx)}
                          data-testid={`tab-${t.key}`}
                          className={`relative shrink-0 inline-flex items-center gap-2 px-4 min-h-[44px] font-semibold text-sm border-b-2 -mb-px transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#55B3AD] rounded-t-lg ${selected ? "border-[#F2A03B] text-[#1F3F5B] dark:text-slate-100" : "border-transparent text-slate-500 hover:text-[#1F3F5B] dark:hover:text-slate-200"}`}>
                    {t.label}
                    {t.count != null && (
                    <span data-testid={`tab-count-${t.key}`}
                          className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-bold ${selected ? "bg-[#F2A03B] text-white" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>{t.count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {active && (
            <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="mt-6" data-testid={`panel-${active}`}>
              {renderGroup(active)}
            </div>
          )}
        </>
      )}

      {/* Review-back compose */}
      <Modal open={!!composeFor} onClose={() => setComposeFor(null)}
             eyebrow={<><Icon name="reviews" tone="current" className="h-3.5 w-3.5" /> Review back</>}
             title={composeFor ? `Review ${other(composeFor)?.business_name || other(composeFor)?.user_name || "them"}` : "Review back"} testId="review-back-modal">
        <div className="p-5">
          {composeFor && (
            <MutualReviewForm role={me(composeFor)?.role}
              onSubmit={(payload) => submitReviewBack(composeFor, payload)}
              submitting={busyId === `${composeFor.id}:back`} submitLabel="Send review"
              privacyNote="When you send this, both reviews go live right away." />
          )}
        </div>
      </Modal>

      {/* Edit my pending review */}
      <Modal open={!!editFor} onClose={() => setEditFor(null)}
             eyebrow={<><Icon name="edit" tone="current" className="h-3.5 w-3.5" /> Edit review</>}
             title="Edit your review" testId="edit-review-modal">
        <div className="p-5">
          {editFor && (
            <MutualReviewForm role={me(editFor)?.role}
              initialRatings={editFor.my_review?.ratings} initialComment={editFor.my_review?.comment || ""}
              initialContext={editFor.context_note || ""} showContextNote editNote
              onSubmit={(payload) => submitEdit(editFor, payload)}
              submitting={busyId === `${editFor.id}:edit`} submitLabel="Save changes" />
          )}
        </div>
      </Modal>

      {/* Withdraw confirm */}
      <Modal open={!!withdrawFor} onClose={() => setWithdrawFor(null)} size="sm"
             title="Withdraw this review?" testId="withdraw-confirm-modal">
        <div className="p-5">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {withdrawFor ? (other(withdrawFor)?.business_name || other(withdrawFor)?.user_name || "They") : "They"} will be told. If they want to review you, the process starts over.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button onClick={() => setWithdrawFor(null)} data-testid="withdraw-cancel"
                    className="min-h-[44px] rounded-full border border-slate-200 dark:border-slate-700 px-5 py-2 font-semibold text-[#1F3F5B] dark:text-slate-200">Cancel</button>
            <button onClick={() => doWithdraw(withdrawFor)} disabled={busyId === `${withdrawFor?.id}:withdraw`} data-testid="withdraw-confirm"
                    className="min-h-[44px] rounded-full bg-red-600 hover:bg-red-700 text-white px-5 py-2 font-semibold disabled:opacity-50">
              {busyId === `${withdrawFor?.id}:withdraw` ? "Withdrawing…" : "Withdraw review"}</button>
          </div>
        </div>
      </Modal>

      {/* Report / dispute / remove-my-review */}
      <ReviewDisputeForm open={!!disputeFor} target={disputeFor} onClose={() => setDisputeFor(null)} onDone={load} />
    </div>
  );
}
