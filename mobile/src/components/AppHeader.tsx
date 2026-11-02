import React from "react";
import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { useTheme } from "@/src/theme";

// The ONE shared navy header bar for Screen.tsx and every tab header. Uses a
// minHeight (never a fixed height) so a large-text title is never clipped, and
// caps the title at 1.3x while allowing up to two lines (chrome tier).
export function AppHeader({
  title,
  right,
  showBack,
  onBack,
  statusBar = true,
  testID,
}: {
  title?: string;
  right?: React.ReactNode;
  showBack?: boolean;
  onBack?: () => void;
  statusBar?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.brandPrimary }} testID={testID}>
      {statusBar ? <StatusBar barStyle="light-content" /> : null}
      <View style={styles.header}>
        {showBack ? (
          <Pressable testID="header-back-btn" onPress={() => (onBack ? onBack() : router.back())} hitSlop={12} style={styles.backBtn}>
            <Icon name="chevron-back" size={26} color={colors.onBrandPrimary} footprint={26} />
          </Pressable>
        ) : null}
        <Text
          numberOfLines={2}
          maxFontSizeMultiplier={1.3}
          style={[styles.title, { color: colors.onBrandPrimary }]}
        >
          {title}
        </Text>
        {right != null ? <View style={styles.right}>{right}</View> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  backBtn: { width: 36, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -4 },
  title: {
    flex: 1,
    flexShrink: 1,
    fontSize: Platform.OS === "web" ? 20 : 19,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  right: { flexShrink: 0, alignItems: "flex-end", justifyContent: "center" },
});
