import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/components/Icon";
import { StarInput } from "@/components/ReviewRatings";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import Modal from "@/components/Modal";
import MutualReviewForm from "@/components/MutualReviewForm";
import PlanPrompt from "@/components/PlanPrompt";

const COMMENT_MAX = 1000;

// Maps the signed-in viewer's side of the relationship to the MutualReviewForm role.
function formRole(relationship, viewerType) {
  if (relationship === "sailor_sailor" || relationship === "owner_owner") return "sailor";
  if (relationship === "pro_pro") return "customer"; // "How was this Boat Pro?"
  if (relationship === "owner_crew") return viewerType === "boat_owner" ? "owner" : "crew";
  // customer_pro: the Boat Pro rates a "customer"; everyone else rates the "pro".
  return viewerType === "boat_pro" ? "pro" : "customer";
}

export default function ReviewButton({ targetId, targetName, targetIdentity, onPosted, openSignal = 0 }) {
  const { user } = useAuth();
  const [elig, setElig] = useState(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [overall, setOverall] = useState(0); // one-way only
  const [comment, setComment] = useState(""); // one-way only

  const loadElig = useCallback(() => {
    if (!user || user.user_id === targetId) { setElig(null); return; }
    api.get(`/reviews/can-review/${targetId}`).then(({ data }) => setElig(data)).catch(() => setElig(null));
  }, [user, targetId]);
  useEffect(() => { loadElig(); }, [loadElig]);
  // External trigger (e.g. the post-Hired prompt) opens the same dialog.
  useEffect(() => { if (openSignal > 0 && elig?.reason_code === "ok") setOpen(true); }, [openSignal]); // eslint-disable-line

  if (!user || user.user_id === targetId || !elig) return null;
  if (elig.reason_code === "not_allowed" || elig.reason_code === "self") return null;
  if (elig.reason_code === "upgrade_required") {
    return <PlanPrompt featureKey="write_reviews" testId="review-plan-prompt" />;
  }
  // Boat Pro -> Boat Pro gated states: show a disabled button with the reason.
  if (["switch_to_personal", "shared_category", "already_reviewed"].includes(elig.reason_code)) {
    return (
      <div className="flex flex-col items-end gap-1" data-testid={`review-disabled-${elig.reason_code}`}>
        <button type="button" disabled data-testid="write-review-btn-disabled"
                className="inline-flex items-center gap-2 bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-full px-5 py-2 font-semibold text-sm min-h-[44px] cursor-not-allowed">
          <Icon name="reviews" tone="current" className="h-4 w-4" /> Write a review
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400 text-right max-w-[18rem]" data-testid="review-disabled-reason">{elig.reason}</span>
      </div>
    );
  }
  if (elig.reason_code !== "ok") return null;

  const isOneWay = elig.review_type === "one_way";
  const confirmLabel = elig.prompt === "sailed together" ? "We sailed together." : "We worked together.";

  const submitTwoWay = async ({ ratings, comment: cmt, context_note }) => {
    setBusy(true); setErr(null);
    try {
      await api.post("/review-sessions", {
        relationship: elig.relationship, counterparty_id: targetId, ratings, comment: cmt, context_note,
        target_identity: targetIdentity, as_identity: user.active_identity,
      });
      setDone(true);
    } catch (e) {
      const st = e?.response?.status; const d = e?.response?.data?.detail;
      if (st === 403) { setOpen(false); loadElig(); toast.message("Reviews are for paid members."); }
      else setErr(d?.message || d || (st === 422 ? "That comment is too long." : "Something went wrong. Try again."));
    } finally { setBusy(false); }
  };

  const submitOneWay = async () => {
    if (!overall) return;
    setBusy(true); setErr(null);
    try {
      await api.post("/reviews", { target_id: targetId, rating: overall, comment });
      toast.success("Thanks. Your review is live.");
      setOpen(false); setOverall(0); setComment("");
      onPosted && onPosted();
    } catch (e) {
      const st = e?.response?.status; const d = e?.response?.data?.detail;
      if (st === 403) { setOpen(false); loadElig(); toast.message("Reviews are for paid members."); }
      else setErr(d?.message || d || (st === 422 ? "That comment is too long." : "Something went wrong. Try again."));
    } finally { setBusy(false); }
  };

  const close = () => { setOpen(false); setDone(false); setErr(null); setOverall(0); setComment(""); };

  return (
    <>
      <button onClick={() => setOpen(true)} data-testid="write-review-btn"
              className="inline-flex items-center gap-2 bg-[#1F3F5B] hover:bg-[#152a3d] text-white rounded-full px-5 py-2 font-semibold text-sm min-h-[44px]">
        <Icon name="reviews" tone="current" className="h-4 w-4" /> Write a review
      </button>

      <Modal open={open} onClose={close} title={`Review ${targetName || "this member"}`} testId="write-review-modal"
             eyebrow={<><Icon name="reviews" tone="current" className="h-3.5 w-3.5" /> Review</>}>
        <div className="p-5">
          {done ? (
            <div className="space-y-4 text-center" data-testid="review-success">
              <div className="mx-auto h-12 w-12 rounded-full bg-teal-100 flex items-center justify-center"><Icon name="check" tone="current" className="h-6 w-6 text-[#2A7871]" /></div>
              <p className="text-sm text-slate-700 dark:text-slate-300">Thanks. Your review stays private until {targetName || "they"} reviews you back or 7 days pass. We&apos;ll remind them on day 3 and day 6.</p>
              <Link to="/reviews" data-testid="see-my-reviews" className="inline-block font-semibold text-[#1F3F5B] dark:text-[#7cc] underline">See my reviews</Link>
            </div>
          ) : isOneWay ? (
            <div className="space-y-4" data-testid="one-way-form">
              <div className="rounded-xl border-2 border-[#F2A03B]/40 bg-[#F2A03B]/5 p-3 flex items-center justify-between gap-3">
                <div className="text-sm font-bold text-[#1F3F5B] dark:text-slate-100">Overall <span className="text-red-500">*</span></div>
                <StarInput value={overall} onChange={setOverall} testId="oneway-star" label="Overall rating, required" />
              </div>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Comment (optional)</span>
                <textarea rows={3} value={comment} maxLength={COMMENT_MAX} onChange={(e) => setComment(e.target.value)}
                          data-testid="oneway-comment" placeholder="Share your experience with this organization."
                          className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none" />
                <span className="block text-right text-[11px] text-slate-400">{comment.length}/{COMMENT_MAX}</span>
              </label>
              {err && <p className="text-sm text-red-600" data-testid="review-error">{err}</p>}
              <div className="flex justify-end">
                <button onClick={submitOneWay} disabled={busy || !overall} data-testid="post-review-btn"
                        className="min-h-[44px] bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2 font-semibold disabled:opacity-50">
                  {busy ? "Posting…" : "Post review"}</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <MutualReviewForm role={formRole(elig.relationship, user.account_type)}
                showContextNote confirmLabel={confirmLabel} submitLabel="Send review"
                privacyNote={`Your review stays private until ${targetName || "they"} reviews you back or 7 days pass. We'll remind them on day 3 and day 6.`}
                submitting={busy} onSubmit={submitTwoWay} />
              {err && <p className="text-sm text-red-600" data-testid="review-error">{err}</p>}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
