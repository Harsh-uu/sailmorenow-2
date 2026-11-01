import { forwardRef } from "react";
import { Icon } from "@/components/Icon";

// Shared "Filters" button. Combines several filters behind one control and
// shows a count badge of how many are currently active. forwardRef so it can
// be used as a Radix Popover/Sheet trigger via `asChild`.
const FilterButton = forwardRef(function FilterButton(
  { count = 0, onClick, testId = "filters-btn", label = "Filters", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-label={count ? `${label}, ${count} active` : label}
      className="inline-flex items-center gap-2 rounded-full border border-[var(--smn-border)] bg-[var(--smn-surface)] px-4 min-h-[44px] text-sm font-semibold text-[var(--smn-text)] hover:border-[var(--smn-teal)] transition-colors"
      {...rest}
    >
      <Icon name="sliders-horizontal" tone="current" className="h-4 w-4" /> {label}
      {count > 0 && (
        <span
          data-testid={`${testId}-count`}
          className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-[var(--smn-orange)] text-[#10233A] text-[11px] font-bold"
        >
          {count}
        </span>
      )}
    </button>
  );
});

export default FilterButton;
