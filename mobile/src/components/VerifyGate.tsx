import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";
import { Button } from "@/src/components/ui";

// The amber banner keeps a fixed amber background in both themes, so its dark
// ink text stays high-contrast regardless of light/dark mode.
const AMBER = "#F2A03B";
const INK = "#10233A";
const SUPPORT = "mailto:customersupport@sailmorenow.com";

async function resend() {
  await api.post("/auth/send-verification", {});
}

function FixEmailRow({ onDone }: { onDone: () => void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    if (!email.trim() || !email.includes("@")) { toast.error("Enter a valid email."); return; }
    setBusy(true);
    try {
      await api.post("/auth/change-email", { email: email.trim().toLowerCase() });
      toast.success("Email updated. Check your inbox for a new link.");
      setOpen(false); setEmail(""); onDone();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't change your email.");
    } finally { setBusy(false); }
  };
  if (!open) {
    return (
      <Pressable testID="verify-fix-email" onPress={() => setOpen(true)} style={styles.linkBtn}>
        <Text style={[styles.linkTxt, { color: colors.tealText }]}>Wrong email? Fix it</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ width: "100%", gap: 8 }}>
      <TextInput
        testID="verify-fix-email-input" value={email} onChangeText={setEmail}
        placeholder="correct@email.com" autoCapitalize="none" keyboardType="email-address"
        placeholderTextColor={colors.muted}
        style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }]}
      />
      <Button title={busy ? "Saving…" : "Send new link"} onPress={submit} loading={busy} testID="verify-fix-email-submit" style={{ width: "100%" }} />
    </View>
  );
}

export function VerifyBanner() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [cooldown, setCooldown] = useState(0);
  const v = (user as any)?.verification;

  useEffect(() => {
    if (!v?.required || v?.locked) return;
    const t = setInterval(() => refresh(), 20000);
    return () => clearInterval(t);
  }, [v?.required, v?.locked, refresh]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!v?.required || v?.locked) return null;
  const hours = Math.max(0, Math.ceil(v.hours_remaining ?? 0));
  const doResend = async () => {
    if (cooldown > 0) return;
    try { await resend(); toast.success("Verification email sent."); setCooldown(30); }
    catch (e: any) { toast.error(e?.message || "Couldn't send the email."); }
  };
  return (
    <View testID="verify-banner" style={[styles.banner, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.bannerTxt}>Verify your email within {hours} {hours === 1 ? "hour" : "hours"} to keep your account.</Text>
      <Pressable testID="verify-resend" onPress={doResend} disabled={cooldown > 0} style={styles.darkPill}>
        <Text style={styles.darkPillTxt} maxFontSizeMultiplier={1.2}>{cooldown > 0 ? `Resend ${cooldown}s` : "Resend"}</Text>
      </Pressable>
    </View>
  );
}

export function VerifyLockedScreen() {
  const { user, refresh, logout } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [cooldown, setCooldown] = useState(0);
  const ran = useRef(false);

  useEffect(() => {
    const t = setInterval(() => refresh(), 15000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const doResend = async () => {
    if (cooldown > 0) return;
    try { await resend(); toast.success("Verification email sent."); setCooldown(30); }
    catch (e: any) { toast.error(e?.message || "Couldn't send the email."); }
  };
  const email = (user as any)?.verification?.email || "your email";
  return (
    <ScrollView
      testID="verify-locked"
      style={{ backgroundColor: colors.surfaceSecondary }}
      contentContainerStyle={[styles.lockWrap, { paddingTop: insets.top + 60, backgroundColor: colors.surfaceSecondary }]}
    >
      <Text style={[styles.lockTitle, { color: colors.onSurface }]}>Verify your email to continue</Text>
      <Text style={[styles.lockBody, { color: colors.onSurfaceSecondary }]}>
        Your 24-hour window has ended. Please verify {email} to unlock posting, messaging and checkout.
        The link we emailed still works.
      </Text>
      <Button
        title={cooldown > 0 ? `Resend in ${cooldown}s` : "Resend verification email"}
        onPress={doResend}
        disabled={cooldown > 0}
        testID="verify-locked-resend"
        style={{ width: "100%" }}
      />
      <FixEmailRow onDone={refresh} />
      <View style={styles.lockFooter}>
        <Pressable testID="verify-locked-support" onPress={() => Linking.openURL(SUPPORT)}>
          <Text style={[styles.footerLink, { color: colors.tealText }]}>Contact support</Text>
        </Pressable>
        <Pressable testID="verify-locked-signout" onPress={logout}>
          <Text style={[styles.footerMuted, { color: colors.onSurfaceSecondary }]}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: AMBER, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  bannerTxt: { flex: 1, color: INK, fontWeight: "700", fontSize: 13 },
  darkPill: { backgroundColor: INK, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, flexShrink: 0 },
  darkPillTxt: { color: "#fff", fontWeight: "800", fontSize: 12 },
  lockWrap: { paddingHorizontal: 24, paddingBottom: 40, alignItems: "center", gap: 14, flexGrow: 1 },
  lockTitle: { fontSize: 24, fontWeight: "800", textAlign: "center" },
  lockBody: { fontSize: 14, textAlign: "center", lineHeight: 21 },
  linkBtn: { paddingVertical: 10 },
  linkTxt: { fontWeight: "700", fontSize: 14 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, fontSize: 14, width: "100%" },
  lockFooter: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: 24, rowGap: 10, marginTop: 8 },
  footerLink: { fontWeight: "700", fontSize: 13 },
  footerMuted: { fontWeight: "700", fontSize: 13 },
});
