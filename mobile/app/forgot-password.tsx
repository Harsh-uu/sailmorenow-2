import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { Button } from "@/src/components/ui";
import { api, ApiError } from "@/src/lib/api";
import { useTheme } from "@/src/theme";

const GENERIC = "If an account exists for that email, we sent a reset link. Check your inbox and spam folder.";

export default function ForgotPassword() {
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailKb = useKbField("forgot-email");

  const submit = async () => {
    if (busy) return;
    if (!email.trim()) {
      setError("Enter your email address");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardFormScreen title="Reset your password" testID="forgot-scroll">
      {sent ? (
        <View testID="forgot-sent">
          <Text style={[styles.lead, { color: colors.onSurface }]}>Check your email</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{GENERIC}</Text>
          <Button
            title="Back to sign in"
            onPress={() => router.replace("/signin")}
            testID="forgot-back-btn"
            style={{ marginTop: 22 }}
          />
        </View>
      ) : (
        <>
          <Text style={[styles.lead, { color: colors.onSurface }]}>Forgot your password?</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>Enter your email and we will send a link to reset it.</Text>

          <View onLayout={emailKb.onLayout}>
            <Text style={[styles.label, { color: colors.onSurface }]}>Email</Text>
            <TextInput
              testID="forgot-email-input"
              value={email}
              onFocus={emailKb.onFocus}
              onChangeText={(t) => { setEmail(t); if (error) setError(null); }}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }]}
            />
          </View>

          {error ? <Text testID="forgot-error" style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

          <Button
            title="Send reset link"
            onPress={submit}
            loading={busy}
            testID="forgot-submit-btn"
            style={{ marginTop: 18 }}
          />

          <Pressable onPress={() => router.replace("/signin")} style={{ marginTop: 20 }} hitSlop={8}>
            <Text style={{ color: colors.muted, textAlign: "center", fontSize: 14 }}>
              <Text style={{ color: colors.teal, fontWeight: "700" }}>Back to sign in</Text>
            </Text>
          </Pressable>
        </>
      )}
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  sub: { fontSize: 14, marginTop: 6, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: "800", marginTop: 22, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 15 },
  error: { fontSize: 13.5, marginTop: 12, fontWeight: "600" },
});
