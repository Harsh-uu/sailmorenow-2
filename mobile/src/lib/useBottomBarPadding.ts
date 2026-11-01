import { useContext } from "react";
import { Animated } from "react-native";
import { BottomBarPaddingContext } from "@/src/components/BottomBarKeyboardView";

/**
 * Animated bottom padding for a pinned bottom input bar. The value is owned and
 * animated by the surrounding BottomBarKeyboardView (resting inset when the
 * keyboard is closed, 10 when it is open). Apply it to an Animated.View bar.
 */
export function useBottomBarPadding(): Animated.Value | number {
  const v = useContext(BottomBarPaddingContext);
  return v ?? 10; // fallback if used outside the provider
}
