import Svg, { Path } from "react-native-svg";

/**
 * Custom "burgee" glyph (mobile) — swallow-tail yacht-club pennant. Mirrors
 * frontend/src/components/icons/Burgee.jsx. Refined with a bolder tail and a
 * filled club-star on the hoist for legibility at small sizes.
 */
export function Burgee({ size = 24, color = "#000" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 2.5 L5 21.5" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <Path
        d="M5 4 L20 6.5 L16.5 8.5 L20 10.5 L5 13"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9.3 5.7 L9.86 7.23 L11.49 7.29 L10.2 8.29 L10.65 9.86 L9.3 8.95 L7.95 9.86 L8.4 8.29 L7.11 7.29 L8.74 7.23 Z"
        fill={color}
      />
    </Svg>
  );
}

export default Burgee;
