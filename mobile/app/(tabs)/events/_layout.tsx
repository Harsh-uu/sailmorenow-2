import { Stack } from "expo-router";
import { useTheme } from "@/src/theme";

// Events tab stack. Detail screens pushed here stay inside the tab so the
// bottom tab bar stays visible. `anchor` is the expo-router 57 stack anchor.
export const unstable_settings = { anchor: "index" };

export default function EventsStackLayout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surfaceSecondary } }} />;
}
