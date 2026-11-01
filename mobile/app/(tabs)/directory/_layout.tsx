import { Stack } from "expo-router";
import { useTheme } from "@/src/theme";

// Anchor the Pros/Orgs tab on the Boat Pros list (index). This guarantees the
// tab opens on the directory list and that Back from any pushed detail
// (clubs, org/[id], u/[handle], [id]) returns to the previous in-tab screen
// and finally to the list. `anchor` is the expo-router 57 replacement for the
// deprecated `initialRouteName`.
export const unstable_settings = {
  anchor: "index",
};

// Stack for the Pros/Orgs tab. Detail screens pushed here (Clubs directory,
// org and Boat Pro listings, public profiles) stay inside the tab, so the
// bottom tab bar stays visible and Back returns to the previous screen.
export default function DirectoryStackLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surfaceSecondary } }} />;
}
