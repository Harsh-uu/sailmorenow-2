import { Icon } from "@/components/Icon";

// Shared segmented control for 2 to 4 mutually-exclusive options that should
// stay visible at all times (e.g. My markets | All markets, List | Map).
// Theme-token styled; flips automatically in dark mode.
export default function SegmentedControl({ options, value, onChange, testId, ariaLabel }) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      className="inline-flex rounded-full border border-[var(--smn-border)] bg-[var(--smn-surface)] p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.ariaLabel || o.label}
            data-testid={`${testId}-${o.value}`}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 min-h-[40px] text-xs sm:text-sm font-semibold transition-colors ${
              active
                ? "bg-[var(--smn-navy)] text-white"
                : "text-[var(--smn-text-secondary)] hover:text-[var(--smn-text)]"
            }`}
          >
            {o.icon ? <Icon name={o.icon} tone="current" className="h-3.5 w-3.5" /> : null}
            <span className="truncate max-w-[9rem]">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
