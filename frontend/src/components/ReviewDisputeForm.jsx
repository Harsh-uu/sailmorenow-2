import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { api } from "@/lib/api";
import { toast } from "sonner";
import Modal from "@/components/Modal";

const EXPLANATION_MAX = 1000;

/**
 * In-app "Report or dispute this review" + "Remove my review" form (REVIEWS-4).
 * Policy copy comes from GET /review-disputes/meta (doc 92 B/C, single source).
 * target: { session_id?, review_author_id?, review_id?, mode: "report"|"self_removal" }
 */
export default function ReviewDisputeForm({ open, onClose, target, onDone }) {
  const [meta, setMeta] = useState(null);
  const [reason, setReason] = useState("");
  const [explanation, setExplanation] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const selfRemoval = target?.mode === "self_removal";

  useEffect(() => { if (open && !meta) api.get("/review-disputes/meta").then((r) => setMeta(r.data)).catch(() => {}); }, [open, meta]);
  useEffect(() => {
    if (open) { setReason(selfRemoval ? "remove_my_own_review" : ""); setExplanation(""); setFiles([]); setShowPolicy(false); }
  }, [open, selfRemoval]);

  const addFiles = (list) => {
    const incoming = Array.from(list || []);
    setFiles((prev) => [...prev, ...incoming].slice(0, meta?.max_attachments || 5));
  };

  const submit = async () => {
    if (!reason) { toast.error("Please choose a reason."); return; }
    setBusy(true);
    try {
      const body = { reason, explanation };
      if (target.review_id) body.review_id = target.review_id;
      else { body.session_id = target.session_id; body.review_author_id = target.review_author_id; }
      const { data } = await api.post("/review-disputes", body);
      const id = data?.dispute?.id;
      let failed = 0;
      for (const f of files) {
        const fd = new FormData(); fd.append("file", f);
        try { await api.post(`/review-disputes/${id}/attachments`, fd); }
        catch (e) { failed += 1; }
      }
      toast.success(selfRemoval ? "Your removal request was sent. We aim to decide within 72 hours." : "Thanks. We aim to give you a decision within 72 hours.");
      if (failed) toast.message(`${failed} attachment${failed > 1 ? "s" : ""} couldn't be added (type or size).`);
      onClose?.(); onDone?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't submit. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose}
           eyebrow={<><Icon name="flag" tone="current" className="h-3.5 w-3.5" /> {selfRemoval ? "Remove your review" : "Report or dispute"}</>}
           title={selfRemoval ? "Remove my review" : "Report or dispute this review"} testId="dispute-modal">
      <div className="p-5 space-y-4">
        {!selfRemoval && (
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Reason</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} data-testid="dispute-reason"
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2.5 focus:border-[#55B3AD] outline-none">
              <option value="">Choose a reason…</option>
              {(meta?.reasons || []).filter((r) => r.code !== "remove_my_own_review").map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </label>
        )}
        {selfRemoval && <p className="text-sm text-slate-600 dark:text-slate-400">{meta?.self_removal_note}</p>}

        <label className="block">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Explain what is wrong</span>
          <textarea rows={4} value={explanation} maxLength={EXPLANATION_MAX} onChange={(e) => setExplanation(e.target.value)}
                    data-testid="dispute-explanation" placeholder="Tell us what happened…"
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none" />
          <span className="text-[11px] text-slate-400 float-right" data-testid="dispute-counter">{explanation.length}/{EXPLANATION_MAX}</span>
        </label>

        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Attachments</span>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{meta?.attachment_help}</p>
          <div className="mt-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-200" data-testid="dispute-notice">
            {meta?.attachment_notice}
          </div>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1" data-testid="dispute-file-list">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between text-sm bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-1.5">
                  <span className="truncate">{f.name}</span>
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500" aria-label="Remove file"><Icon name="close" tone="current" className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
          {files.length < (meta?.max_attachments || 5) && (
            <label className="mt-2 inline-flex items-center gap-2 cursor-pointer text-sm font-semibold text-[#1F3F5B] dark:text-slate-200">
              <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden"
                     data-testid="dispute-file-input" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              <Icon name="add" tone="current" className="h-4 w-4" /> Add a file
            </label>
          )}
        </div>

        <button onClick={() => setShowPolicy((v) => !v)} className="text-xs font-semibold text-[#2A7871] dark:text-teal-300 underline" data-testid="dispute-policy-toggle">
          {showPolicy ? "Hide" : "Read the"} review dispute policy
        </button>
        {showPolicy && meta?.policy && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 max-h-56 overflow-y-auto text-xs text-slate-600 dark:text-slate-300 space-y-2" data-testid="dispute-policy">
            {[...meta.policy.section_c].map((sec, i) => (
              <div key={i}><div className="font-bold text-[#1F3F5B] dark:text-slate-100">{sec.h}</div><p>{sec.p}</p></div>
            ))}
            <p className="text-slate-400">{meta?.secondary_email_note}</p>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button onClick={onClose} className="min-h-[44px] rounded-full border border-slate-200 dark:border-slate-700 px-5 py-2 font-semibold text-[#1F3F5B] dark:text-slate-200" data-testid="dispute-cancel">Cancel</button>
          <button onClick={submit} disabled={busy || (!selfRemoval && !reason)} data-testid="dispute-submit"
                  className="min-h-[44px] rounded-full bg-[#1F3F5B] hover:bg-[#152a3d] text-white px-5 py-2 font-semibold disabled:opacity-50">
            {busy ? "Sending…" : (selfRemoval ? "Request removal" : "Submit")}</button>
        </div>
      </div>
    </Modal>
  );
}

/** "My disputes" list with a one-time contest action. */
export function MyDisputesPanel() {
  const [rows, setRows] = useState(null);
  const [about, setAbout] = useState([]);
  const [contestFor, setContestFor] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/review-disputes/mine").then((r) => { setRows(r.data.disputes || []); setAbout(r.data.about_me || []); }).catch(() => { setRows([]); setAbout([]); });
  useEffect(() => { load(); }, []);

  const contest = async () => {
    setBusy(true);
    try { await api.post(`/review-disputes/${contestFor.id}/contest`, { explanation: text }); toast.success("Your contest was sent."); setContestFor(null); setText(""); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Couldn't send. Try again."); }
    finally { setBusy(false); }
  };

  if (rows === null) return <div className="h-24 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />;
  if (!rows.length && !about.length) return <p className="text-center text-slate-500 py-8" data-testid="empty-disputes">You haven&apos;t filed any disputes, and no reviews you&apos;re part of are under review.</p>;

  const statusPill = (d) => (
    <span className={`text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${d.status === "decided" ? "bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100" : "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100"}`}>{d.status === "decided" ? (d.decision_label || "Decided") : "Open"}</span>
  );

  return (
    <div className="space-y-6" data-testid="my-disputes-list">
      {rows.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Requests you sent</h3>
          {rows.map((d) => (
            <article key={d.id} className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800" data-testid={`dispute-${d.id}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-semibold text-[#1F3F5B] dark:text-slate-100">{d.reason_label}{d.is_contest ? " (contest)" : ""}</span>
                {statusPill(d)}
              </div>
              {d.explanation && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 break-words">{d.explanation}</p>}
              <div className="mt-1 text-xs text-slate-400">{(d.created_at || "").slice(0, 10)}{d.attachment_count ? ` · ${d.attachment_count} attachment${d.attachment_count > 1 ? "s" : ""}` : ""}</div>
              {d.can_contest && (
                <button onClick={() => setContestFor(d)} data-testid={`contest-${d.id}`}
                        className="mt-3 min-h-[40px] rounded-full border border-slate-200 dark:border-slate-700 px-4 py-1.5 text-sm font-semibold text-[#1F3F5B] dark:text-slate-200">Contest with new information</button>
              )}
            </article>
          ))}
        </div>
      )}
      {about.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Reviews you&apos;re part of</h3>
          {about.map((d) => (
            <article key={d.id} className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-100 dark:border-slate-800" data-testid={`about-dispute-${d.id}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-semibold text-[#1F3F5B] dark:text-slate-100">{d.is_about_my_review ? "A review you wrote is being looked at" : "A review you received is being looked at"}</span>
                {statusPill(d)}
              </div>
              {d.status === "open" && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">This review is being looked at by our team. The review stays live while we look. You don&apos;t need to do anything.</p>}
              {d.status === "decided" && d.restored && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">This review was restored and is live again.</p>}
              {d.status === "decided" && !d.restored && d.removal_reason && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Your review was removed. Reason: {d.removal_reason}</p>
              )}
              {d.status === "decided" && !d.restored && !d.removal_reason && d.decision_label && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Outcome: {d.decision_label}.</p>
              )}
              <div className="mt-1 text-xs text-slate-400">{(d.decided_at || d.created_at || "").slice(0, 10)}</div>
              {d.can_contest && (
                <button onClick={() => setContestFor(d)} data-testid={`about-contest-${d.id}`}
                        className="mt-3 min-h-[40px] rounded-full border border-slate-200 dark:border-slate-700 px-4 py-1.5 text-sm font-semibold text-[#1F3F5B] dark:text-slate-200">Ask us to look again</button>
              )}
            </article>
          ))}
        </div>
      )}
      <Modal open={!!contestFor} onClose={() => setContestFor(null)} size="sm" title="Ask us to look again" testId="contest-modal">
        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">Add new information for our team. You can ask once.</p>
          <textarea rows={4} value={text} maxLength={EXPLANATION_MAX} onChange={(e) => setText(e.target.value)} data-testid="contest-input"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 focus:border-[#55B3AD] outline-none" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setContestFor(null)} className="min-h-[44px] rounded-full border border-slate-200 dark:border-slate-700 px-5 py-2 font-semibold text-[#1F3F5B] dark:text-slate-200">Cancel</button>
            <button onClick={contest} disabled={busy || !text.trim()} data-testid="contest-submit" className="min-h-[44px] rounded-full bg-[#1F3F5B] text-white px-5 py-2 font-semibold disabled:opacity-50">{busy ? "Sending…" : "Send"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
