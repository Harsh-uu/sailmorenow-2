import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { ButtonRow } from "@/src/components/ui";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";

// Full-screen testimonial composer (was TestimonialModal, a trapping Modal).
// Same fields, order, validation and server call. Posts to /testimonials
// (pending admin approval). No email / Zoho involved. Returns via Back/Done.
export default function TestimonialScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [quote, setQuote] = useState("");
  const [role, setRole] = useState((user?.account_type || "").replace(/_/g, " "));
  const [market, setMarket] = useState(user?.primary_market || "");
  const [showName, setShowName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const valid = quote.trim().length >= 10 && quote.trim().length <= 280;

  const quoteKb = useKbField("testimonial-quote");
  const roleKb = useKbField("testimonial-role");
  const marketKb = useKbField("testimonial-market");

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await api.post("/testimonials", { quote: quote.trim(), role: role.trim(), market: market.trim(), show_name: showName });
      setSent(true);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't submit. Please try again.");
    } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <KeyboardFormScreen
        title="Share a testimonial"
        testID="testimonial-modal-sent"
        footer={<ButtonRow allowStack={false} buttons={[{ title: "Done", testID: "testimonial-modal-done", onPress: () => router.back() }]} />}
      >
        <View style={styles.successWrap}>
          <View style={[styles.check, { backgroundColor: colors.tealSoft }]}>
            <Icon name="checkmark" size={30} color={colors.tealText} footprint={30} />
          </View>
          <Text style={[styles.successTitle, { color: colors.onSurface }]}>Thank you!</Text>
          <Text style={[styles.successBody, { color: colors.onSurfaceSecondary }]}>
            Your testimonial is pending review and will appear once approved.
          </Text>
        </View>
      </KeyboardFormScreen>
    );
  }

  return (
    <KeyboardFormScreen
      title="Share a testimonial"
      testID="testimonial-modal-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={[
            { title: "Not now", variant: "secondary", testID: "testimonial-modal-cancel", onPress: () => router.back() },
            { title: busy ? "Submitting" : "Submit", loading: busy, weight: 1.6, testID: "testimonial-modal-submit", onPress: submit },
          ]}
        />
      }
    >
      <Text style={{ color: colors.teal, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>LOVED WORKING WITH THEM?</Text>
      <Text style={[styles.intro, { color: colors.onSurfaceSecondary, marginTop: 6 }]}>
        Tell other sailors about your experience.
      </Text>

      <View onLayout={quoteKb.onLayout}>
        <Text style={[styles.label, { color: colors.onSurface }]}>Your testimonial</Text>
        <TextInput
          testID="testimonial-modal-quote"
          value={quote}
          onFocus={quoteKb.onFocus}
          onChangeText={(t) => setQuote(t.slice(0, 280))}
          placeholder="Share a short quote (up to 280 characters)..."
          placeholderTextColor={colors.muted}
          multiline
          maxLength={280}
          style={[styles.input, { borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surface, minHeight: 100, paddingTop: 12, textAlignVertical: "top" }]}
        />
        <Text style={{ color: colors.muted, fontSize: 11, textAlign: "right", marginTop: 4 }} testID="testimonial-modal-count">{quote.trim().length}/280</Text>
      </View>

      <View onLayout={roleKb.onLayout}>
        <Text style={[styles.label, { color: colors.onSurface }]}>Your role</Text>
        <TextInput
          testID="testimonial-modal-role"
          value={role}
          onFocus={roleKb.onFocus}
          onChangeText={setRole}
          placeholder="Your role"
          placeholderTextColor={colors.muted}
          maxLength={60}
          style={[styles.input, { borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surface }]}
        />
      </View>

      <View onLayout={marketKb.onLayout}>
        <Text style={[styles.label, { color: colors.onSurface }]}>Your market</Text>
        <TextInput
          testID="testimonial-modal-market"
          value={market}
          onFocus={marketKb.onFocus}
          onChangeText={setMarket}
          placeholder="Your market"
          placeholderTextColor={colors.muted}
          maxLength={80}
          style={[styles.input, { borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surface }]}
        />
      </View>

      <Pressable testID="testimonial-modal-showname" onPress={() => setShowName((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18 }}>
        <Icon name={showName ? "checkbox" : "square-outline"} size={22} color={showName ? colors.teal : colors.muted} footprint={22} />
        <Text style={{ color: colors.onSurface, fontSize: 13.5, flex: 1 }}>Okay to show my first name and last initial</Text>
      </Pressable>
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: "800", marginTop: 18, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  successWrap: { alignItems: "center", paddingTop: 48, paddingHorizontal: 16 },
  check: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  successTitle: { fontSize: 20, fontWeight: "800", marginBottom: 8 },
  successBody: { fontSize: 14, lineHeight: 20, textAlign: "center" },
});
