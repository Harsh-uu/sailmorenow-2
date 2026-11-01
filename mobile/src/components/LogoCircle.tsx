import { Image as ExpoImage } from "expo-image";
import { View } from "react-native";

/**
 * Shared circular org logo (mobile). One source of truth for how an org logo
 * displays everywhere: a perfect circle, overflow hidden, image fills it with
 * contentFit "cover". A FIXED white background sits behind the image (theme-
 * independent) so a transparent PNG logo shows white in both light and dark
 * mode and on every card. The stored PNG stays transparent.
 */
export function LogoCircle({ uri, size = 48, fallback = null, testID, accessibilityLabel }: {
  uri?: string | null; size?: number; fallback?: React.ReactNode; testID?: string; accessibilityLabel?: string;
}) {
  const resolved = typeof uri === "string" && uri.startsWith("/api/")
    ? `${process.env.EXPO_PUBLIC_BACKEND_URL}${uri}`
    : uri || undefined;
  const wrap = { width: size, height: size, borderRadius: size / 2, overflow: "hidden" as const, alignItems: "center" as const, justifyContent: "center" as const };
  if (!resolved) {
    return <View style={wrap} testID={testID} accessibilityLabel={accessibilityLabel}>{fallback}</View>;
  }
  return (
    <View style={[wrap, { backgroundColor: "#fff" }]} testID={testID} accessibilityLabel={accessibilityLabel}>
      <ExpoImage source={{ uri: resolved }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
    </View>
  );
}
