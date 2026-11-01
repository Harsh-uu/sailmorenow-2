import { Icon } from "@/components/Icon";
import { valueLabel, isTruthy } from "@/lib/planMatrix";

// Side-by-side "What's included" comparison for one matrix account type. Renders
// a feature per row with one value cell per level; the current level column is
// highlighted. Held rows (e.g. priority placement, pending confirmation) are
// hidden. Horizontally scrollable on small screens.
export default function PlanComparison({ type, currentLevel, testId = "plan-comparison" }) {
  if (!type) return null;
  const levels = type.levels || [];
  const rows = (type.features || []).filter((f) => !f.hold);

  const cell = (v) => {
    if (v === true) return <Icon name="check" tone="current" className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mx-auto" />;
    if (v === false || v == null) return <Icon name="close" tone="current" className="h-4 w-4 text-slate-300 dark:text-slate-600 mx-auto" />;
    return <span className="text-xs font-semibold smn-heading">{valueLabel(v)}</span>;
  };

  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table className="w-full min-w-[520px] border-collapse">
        <thead>
          <tr>
            <th className="text-left text-xs font-bold uppercase tracking-widest text-slate-400 py-2 pr-3 align-bottom">What's included</th>
            {levels.map((l) => {
              const isCur = l.key === currentLevel;
              return (
                <th key={l.key} data-testid={`${testId}-col-${l.key}`}
                    className={`text-center px-3 py-2 align-bottom ${isCur ? "" : ""}`}>
                  <div className={`inline-flex flex-col items-center gap-1 rounded-xl px-3 py-2 ${isCur ? "bg-[#1F3F5B] text-white dark:bg-[#F2A03B]" : "text-slate-500 dark:text-slate-400"}`}>
                    <span className="text-sm font-extrabold">{l.label}</span>
                    {isCur && <span className="text-[9px] font-bold uppercase tracking-widest" data-testid={`${testId}-current`}>Your plan</span>}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((f, i) => (
            <tr key={f.key} data-testid={`${testId}-row-${f.key}`}
                className={i % 2 ? "bg-slate-50/60 dark:bg-slate-900/30" : ""}>
              <td className="py-2.5 pr-3">
                <div className="text-sm font-semibold smn-heading">{f.label}{f.promised && <span className="ml-1.5 align-middle text-[9px] font-bold uppercase tracking-wide text-[#55B3AD]">included</span>}</div>
                {f.short && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{f.short}</div>}
              </td>
              {levels.map((l) => {
                const isCur = l.key === currentLevel;
                return (
                  <td key={l.key} className={`text-center px-3 py-2.5 ${isCur ? "bg-[#1F3F5B]/[0.04] dark:bg-[#F2A03B]/[0.06]" : ""}`}
                      data-testid={`${testId}-${f.key}-${l.key}`}>
                    {cell(f.values?.[l.key])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Compact single-column list of what a level is missing vs the top level. Used
// to remind free Sailors/Owners how limited free is.
export function MissingList({ type, currentLevel, compareLevel, testId = "plan-missing" }) {
  if (!type) return null;
  const missing = (type.features || []).filter((f) =>
    !f.hold && !isTruthy(f.values?.[currentLevel]) && isTruthy(f.values?.[compareLevel]));
  if (missing.length === 0) return null;
  return (
    <ul className="space-y-2" data-testid={testId}>
      {missing.map((f) => (
        <li key={f.key} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300" data-testid={`${testId}-${f.key}`}>
          <Icon name="lock" tone="current" className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />
          <span><b className="smn-heading">{f.label}</b>{f.short ? ` - ${f.short}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}
