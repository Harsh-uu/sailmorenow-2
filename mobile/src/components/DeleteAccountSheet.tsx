import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Button } from "@/src/components/ui";
import { api, ApiError } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";
import { PRIVACY_URL } from "@/src/constants/legal";

export function DeleteAccountSheet() {
  const { colors } = useTheme();
  const { logout } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [preview, setPreview] = useState<any>(null);
  const [code, setCode] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<any>(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const startCooldown = () => {
    setCooldown(60);
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((c) => (c <= 1 ? (clearInterval(timer.current), 0) : c - 1));
    }, 1000);
  };

  const openFlow = async () => {
    setOpen(true); setStep(1); setCode(""); setConfirmText(""); setPreview(null);
    try { setPreview(await api.get("/account/delete/preview")); } catch { /* ignore */ }
  };

  const sendCode = async () => {
    setBusy(true);
    try {
      await api.post("/account/delete/send-code", {});
      toast.success("We emailed you a 6-digit code.");
      setStep(2);
      startCooldown();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not send the code.");
    } finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.post("/account/delete/confirm", { code: code.trim(), confirm_text: confirmText });
      toast.success("Your account has been deleted.");
      setOpen(false);
      try { await logout(); } catch { /* ignore */ }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete your account.");
    } finally { setBusy(false); }
  };

  const ownsBusiness = preview && (preview.owns_listing || preview.is_org);

  const input = {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    color: colors.onSurface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15,
  } as const;

  return (
    <View testID="delete-account-section" style={{ marginBottom: 18, marginTop: 8 }}>
      <Text style={{ color: "#DC2626", fontSize: 12, fontWeight: "800", letterSpacing: 0.4, marginBottom: 10 }}
            maxFontSizeMultiplier={1.4}>DANGER ZONE</Text>
      <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 }} maxFontSizeMultiplier={1.6}>
        This permanently removes your profile and personal data. It cannot be undone.
      </Text>
      <Button title="Delete account" variant="danger" icon="trash-outline" onPress={openFlow} testID="delete-account-open-btn" />

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => { if (!busy) setOpen(false); }}>
        <Pressable style={styles.backdrop} onPress={() => { if (!busy) setOpen(false); }}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
              <Text style={{ color: colors.onSurface, fontSize: 20, fontWeight: "800", marginBottom: 8 }} maxFontSizeMultiplier={1.4}>
                Delete account
              </Text>
              {step === 1 ? (
                <View testID="delete-step-explain">
                  <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21 }} maxFontSizeMultiplier={1.6}>
                    Deleting your account removes your profile, posts, comments, listings, reviews, messages and photos. We keep a small set of records we are legally required to retain, with your name and contact details removed.
                  </Text>
                  {preview?.store_plan ? (
                    <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21, marginTop: 12 }} maxFontSizeMultiplier={1.6}>
                      If you pay through the App Store or Google Play, cancel that subscription in the store. On iPhone: Settings, your name, Subscriptions. On Android: Play Store, Payments and subscriptions.
                    </Text>
                  ) : preview?.has_active_plan ? (
                    <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21, marginTop: 12 }} maxFontSizeMultiplier={1.6}>
                      Your paid plan will be cancelled immediately with no refund.
                    </Text>
                  ) : null}
                  {ownsBusiness ? (
                    <View testID="delete-business-warning" style={{ marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: "#FCA5A5", backgroundColor: "#FEF2F2", padding: 12 }}>
                      <Text style={{ color: "#B91C1C", fontSize: 14, fontWeight: "700", lineHeight: 20 }} maxFontSizeMultiplier={2}>
                        You manage a business listing or organization. Deleting also removes your listing, reviews written about you, your followers, and your plan, cancelled immediately with no refund.
                      </Text>
                    </View>
                  ) : null}
                  <Pressable onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)} testID="delete-privacy-link" style={{ marginTop: 12 }}>
                    <Text style={{ color: colors.teal, fontSize: 14, fontWeight: "700" }} maxFontSizeMultiplier={1.6}>Read our Privacy Policy</Text>
                  </Pressable>
                  <View style={{ marginTop: 18 }}>
                    <Button title="Email me a code" variant="danger" loading={busy} onPress={sendCode} testID="delete-send-code-btn" />
                  </View>
                </View>
              ) : (
                <View testID="delete-step-confirm">
                  <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21 }} maxFontSizeMultiplier={1.6}>
                    We emailed a 6-digit code. Enter it below and type DELETE to confirm. The code expires in 15 minutes.
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 16, marginBottom: 6 }} maxFontSizeMultiplier={1.4}>CODE</Text>
                  <TextInput value={code} onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                             keyboardType="number-pad" placeholder="000000" placeholderTextColor={colors.muted}
                             testID="delete-code-input" maxFontSizeMultiplier={1.4}
                             style={[input, { letterSpacing: 8, fontSize: 20, fontWeight: "700" }]} />
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 16, marginBottom: 6 }} maxFontSizeMultiplier={1.4}>TYPE DELETE TO CONFIRM</Text>
                  <TextInput value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters"
                             placeholder="DELETE" placeholderTextColor={colors.muted} testID="delete-confirm-text-input"
                             maxFontSizeMultiplier={1.4} style={input} />
                  <View style={{ marginTop: 18 }}>
                    <Button title="Delete my account" variant="danger" loading={busy}
                            disabled={code.length !== 6 || confirmText !== "DELETE"}
                            onPress={confirmDelete} testID="delete-confirm-btn" />
                  </View>
                  <Pressable disabled={busy || cooldown > 0} onPress={sendCode} testID="delete-resend-btn" style={{ marginTop: 14, alignItems: "center" }}>
                    <Text style={{ color: colors.muted, fontSize: 14, fontWeight: "700" }} maxFontSizeMultiplier={1.4}>
                      {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                    </Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "88%" },
});
