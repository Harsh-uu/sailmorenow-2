import { useState } from "react";
import { StarInput } from "@/components/ReviewRatings";

/**
 * Shared two-way review editor (single review system).
 *
 * Ratings: overall (required, 1-5) + four optional dimensions
 * (personality, skill, promptness, communication). No Safety.
 * Optionally renders a "What was this for?" context field (context_note, 200)
 * and a REQUIRED confirmation checkbox (confirmLabel) — used by the write-a-review
 * entry points. Review-back (from /reviews) omits those props and behaves as before.
 */
const LABELS = {
  customer: { heading: "How was this Boat Pro?", personality: "Professionalism", skill: "Quality of work", promptness: "On time and on schedule", communication: "Kept me informed" },
  pro: { heading: "How was this customer?", personality: "Easy to work with", skill: "Clear scope and boat prep", promptness: "Paid promptly", communication: "Responsive" },
  owner: { heading: "How was your crew?", personality: "Good crewmate", skill: "Sailing skill", promptness: "Punctual", communication: "Clear communicator" },
  crew: { heading: "How was your skipper?", personality: "Good skipper", skill: "Boat handling", promptness: "Ran on schedule", communication: "Clear briefing" },
  sailor: { heading: "How were they on the water?", personality: "Good crewmate", skill: "Sailing skill", promptness: "Punctual", communication: "Clear communicator" },
};
const OPTIONAL_KEYS = ["personality", "skill", "promptness", "communication"];
const COMMENT_MAX = 1000;
const CONTEXT_MAX = 200;

const StarRow = StarInput;

export default function MutualReviewForm({ role, initialRatings, initialComment = "", initialContext = "", onSubmit, submitting,
                                          submitLabel = "Submit review", showContextNote = false, confirmLabel = null,
                                          privacyNote = null, editNote = false }) {
  const init = initialRatings || {};
  const [overall, setOverall] = useState(Number(init.overall || 0));
  const [ratings, setRatings] = useState(() => ({
    personality: Number(init.personality || 0), skill: Number(init.skill || 0),
    promptness: Number(init.promptness || 0), communication: Number(init.communication || 0),
  }));
  const [comment, setComment] = useState(initialComment);
  const [contextNote, setContextNote] = useState(initialContext);
  const [confirmed, setConfirmed] = useState(false);
  const labels = LABELS[role] || LABELS.customer;
  const setKey = (k, v) => setRatings((r) => ({ ...r, [k]: v }));

  const submit = () => {
    const out = { overall };
    OPTIONAL_KEYS.forEach((k) => { if (ratings[k]) out[k] = ratings[k]; });
    onSubmit({ ratings: out, comment, context_note: contextNote });
  };
  const disabled = submitting || !overall || (confirmLabel && !confirmed);

  return (
    <div className="space-y-4" data-testid="mutual-review-form">
      <div className="text-sm font-semibold text-[#1F3F5B] dark:text-slate-100">{labels.heading}</div>
      <div className="rounded-xl border-2 border-[#F2A03B]/40 bg-[#F2A03B]/5 p-3 flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-[#1F3F5B] dark:text-slate-100">Overall <span className="text-red-500">*</span></div>
        <StarRow value={overall} onChange={setOverall} testId="star-overall" label="Overall rating, required" />
      </div>
      <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Optional</div>
      <div className="divide-y divide-slate-100 dark:divide-slate-700 rounded-xl border border-slate-100 dark:border-slate-700">
        {OPTIONAL_KEYS.map((k) => (
          <div key={k} className="flex items-center justify-between gap-3 p-3">
            <div className="text-sm text-slate-700 dark:text-slate-300">{labels[k]}</div>
            <StarRow value={ratings[k]} onChange={(v) => setKey(k, v)} testId={`star-${k}`} label={labels[k]} />
          </div>
        ))}
      </div>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Comment (optional)</span>
        <textarea rows={3} value={comment} maxLength={COMMENT_MAX} onChange={(e) => setComment(e.target.value)}
                  data-testid="mutual-review-comment"
                  placeholder="A quick note the other side will see once it goes live."
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none" />
        <span className="block text-right text-[11px] text-slate-400" data-testid="comment-counter">{comment.length}/{COMMENT_MAX}</span>
      </label>
      {showContextNote && (
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500">What was this for?</span>
          <input type="text" value={contextNote} maxLength={CONTEXT_MAX} onChange={(e) => setContextNote(e.target.value)}
                 data-testid="context-note"
                 placeholder="Rigging job, delivery, race crew…"
                 className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none" />
          <span className="block text-right text-[11px] text-slate-400" data-testid="context-counter">{contextNote.length}/{CONTEXT_MAX}</span>
        </label>
      )}
      {confirmLabel && (
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
                 data-testid="confirm-relationship" className="mt-1 h-4 w-4 accent-[#55B3AD]" />
          <span className="text-sm text-slate-700 dark:text-slate-300">{confirmLabel}</span>
        </label>
      )}
      {privacyNote && (
        <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3" data-testid="review-privacy-note">{privacyNote}</p>
      )}
      {editNote && (
        <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="review-edit-note">Editing does not restart the 7 days.</p>
      )}
      <div className="flex justify-end">
        <button onClick={submit} disabled={disabled} data-testid="review-submit-btn"
                className="min-h-[44px] bg-[#F2A03B] hover:bg-[#d98c30] text-white rounded-full px-5 py-2 font-semibold disabled:opacity-50 inline-flex items-center gap-2">
          {submitting ? "Sending…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
