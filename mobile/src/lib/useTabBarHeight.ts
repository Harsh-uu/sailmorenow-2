import { useContext } from "react";
import { BottomTabBarHeightContext } from "expo-router/build/react-navigation/bottom-tabs/index";

// Bottom tab bar height, or 0 when the screen is not inside a tab navigator
// (root routes). useBottomTabBarHeight() throws off a tab, so we read the
// context directly: it is undefined when there is no tab bar.
export function useTabBarHeight(): number {
  return useContext(BottomTabBarHeightContext) ?? 0;
}
