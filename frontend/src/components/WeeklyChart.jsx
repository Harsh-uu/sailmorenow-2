/**
 * Reusable stacked-bar chart for last N weekly buckets.
 * Data shape: [{ week_start: 'YYYY-MM-DD', count: number }, ...] in ascending order.
 */
export default function WeeklyChart({ data = [], color = "#F2A03B", emptyLabel = "No data in the last few weeks.", testId }) {
  const total = data.reduce((s, w) => s + (w.count || 0), 0);
  if (total === 0) {
    return (
      <div className="h-24 flex items-center justify-center text-sm text-slate-400" data-testid={testId ? `${testId}-empty` : undefined}>
        {emptyLabel}
      </div>
    );
  }
  const max = Math.max(1, ...data.map((w) => w.count || 0));
  return (
    <div className="flex items-end gap-1.5 h-24" data-testid={testId}>
      {data.map((w) => (
        <div key={w.week_start} className="flex-1 h-full flex flex-col items-stretch gap-1"
             title={`Week of ${w.week_start}: ${w.count}`}>
          <div className="flex-1 min-h-0 flex items-end">
            <div className="w-full rounded-t-md transition-colors"
                 style={{ height: `${((w.count || 0) / max) * 100}%`, minHeight: w.count ? 4 : 2, background: color }} />
          </div>
          <div className="text-[9px] text-slate-400 font-mono text-center">{(w.week_start || "").slice(5)}</div>
        </div>
      ))}
    </div>
  );
}
