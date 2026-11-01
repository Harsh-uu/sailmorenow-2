import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";

const AMBER = "#F2A03B";
const NAVY = "#1F3F5B";
const INK = "#10233A";
const SUPPORT = "mailto:customersupport@sailmorenow.com";

async function resend() {
  await api.post("/auth/send-verification", {});
}

function FixEmailRow({ onDone }: { onDone: () => void }) {
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
        <Text style={styles.linkTxt}>Wrong email? Fix it</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ width: "100%", gap: 8 }}>
      <TextInput
        testID="verify-fix-email-input" value={email} onChangeText={setEmail}
        placeholder="correct@email.com" autoCapitalize="none" keyboardType="email-address"
        placeholderTextColor="#94a3b8" style={styles.input}
      />
      <Pressable testID="verify-fix-email-submit" onPress={submit} disabled={busy} style={styles.darkBtn}>
        <Text style={styles.darkBtnTxt}>{busy ? "Saving…" : "Send new link"}</Text>
      </Pressable>
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
        <Text style={styles.darkPillTxt}>{cooldown > 0 ? `Resend ${cooldown}s` : "Resend"}</Text>
      </Pressable>
    </View>
  );
}

export function VerifyLockedScreen() {
  const { user, refresh, logout } = useAuth();
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
    <ScrollView testID="verify-locked" contentContainerStyle={[styles.lockWrap, { paddingTop: insets.top + 60 }]}>
      <Text style={styles.lockTitle}>Verify your email to continue</Text>
      <Text style={styles.lockBody}>
        Your 24-hour window has ended. Please verify {email} to unlock posting, messaging and checkout.
        The link we emailed still works.
      </Text>
      <Pressable testID="verify-locked-resend" onPress={doResend} disabled={cooldown > 0} style={styles.darkBtn}>
        <Text style={styles.darkBtnTxt}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend verification email"}</Text>
      </Pressable>
      <FixEmailRow onDone={refresh} />
      <View style={styles.lockFooter}>
        <Pressable testID="verify-locked-support" onPress={() => Linking.openURL(SUPPORT)}>
          <Text style={styles.footerLink}>Contact support</Text>
        </Pressable>
        <Pressable testID="verify-locked-signout" onPress={logout}>
          <Text style={styles.footerMuted}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: AMBER, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  bannerTxt: { flex: 1, color: INK, fontWeight: "700", fontSize: 13 },
  darkPill: { backgroundColor: INK, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  darkPillTxt: { color: "#fff", fontWeight: "800", fontSize: 12 },
  lockWrap: { paddingHorizontal: 24, paddingBottom: 40, alignItems: "center", gap: 14 },
  lockTitle: { fontSize: 24, fontWeight: "800", color: NAVY, textAlign: "center" },
  lockBody: { fontSize: 14, color: "#64748b", textAlign: "center", lineHeight: 21 },
  darkBtn: { backgroundColor: NAVY, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 13, width: "100%", alignItems: "center" },
  darkBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  linkBtn: { paddingVertical: 10 },
  linkTxt: { color: NAVY, fontWeight: "700", fontSize: 14 },
  input: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: INK, width: "100%" },
  lockFooter: { flexDirection: "row", gap: 24, marginTop: 8 },
  footerLink: { color: "#55B3AD", fontWeight: "700", fontSize: 13 },
  footerMuted: { color: "#94a3b8", fontWeight: "700", fontSize: 13 },
});
