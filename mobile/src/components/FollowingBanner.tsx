import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { useTheme } from "@/src/theme";

// Compact entry point to the Following feed. Shown on the Hub & Events banners
// instead of a dedicated tab (keeps the tab bar short).
export function FollowingBanner() {
  const { colors } = useTheme();
  return (
    <Pressable
      testID="following-banner"
      onPress={() => router.push("/following" as any)}
      style={[styles.wrap, { backgroundColor: colors.brandTertiary, borderColor: colors.teal }]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.tealSoft }]}>
        <Icon name="org" size={18} color={colors.teal} footprint={18} />
      </View>
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.onBrandTertiary, fontWeight: "800", fontSize: 14.5 }}>Following</Text>
        <Text style={{ color: colors.onBrandTertiary, opacity: 0.85, fontSize: 12.5 }} numberOfLines={2} maxFontSizeMultiplier={1.2}>
          Latest from clubs &amp; orgs you follow
        </Text>
      </View>
      <Icon name="chevron-forward" size={18} color={colors.onBrandTertiary} footprint={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
