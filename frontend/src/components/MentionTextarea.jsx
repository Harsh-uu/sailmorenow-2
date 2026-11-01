import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import Avatar from "@/components/Avatar";

/**
 * Lightweight @mention autocomplete for a plain textarea. Wraps a native
 * <textarea> and shows a dropdown of users when the caret is inside an @token.
 * Selecting a candidate replaces the token with `@Name` (spaces stripped).
 */
export default function MentionTextarea({ value, onChange, onSubmit, disabled, testId, placeholder, rows = 2, className = "", wrapperClassName = "flex-1 relative" }) {
  const ref = useRef(null);
  const [candidates, setCandidates] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [popRange, setPopRange] = useState(null); // { start, end, token }

  // Find the @token that currently contains the caret.
  const detectToken = (text, caret) => {
    const upto = text.slice(0, caret);
    const m = /(^|[\s])@([A-Za-z][A-Za-z0-9_'.\-]{0,40})$/.exec(upto);
    if (!m) return null;
    const token = m[2] || "";
    return { start: caret - token.length - 1, end: caret, token };
  };

  const currentToken = popRange?.token ?? null;

  useEffect(() => {
    if (currentToken == null || currentToken.length < 1) {
      setCandidates([]); return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/users/search?q=${encodeURIComponent(currentToken)}`);
        if (!cancelled) { setCandidates(data.users || []); setActiveIdx(0); }
      } catch { if (!cancelled) setCandidates([]); }
    }, 120);
    return () => { cancelled = true; clearTimeout(t); };
  }, [currentToken]);

  const onInput = (e) => {
    const v = e.target.value;
    onChange(v);
    const range = detectToken(v, e.target.selectionStart || v.length);
    setPopRange(range);
  };

  const insert = (u) => {
    if (!popRange || !ref.current) return;
    // Prefer the unique handle when present; fall back to name-strip so we
    // stay backwards-compatible with users who haven't set one yet.
    const label = u.handle ? u.handle : (u.name || "").replace(/\s+/g, "");
    const insertion = `@${label} `;
    const before = value.slice(0, popRange.start);
    const after = value.slice(popRange.end);
    const next = before + insertion + after;
    onChange(next);
    setPopRange(null); setCandidates([]);
    // Restore caret just after the inserted mention.
    requestAnimationFrame(() => {
      const pos = (before + insertion).length;
      ref.current.focus();
      try { ref.current.setSelectionRange(pos, pos); } catch { /* noop */ }
    });
  };

  const onKeyDown = (e) => {
    if (candidates.length && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape")) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => (i + 1) % candidates.length); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx((i) => (i - 1 + candidates.length) % candidates.length); return; }
      if (e.key === "Enter")     { e.preventDefault(); insert(candidates[activeIdx]); return; }
      if (e.key === "Escape")    { setPopRange(null); setCandidates([]); return; }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) { e.preventDefault(); onSubmit(); }
  };

  const showPop = useMemo(() => popRange && candidates.length > 0, [popRange, candidates]);

  return (
    <div className={wrapperClassName}>
      <textarea ref={ref}
                value={value}
                onChange={onInput}
                onKeyDown={onKeyDown}
                disabled={disabled}
                data-testid={testId}
                placeholder={placeholder}
                rows={rows}
                className={className} />
      {showPop && (
        <div className="absolute bottom-full mb-1 left-2 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-40 min-w-[220px]"
             data-testid="mention-popover">
          {candidates.map((u, i) => (
            <button key={u.user_id} type="button" onMouseDown={(e) => { e.preventDefault(); insert(u); }}
                    data-testid={`mention-candidate-${u.user_id}`}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm ${i === activeIdx ? "bg-slate-100" : "hover:bg-slate-50"}`}>
              <Avatar src={u.avatar} className="h-6 w-6" alt={u.name || ""} fallback={(u.name || "?").slice(0, 1).toUpperCase()} fallbackClassName="text-[10px] font-bold" />
              <div className="flex-1 min-w-0">
                <div className="truncate text-[#1F3F5B] font-semibold">{u.name || "Unnamed"}</div>
                {u.handle && <div className="truncate text-xs text-slate-500">@{u.handle}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
