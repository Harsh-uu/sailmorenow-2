import { useState } from "react";
import { Icon } from "@/components/Icon";

const REPLY_MAX = 500;

/**
 * Public reply on a LIVE review. Shows an existing reply to everyone. When the
 * signed-in viewer is the reviewed party (canReply) and no reply exists yet, it
 * shows a one-time composer (500 chars, no edit after posting, free accounts
 * allowed). Reused by the /reviews Live tab and the public ReviewsSection.
 */
export default function ReviewReply({ reply, canReply = false, onSubmit, testId = "reply" }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      await onSubmit(t);
      setOpen(false);
      setText("");
    } finally {
      setBusy(false);
    }
  };

  if (reply) {
    return (
      <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700 p-3" data-testid={`${testId}-shown`}>
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#2A7871] dark:text-teal-300">
          Reply from {reply.author_name || "the reviewed party"}
        </div>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-200 break-words [overflow-wrap:anywhere]">{reply.text}</p>
      </div>
    );
  }

  if (!canReply) return null;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} data-testid={`${testId}-open`}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 h-8 rounded-full border border-slate-200 dark:border-slate-700 text-[#1F3F5B] dark:text-slate-200 hover:border-[#55B3AD]">
        <Icon name="message-square" tone="current" className="h-3.5 w-3.5" /> Reply
      </button>
    );
  }

  return (
    <div className="mt-3" data-testid={`${testId}-composer`}>
      <textarea rows={3} value={text} maxLength={REPLY_MAX} onChange={(e) => setText(e.target.value)}
                data-testid={`${testId}-input`} placeholder="Write a public reply…"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">Replies are public and can&apos;t be edited.</span>
        <span className="text-[11px] text-slate-400" data-testid={`${testId}-counter`}>{text.length}/{REPLY_MAX}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={send} disabled={busy || !text.trim()} data-testid={`${testId}-submit`}
                className="min-h-[44px] rounded-full bg-[#1F3F5B] hover:bg-[#152a3d] text-white px-5 py-2 font-semibold text-sm disabled:opacity-50">
          {busy ? "Posting…" : "Post reply"}</button>
        <button onClick={() => { setOpen(false); setText(""); }} data-testid={`${testId}-cancel`}
                className="min-h-[44px] rounded-full border border-slate-200 dark:border-slate-700 px-5 py-2 font-semibold text-sm text-[#1F3F5B] dark:text-slate-200">Cancel</button>
      </div>
    </div>
  );
}

/** Small "Report or dispute this review" link. Opens the in-app dispute form
 * via onReport; falls back to the disputes@ email only if no handler is given. */
export function ReportReviewLink({ reviewRef, onReport, testId = "report-review" }) {
  if (onReport) {
    return (
      <button type="button" onClick={onReport} data-testid={testId}
         className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 underline">
        <Icon name="flag" tone="current" className="h-3 w-3" /> Report or dispute this review
      </button>
    );
  }
  const subject = encodeURIComponent(`Report review ${reviewRef || ""}`.trim());
  return (
    <a href={`mailto:disputes@sailmorenow.com?subject=${subject}`} data-testid={testId}
       className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 underline">
      <Icon name="flag" tone="current" className="h-3 w-3" /> Report or dispute this review
    </a>
  );
}
