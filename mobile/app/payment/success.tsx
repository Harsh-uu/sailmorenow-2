import { useLocalSearchParams, router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "@/src/components/Icon";
import { Screen } from "@/src/components/Screen";
import { Button } from "@/src/components/ui";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";

export default function PaymentConfirm() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { result } = useLocalSearchParams<{ result?: string }>();
  const canceled = result === "canceled";
  const paid = result === "paid";
  return (
    <Screen title="Payment" showBack padded={false}>
      <View style={styles.wrap} testID="payment-confirm-screen">
        <Icon
          name={canceled ? "close-circle-outline" : paid ? "checkmark-circle" : "time-outline"}
          size={64}
          color={canceled ? colors.muted : colors.teal}
          footprint={64}
        />
        <Text style={[styles.title, { color: colors.onSurface }]} testID="payment-confirm-title">
          {canceled ? "Payment canceled" : paid ? "You're all set!" : "Payment pending"}
        </Text>
        <Text style={[styles.body, { color: colors.onSurfaceSecondary }]}>
          {canceled
            ? "No charge was made. You can pick a plan whenever you're ready."
            : paid
              ? "Your membership is now active. More time on the water awaits."
              : "If you completed payment, it may take a moment to reflect."}
        </Text>
        {paid && user?.account_type === "boat_pro" ? (
          <>
            <Button title="Set up your listing" onPress={() => router.replace("/profile/boat-pro-listing")} testID="success-setup-listing-btn" style={{ marginTop: 20 }} />
            <Button title="Done" variant="secondary" onPress={() => router.replace("/(tabs)/profile")} testID="payment-confirm-btn" style={{ marginTop: 10 }} />
          </>
        ) : (
          <Button title={canceled ? "Back to plans" : "Done"} onPress={() => router.replace(canceled ? "/pricing" : "/(tabs)/profile")} testID="payment-confirm-btn" style={{ marginTop: 20 }} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  title: { fontSize: 22, fontWeight: "800", marginTop: 12, textAlign: "center" },
  body: { fontSize: 15, lineHeight: 22, textAlign: "center" },
});
