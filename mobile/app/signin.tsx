import { useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { Button } from "@/src/components/ui";
import { GoogleButton } from "@/src/components/GoogleButton";
import { useAuth } from "@/src/context/AuthContext";
import { ApiError } from "@/src/lib/api";
import { useTheme } from "@/src/theme";

export default function SignIn() {
  const { emailLogin, login, signingIn } = useAuth();
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailKb = useKbField("signin-email");
  const passKb = useKbField("signin-pass");

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await emailLogin(email.trim(), password);
      router.replace("/(tabs)/feed");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardFormScreen title="Sign in" testID="signin-scroll">
        <Text style={[styles.lead, { color: colors.onSurface }]}>Welcome back</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>Sign in to your Sail More Now account.</Text>

        <View onLayout={emailKb.onLayout}>
          <Label>Email</Label>
          <TextInput
            testID="signin-email-input"
            value={email}
            onFocus={emailKb.onFocus}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            style={inp(colors)}
          />
        </View>

        <View onLayout={passKb.onLayout}>
          <Label>Password</Label>
          <View style={[styles.pwWrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <TextInput
              testID="signin-password-input"
              value={password}
              onFocus={passKb.onFocus}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={colors.muted}
              secureTextEntry={!show}
              autoCapitalize="none"
              style={{ flex: 1, fontSize: 15, color: colors.onSurface }}
            />
            <Pressable onPress={() => setShow((s) => !s)} hitSlop={8}>
              <Icon name={show ? "eye-off-outline" : "eye-outline"} size={20} color={colors.muted}  footprint={20}/>
            </Pressable>
          </View>
        </View>

        {error ? <Text testID="signin-error" style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

        <Pressable onPress={() => router.push("/forgot-password")} testID="forgot-password-link" style={{ marginTop: 14, alignSelf: "flex-end" }} hitSlop={8}>
          <Text style={{ color: colors.teal, fontWeight: "700", fontSize: 13 }}>Forgot password?</Text>
        </Pressable>

        <Button title="Sign in" onPress={submit} loading={busy} testID="signin-submit-btn" style={{ marginTop: 18 }} />

        <View style={styles.divider}>
          <View style={[styles.line, { backgroundColor: colors.border }]} />
          <Text style={{ color: colors.muted, fontSize: 12 }}>OR</Text>
          <View style={[styles.line, { backgroundColor: colors.border }]} />
        </View>

        <GoogleButton onPress={login} loading={signingIn} testID="signin-google-btn" />

        <Pressable onPress={() => router.replace("/register")} style={{ marginTop: 20 }}>
          <Text style={{ color: colors.muted, textAlign: "center", fontSize: 14 }}>
            New here? <Text style={{ color: colors.teal, fontWeight: "700" }}>Create an account</Text>
          </Text>
        </Pressable>
    </KeyboardFormScreen>
  );
}

function Label({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.label, { color: colors.onSurface }]}>{children}</Text>;
}
const inp = (colors: any) => [styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }];

const styles = StyleSheet.create({
  lead: { fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  sub: { fontSize: 14, marginTop: 4 },
  label: { fontSize: 14, fontWeight: "800", marginTop: 20, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 15 },
  pwWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 50 },
  error: { fontSize: 13.5, marginTop: 12, fontWeight: "600" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 20 },
  line: { flex: 1, height: 1 },
});
