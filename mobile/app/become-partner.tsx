import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { ButtonRow } from "@/src/components/ui";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { api } from "@/src/lib/api";
import { useTheme } from "@/src/theme";

// Full-screen "Become a Community Partner" inquiry (was a trapping Modal in
// app/index.tsx). Same fields, order, validation and server call. Submitting
// posts to /contact, which sends a real email to the SMN inbox.
export default function BecomePartnerScreen() {
  const { colors } = useTheme();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameKb = useKbField("partner-name");
  const emailKb = useKbField("partner-email");
  const orgKb = useKbField("partner-org");
  const noteKb = useKbField("partner-note");

  const submit = async () => {
    if (!name.trim() || !email.trim()) { setError("Name and email are required."); return; }
    setBusy(true); setError(null);
    try {
      const message = `Community Partner inquiry.\nOrganization: ${org.trim() || "(not provided)"}\n\n${note.trim() || "Interested in becoming a Community Partner."}`;
      await api.post("/contact", { name: name.trim(), email: email.trim(), subject: "Community Partner inquiry", message });
      setSent(true);
    } catch (e: any) {
      setError(e?.message || "Couldn't send. Please try again.");
    } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <KeyboardFormScreen
        title="Become a Community Partner"
        testID="partner-inquiry-sent"
        footer={<ButtonRow allowStack={false} buttons={[{ title: "Done", testID: "partner-inquiry-done", onPress: () => router.back() }]} />}
      >
        <View style={styles.successWrap}>
          <View style={[styles.check, { backgroundColor: colors.tealSoft }]}>
            <Icon name="checkmark" size={30} color={colors.tealText} footprint={30} />
          </View>
          <Text style={[styles.successTitle, { color: colors.onSurface }]}>Thanks, we'll be in touch</Text>
          <Text style={[styles.successBody, { color: colors.onSurfaceSecondary }]}>
            Our team will reach out about becoming a Community Partner.
          </Text>
        </View>
      </KeyboardFormScreen>
    );
  }

  return (
    <KeyboardFormScreen
      title="Become a Community Partner"
      testID="partner-inquiry-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={[
            { title: "Cancel", variant: "secondary", testID: "partner-inquiry-cancel", onPress: () => router.back() },
            { title: busy ? "Sending" : "Send inquiry", loading: busy, weight: 1.6, testID: "partner-inquiry-submit", onPress: submit },
          ]}
        />
      }
    >
      <Text style={[styles.intro, { color: colors.onSurfaceSecondary }]}>
        Tell us about your club or organization and we'll set up a chat.
      </Text>

      <View onLayout={nameKb.onLayout}>
        <Text style={[styles.label, { color: colors.onSurface }]}>Your name</Text>
        <TextInput
          testID="partner-name-input"
          value={name}
          onFocus={nameKb.onFocus}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={colors.muted}
          maxLength={120}
          style={[styles.input, { borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surface }]}
        />
      </View>

      <View onLayout={emailKb.onLayout}>
        <Text style={[styles.label, { color: colors.onSurface }]}>Email</Text>
        <TextInput
          testID="partner-email-input"
          value={email}
          onFocus={emailKb.onFocus}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          maxLength={200}
          style={[styles.input, { borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surface }]}
        />
      </View>

      <View onLayout={orgKb.onLayout}>
        <Text style={[styles.label, { color: colors.onSurface }]}>Organization / club name</Text>
        <TextInput
          testID="partner-org-input"
          value={org}
          onFocus={orgKb.onFocus}
          onChangeText={setOrg}
          placeholder="Organization / club name"
          placeholderTextColor={colors.muted}
          maxLength={160}
          style={[styles.input, { borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surface }]}
        />
      </View>

      <View onLayout={noteKb.onLayout}>
        <Text style={[styles.label, { color: colors.onSurface }]}>Anything you'd like us to know (optional)</Text>
        <TextInput
          testID="partner-note-input"
          value={note}
          onFocus={noteKb.onFocus}
          onChangeText={setNote}
          placeholder="Anything you'd like us to know (optional)"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={2000}
          style={[styles.input, { borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surface, height: 120, paddingTop: 12, textAlignVertical: "top" }]}
        />
      </View>

      {error ? <Text testID="partner-inquiry-error" style={{ color: colors.error, marginTop: 14 }}>{error}</Text> : null}
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
