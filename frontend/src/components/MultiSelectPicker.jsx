import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

// Shared searchable picker for web. Single-select for the Directory (market /
// specialty); multi-select with an optional max + upgrade message for the
// listing editors, Crew Bank and Profile. The limit message + upgrade action
// are passed in as props so the component stays generic. Renders as an anchored
// popover on laptop widths and a bottom sheet on phone widths. Theme-token styled.
export default function MultiSelectPicker({
  label,
  options,            // [{ value, label, count? }]
  value,              // string[]
  onChange,
  single = false,
  max,
  limitMessage,
  onUpgrade,
  placeholder = "All",
  valueLabel,
  searchable = true,
  title,
  testId,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(value);
  const [limitHit, setLimitHit] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const current = single ? value : draft;
  const triggerText = single
    ? (value.length ? (valueLabel ?? options.find((o) => o.value === value[0])?.label ?? value[0]) : placeholder)
    : (value.length ? (valueLabel ?? `${label} (${value.length})`) : placeholder);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const openPanel = () => { setDraft(value); setLimitHit(false); setQuery(""); setOpen(true); };

  const pick = (v) => {
    if (single) { onChange(value[0] === v ? [] : [v]); setOpen(false); return; }
    const has = draft.includes(v);
    if (!has && typeof max === "number" && draft.length >= max) { setLimitHit(true); return; }
    setLimitHit(false);
    setDraft(has ? draft.filter((x) => x !== v) : [...draft, v]);
  };

  const panel = (
    <div
      data-testid={`${testId}-panel`}
      className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:left-0 sm:w-80 sm:rounded-2xl border border-[var(--smn-border)] bg-[var(--smn-surface)] shadow-xl p-4"
    >
      <div className="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
      <div className="font-display font-bold smn-heading text-base mb-2">{title ?? `Select ${label.toLowerCase()}`}</div>
      {searchable && (
        <div className="relative mb-2">
          <Icon name="search" tone="current" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            data-testid={`${testId}-search`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            aria-label={`Search ${label.toLowerCase()}`}
            className="w-full pl-9 pr-3 min-h-[44px] rounded-xl border border-[var(--smn-border)] bg-[var(--smn-surface)] text-[var(--smn-text)] focus:border-[var(--smn-teal)] outline-none"
          />
        </div>
      )}
      {limitHit && limitMessage && (
        <div data-testid={`${testId}-limit`} className="mb-2 rounded-xl border border-[var(--smn-orange)]/50 bg-[var(--smn-orange)]/[0.08] p-3">
          <div className="text-sm font-semibold text-[var(--smn-text)]">{limitMessage}</div>
          {onUpgrade && (
            <button type="button" data-testid={`${testId}-upgrade`} onClick={() => { setOpen(false); onUpgrade(); }}
              className="mt-2 inline-flex items-center rounded-full bg-[#F2A03B] px-4 min-h-[40px] text-sm font-semibold text-[#10233A]">Upgrade</button>
          )}
        </div>
      )}
      <div className="max-h-[50vh] sm:max-h-80 overflow-y-auto -mx-1 px-1">
        {filtered.map((o) => {
          const on = current.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role={single ? "radio" : "checkbox"}
              aria-checked={on}
              aria-label={o.label}
              data-testid={`${testId}-option-${o.value}`}
              onClick={() => pick(o.value)}
              className="w-full flex items-center gap-3 py-3 border-b border-[var(--smn-border)] text-left min-h-[44px]"
            >
              {!single && (
                <span className={`flex items-center justify-center h-[22px] w-[22px] rounded-md border-2 shrink-0 ${on ? "bg-[var(--smn-teal)] border-[var(--smn-teal)]" : "border-[var(--smn-border)]"}`}>
                  {on && <Icon name="check" tone="current" className="h-3.5 w-3.5 text-[#10233A]" />}
                </span>
              )}
              <span className={`flex-1 text-sm ${on ? "font-bold text-[var(--smn-text)]" : "text-[var(--smn-text)]"}`}>{o.label}</span>
              {typeof o.count === "number" && <span className="text-xs font-bold text-[var(--smn-text-secondary)]">{o.count}</span>}
              {single && on && <Icon name="check" tone="current" className="h-4 w-4 text-[var(--smn-teal)]" />}
            </button>
          );
        })}
        {filtered.length === 0 && <div className="py-5 text-center text-sm text-[var(--smn-text-secondary)]">No matches</div>}
      </div>
      {!single && (
        <div className="mt-3 flex gap-2">
          <button type="button" data-testid={`${testId}-clear`} onClick={() => { setDraft([]); setLimitHit(false); }}
            className="flex-1 rounded-full border border-[var(--smn-border)] min-h-[44px] text-sm font-semibold text-[var(--smn-text)]">Clear</button>
          <button type="button" data-testid={`${testId}-apply`} onClick={() => { onChange(draft); setOpen(false); }}
            className="flex-1 rounded-full bg-[var(--smn-navy)] text-white min-h-[44px] text-sm font-semibold">Apply</button>
        </div>
      )}
    </div>
  );

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        data-testid={testId}
        aria-label={ariaLabel ?? `${label}: ${triggerText}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--smn-border)] bg-[var(--smn-surface)] px-4 min-h-[44px] text-sm font-semibold text-[var(--smn-text)] hover:border-[var(--smn-teal)] transition-colors max-w-[15rem]"
      >
        <span className="truncate">{triggerText}</span>
        <Icon name="chevron-down" tone="current" className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" onClick={() => setOpen(false)} />
          {panel}
        </>
      )}
    </div>
  );
}
