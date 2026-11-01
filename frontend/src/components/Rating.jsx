import { Stars } from "@/components/ReviewRatings";

// Compact display rating used on directory and club cards. Renders the shared
// Stars component so filled stars look identical everywhere on web.
export default function Rating({ value = 0, count = 0, size = "h-3.5 w-3.5" }) {
  return (
    <span className="inline-flex items-center gap-1" data-testid="rating">
      <Stars value={value || 0} size={size} />
      {typeof value === "number" && value > 0 && (
        <span className="text-xs text-slate-500 ml-1">{value.toFixed(1)} ({count})</span>
      )}
    </span>
  );
}
