import { Icon } from "@/components/Icon";

/** Accessible star row. Real text value is rendered by callers, not here. */
export function Stars({ value = 0, size = "h-4 w-4" }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${Number(value || 0).toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name="reviews" tone="current" aria-hidden="true"
              className={`${size} ${n <= Math.round(value) ? "text-[#F2A03B] fill-[#F2A03B]" : "text-slate-300 dark:text-slate-600"}`} />
      ))}
    </span>
  );
}

/** Shared interactive 1-5 star input (accessible radiogroup). One source of
 *  truth for the selectable stars on both review forms. */
export function StarInput({ value = 0, onChange, testId, label, size = "h-5 w-5" }) {
  return (
    <div className="flex items-center gap-1" data-testid={testId} role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} data-testid={testId ? `${testId}-${n}` : undefined}
                role="radio" aria-checked={n === value} aria-label={`${n} star${n > 1 ? "s" : ""}`}
                className="p-1.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#55B3AD]">
          <Icon name="reviews" tone="current" className={`${size} ${n <= value ? "text-[#F2A03B] fill-[#F2A03B]" : "text-slate-300 dark:text-slate-600"}`} />
        </button>
      ))}
    </div>
  );
}

/**
 * Shared compact factor list (no boxes). Used for both the rating summary and
 * per-review optional factors so web stays consistent.
 *
 * rows: [{ key, label, value, suffix? }]
 * stackStarsOnPhone=true  -> summary: label+value on one line, stars on the line
 *                            below at phone width; everything inline on sm+.
 * stackStarsOnPhone=false -> per-review: always one line (label value stars).
 */
export function FactorList({ rows, stackStarsOnPhone = false, size = "h-4 w-4", labelWidth = "w-32", testId }) {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-700/60" data-testid={testId}>
      {rows.map((r) => (
        <div key={r.key}
             className={`py-1.5 ${stackStarsOnPhone ? "flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3" : "flex items-center gap-2"}`}>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className={`${stackStarsOnPhone ? labelWidth : ""} shrink-0 text-sm font-semibold text-[#1F3F5B] dark:text-slate-200`}>{r.label}</span>
            <span className="text-sm text-slate-600 dark:text-slate-300 tabular-nums">{Number(r.value).toFixed(1)}</span>
          </div>
          <span className="flex items-center gap-2">
            <Stars value={r.value} size={size} />
            {r.suffix && <span className="text-xs text-slate-500 dark:text-slate-400">{r.suffix}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** "Oct 14, 2026" from an ISO date (the app's medium date style). */
export function fmtReviewDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
