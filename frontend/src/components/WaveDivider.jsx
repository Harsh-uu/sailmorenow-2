/**
 * Subtle single-curve wave divider between two full-bleed sections.
 * The SVG paints its ENTIRE top area + the curve in whatever color the
 * parent supplies via a Tailwind `text-*` utility (`currentColor`), and
 * leaves the bottom of the SVG transparent so the section below shows
 * through the curve. That removes the "straight seam + wave" artefact
 * you get when the SVG only paints the bottom half — the color above
 * the curve is now driven by the divider itself, not by whatever
 * background the SVG happens to sit on top of.
 *
 * Usage:
 *   <section class="smn-hero">…</section>
 *   <WaveDivider className="text-[#17324a]" />   {/* fill = section above *\/}
 *   <section class="smn-band-a">…</section>
 *
 * `flip` mirrors the wave vertically for a below-to-above transition
 * (e.g. footer top edge).
 */
export default function WaveDivider({ className = "text-slate-50", flip = false, height = 70 }) {
  // Wave sits at y=50 in a 120-unit viewBox. Filled region is the whole
  // rectangle above y=50 plus the wave curve; below the curve is transparent.
  const path = flip
    ? "M0,120 L1440,120 L1440,60 C1200,20 960,100 720,60 C480,20 240,100 0,60 Z"
    : "M0,0 L1440,0 L1440,60 C1200,100 960,20 720,60 C480,100 240,20 0,60 Z";
  return (
    <div
      aria-hidden="true"
      data-testid="wave-divider"
      className={`w-full overflow-hidden leading-none pointer-events-none block ${className}`}
      style={{ height: `clamp(32px, 6vw, ${height}px)`, marginTop: "-1px", marginBottom: "-1px" }}
    >
      <svg
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
        className="block w-full h-full fill-current"
        role="presentation"
      >
        <path d={path} />
      </svg>
    </div>
  );
}
