import React from "react";
import { Icon } from "@/src/components/Icon";
import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme } from "@/src/theme";

// Standard screen chrome: safe-area top, an optional navy header bar with a
// title and optional back button + right accessory.
export function Screen({
  children,
  title,
  showBack,
  onBack,
  right,
  scroll,
  padded = true,
}: {
  children: React.ReactNode;
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.brandPrimary }}>
        {title != null ? (
          <View style={styles.header}>
            {showBack ? (
              <Pressable testID="header-back-btn" onPress={() => (onBack ? onBack() : router.back())} hitSlop={12} style={styles.backBtn}>
                <Icon name="chevron-back" size={26} color={colors.onBrandPrimary}  footprint={26}/>
              </Pressable>
            ) : (
              <View style={styles.backBtn} />
            )}
            <Text numberOfLines={1} style={[styles.title, { color: colors.onBrandPrimary }]}>
              {title}
            </Text>
            <View style={styles.right}>{right}</View>
          </View>
        ) : null}
      </SafeAreaView>
      <View style={{ flex: 1, padding: padded && !scroll ? 16 : 0 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: {
    flex: 1,
    fontSize: Platform.OS === "web" ? 20 : 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  right: { minWidth: 40, alignItems: "flex-end", justifyContent: "center", paddingRight: 6 },
});
