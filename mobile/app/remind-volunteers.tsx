import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { ButtonRow } from "@/src/components/ui";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { api } from "@/src/lib/api";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

// Full-screen "Remind volunteers" composer (was a trapping Modal). The message
// field scrolls above the keyboard; the footer is pinned above it. Same fields,
// wording and server call as before.
export default function RemindVolunteersScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const [subject, setSubject] = useState(title ? `Reminder: ${title}` : "Reminder");
  const [message, setMessage] = useState(
    title
      ? `Hi! A quick reminder that you signed up to volunteer for "${title}". We can't wait to see you there. Please reply if anything has changed. Thank you!`
      : "",
  );
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const subjectKb = useKbField("blast-subject");
  const messageKb = useKbField("blast-message");

  const send = async () => {
    if (!id) return;
    if (subject.trim().length < 2 || message.trim().length < 2) { toast.error("Add a subject and a message"); return; }
    setSending(true);
    try {
      const r = await api.post<any>(`/events/${id}/blast`, { subject: subject.trim(), message: message.trim(), send_email: true, audience: "volunteer" });
      setSent(r.recipients ?? 0);
    } catch {
      toast.error("Couldn't send reminder");
    } finally {
      setSending(false);
    }
  };

  if (sent !== null) {
    return (
      <KeyboardFormScreen
        title="Remind volunteers"
        testID="remind-success"
        footer={<ButtonRow allowStack={false} buttons={[{ title: "Done", testID: "remind-done-btn", onPress: () => router.back() }]} />}
      >
        <View style={styles.successWrap}>
          <View style={[styles.check, { backgroundColor: colors.tealSoft }]}>
            <Icon name="checkmark" size={30} color={colors.tealText} footprint={30} />
          </View>
          <Text style={[styles.successTitle, { color: colors.onSurface }]}>Reminder sent</Text>
          <Text style={[styles.successBody, { color: colors.onSurfaceSecondary }]}>
            {sent} {sent === 1 ? "volunteer" : "volunteers"} will get this reminder in their Messages inbox and by email.
          </Text>
        </View>
      </KeyboardFormScreen>
    );
  }

  return (
    <KeyboardFormScreen
      title="Remind volunteers"
      testID="remind-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={[
            { title: "Cancel", variant: "secondary", testID: "blast-cancel-btn", onPress: () => router.back() },
            { title: sending ? "Sending" : "Send reminder", loading: sending, weight: 1.6, testID: "blast-send-btn", onPress: send },
          ]}
        />
      }
    >
      <Text style={[styles.intro, { color: colors.onSurfaceSecondary }]}>
        Sends an in-app notification and email to everyone who signed up to volunteer.
      </Text>

      <View onLayout={subjectKb.onLayout}>
        <Text style={[styles.label, { color: colors.onSurface }]}>Subject</Text>
        <TextInput
          testID="blast-subject-input"
          value={subject}
          onFocus={subjectKb.onFocus}
          onChangeText={setSubject}
          placeholder="Subject"
          placeholderTextColor={colors.muted}
          maxLength={120}
          style={[styles.input, { borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surface }]}
        />
      </View>

      <View onLayout={messageKb.onLayout}>
        <Text style={[styles.label, { color: colors.onSurface }]}>Message</Text>
        <TextInput
          testID="blast-message-input"
          value={message}
          onFocus={messageKb.onFocus}
          onChangeText={setMessage}
          placeholder="Your message..."
          placeholderTextColor={colors.muted}
          multiline
          maxLength={2000}
          style={[styles.input, { borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surface, height: 160, paddingTop: 12, textAlignVertical: "top" }]}
        />
      </View>
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
