import { useLocalSearchParams, router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "@/src/components/Icon";
import { Screen } from "@/src/components/Screen";
import { Button } from "@/src/components/ui";
import { useTheme } from "@/src/theme";

export default function VerifyReturn() {
  const { colors } = useTheme();
  const { verified } = useLocalSearchParams<{ verified?: string }>();
  const isVerified = verified === "1";
  return (
    <Screen title="Identity" showBack padded={false}>
      <View style={styles.wrap} testID="verify-confirm-screen">
        <Icon name={isVerified ? "shield-checkmark" : "checkmark-circle"} size={64} color={colors.teal} footprint={64} />
        <Text style={[styles.title, { color: colors.onSurface }]} testID="verify-confirm-title">
          {isVerified ? "You're verified!" : "Verification submitted"}
        </Text>
        <Text style={[styles.body, { color: colors.onSurfaceSecondary }]}>
          {isVerified
            ? "Your ID Verified badge is now active on your profile."
            : "Thanks! Your documents are pending review. Your badge will appear once Stripe finishes checking, usually within a few minutes."}
        </Text>
        <Button title="Back to profile" onPress={() => router.replace("/(tabs)/profile")} testID="verify-confirm-btn" style={{ marginTop: 20 }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  title: { fontSize: 22, fontWeight: "800", marginTop: 12, textAlign: "center" },
  body: { fontSize: 15, lineHeight: 22, textAlign: "center" },
});
