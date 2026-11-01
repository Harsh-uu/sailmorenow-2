import { Stack } from "expo-router";
import { useTheme } from "@/src/theme";

// `anchor` makes the Profile menu (index) the base of this stack on cold deep
// links, so Back from any pushed screen (Reviews, listing editors) returns to
// the menu. In-app pushes into this stack use { withAnchor: true } for the same
// effect, and the Profile tab button resets to the menu on press.
export const unstable_settings = {
  anchor: "index",
};

// Stack for the Profile tab. The listing editors (org listing, Boat Pro listing
// card and Boat Pro edit) are pushed here, so they keep the bottom tab bar and
// Back returns to the previous screen in this tab.
export default function ProfileStackLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surfaceSecondary } }} />;
}
