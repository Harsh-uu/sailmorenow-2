import React from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/src/theme";
import { AppHeader } from "@/src/components/AppHeader";

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
      {title != null ? (
        <AppHeader title={title} showBack={showBack} onBack={onBack} right={right} />
      ) : (
        <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.brandPrimary }} />
      )}
      <View style={{ flex: 1, padding: padded && !scroll ? 16 : 0 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({});

