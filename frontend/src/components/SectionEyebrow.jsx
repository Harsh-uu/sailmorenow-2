/**
 * Teal-caps section eyebrow used above every H2 on the marketing surfaces
 * (Landing, Pricing, Contact, CommunityHub, HandleProfile, Directory). The
 * marketing site pairs each H2 with a small ALL-CAPS label; this component
 * standardises that pattern so kerning + color are consistent.
 */
export default function SectionEyebrow({ children, tone = "teal", className = "", testId }) {
  const toneClass =
    tone === "sun"
      ? "text-[#F2A03B]"
      : tone === "white"
      ? "text-white/80"
      : "text-[#2A7871] dark:text-[#7fcac4]";
  return (
    <div
      data-testid={testId}
      className={`text-[11px] font-bold uppercase tracking-[0.28em] ${toneClass} ${className}`}
    >
      {children}
    </div>
  );
}
