/**
 * Custom "burgee" glyph — the swallow-tail yacht-club pennant a boat flies
 * from its masthead. No icon library ships a real burgee, so this is our one
 * sanctioned custom mark. Monochrome + currentColor-driven so it inherits the
 * unified <Icon> tone system exactly like the lucide set.
 *
 * Refined for small-size legibility: a bolder swallow-tail and a small filled
 * club-star on the hoist so it stays unmistakable down to ~16px.
 *
 * @param {{ size?: number, color?: string, strokeWidth?: number, className?: string }} props
 */
export function Burgee({ size = 24, color = "currentColor", strokeWidth = 1.75, className, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      {/* mast / pole */}
      <path d="M5 2.5 L5 21.5" />
      {/* swallow-tail pennant */}
      <path d="M5 4 L20 6.5 L16.5 8.5 L20 10.5 L5 13" />
      {/* club-star emblem on the hoist */}
      <path
        d="M9.3 5.7 L9.86 7.23 L11.49 7.29 L10.2 8.29 L10.65 9.86 L9.3 8.95 L7.95 9.86 L8.4 8.29 L7.11 7.29 L8.74 7.23 Z"
        fill={color}
        stroke="none"
      />
    </svg>
  );
}

export default Burgee;
