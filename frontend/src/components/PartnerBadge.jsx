import { Icon } from "@/components/Icon";

// Community Partner badge. `kind` is "founding" (gold flag) or "partner" (teal flag).
// `variant`:
//   "flag" (default) — flag icon ONLY, used on feed/forum/blog/marketplace post &
//     activity cards and directory/Clubs cards, so a flag can never crowd or
//     truncate an org name (the name always gets the space first).
//   "full" — flag + status text ("Founding Partner" / "Community Partner"), used on
//     the org public listing page and the org editor card preview.
// FREE orgs have no `kind`, so nothing renders (no "Club / Org" tag).
export function PartnerBadge({ kind, variant = "flag", className = "" }) {
  if (!kind) return null;
  const founding = kind === "founding";
  const label = founding ? "Founding Partner" : "Community Partner";
  const flagColor = founding ? "text-[#F2A03B]" : "text-[#55B3AD]";
  const testId = founding ? "founding-partner-badge" : "community-partner-badge";
  if (variant === "full") {
    return (
      <span
        data-testid={testId}
        aria-label={label}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-white ${className}`}
      >
        <Icon name="flag" tone="current" className={`h-3.5 w-3.5 ${flagColor}`} />
        {label}
      </span>
    );
  }
  return (
    <span
      data-testid={testId}
      title={label}
      aria-label={label}
      className={`inline-flex shrink-0 items-center align-middle ${className}`}
    >
      <Icon name="flag" tone="current" className={`h-3.5 w-3.5 ${flagColor}`} />
    </span>
  );
}

export default PartnerBadge;
