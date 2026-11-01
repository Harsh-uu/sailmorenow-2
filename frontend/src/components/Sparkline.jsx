/**
 * Compact inline sparkline for stat cards. Renders an SVG polyline over the
 * last N weekly buckets. `data` shape: [{ week_start, count }, ...] ascending.
 */
export default function Sparkline({ data = [], color = "#55B3AD", width = 80, height = 24, testId }) {
  if (!Array.isArray(data) || data.length < 2) {
    return <span className="inline-block" style={{ width, height }} data-testid={testId} />;
  }
  const totalCount = data.reduce((s, w) => s + (w.count || 0), 0);
  if (totalCount === 0) {
    // All-zero series would render a flat baseline that reads like a rule —
    // hide it so the card doesn't look decorated.
    return <span className="inline-block" style={{ width, height }} data-testid={testId} />;
  }
  // Trim leading zero buckets so a long flat baseline doesn't read as a stray
  // rule. Keep at least 2 points so we can draw a line.
  const firstNonZero = data.findIndex((w) => (w.count || 0) > 0);
  const trimmed = firstNonZero > 0 && data.length - firstNonZero >= 2
    ? data.slice(firstNonZero)
    : data;
  const max = Math.max(1, ...trimmed.map((w) => w.count || 0));
  const step = width / (trimmed.length - 1);
  const points = trimmed.map((w, i) => {
    const x = (i * step).toFixed(1);
    const y = (height - ((w.count || 0) / max) * (height - 3) - 2).toFixed(1);
    return `${x},${y}`;
  }).join(" ");
  const last = trimmed[trimmed.length - 1];
  const lastX = ((trimmed.length - 1) * step).toFixed(1);
  const lastY = (height - ((last.count || 0) / max) * (height - 3) - 2).toFixed(1);
  return (
    <svg width={width} height={height} data-testid={testId} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={points} />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}
