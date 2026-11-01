import { useState } from "react";
import { DeviceEventEmitter, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ButtonRow } from "@/src/components/ui";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { api } from "@/src/lib/api";
import { CONTENT_CHANGED } from "@/src/lib/events";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

const PRESETS = ["Weather", "Low turnout", "Rescheduling", "Venue issue"];

// Full-screen "Cancel this event?" confirmation (was a trapping Modal).
// Back arrow and "Keep it" both return to My Events WITHOUT cancelling.
export default function CancelEventScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string; title?: string }>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const reasonKb = useKbField("cancel-reason");

  const doCancel = async () => {
    if (!id) return;
    const q = reason.trim() ? `?reason=${encodeURIComponent(reason.trim())}` : "";
    setBusy(true);
    try {
      await api.del(`/events/${id}${q}`);
      toast.success("Event cancelled");
      DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "event", action: "delete", id });
      router.back();
    } catch {
      toast.error("Couldn't cancel the event");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardFormScreen
      title="Cancel this event?"
      testID="cancel-event-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={[
            { title: "Keep it", variant: "teal", testID: "cancel-keep-btn", onPress: () => router.back() },
            { title: "Cancel event", loading: busy, testID: "cancel-confirm-btn", onPress: doCancel },
          ]}
        />
      }
    >
      <Text style={[styles.body, { color: colors.onSurfaceSecondary }]}>
        Attendees will no longer see it. This can't be undone.
      </Text>

      <View onLayout={reasonKb.onLayout}>
        <TextInput
          testID="cancel-reason-input"
          value={reason}
          onFocus={reasonKb.onFocus}
          onChangeText={setReason}
          placeholder="Reason (optional), shown to attendees"
          placeholderTextColor={colors.muted}
          style={[styles.reasonInput, { borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surface }]}
        />
      </View>

      <View style={styles.presetRow}>
        {PRESETS.map((r) => (
          <Pressable
            key={r}
            testID={`cancel-preset-${r}`}
            onPress={() => setReason(r)}
            style={[styles.preset, { borderColor: reason === r ? colors.teal : colors.border, backgroundColor: reason === r ? colors.teal : "transparent" }]}
          >
            <Text style={{ color: reason === r ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontSize: 12.5, fontWeight: "700" }}>{r}</Text>
          </Pressable>
        ))}
      </View>
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20 },
  reasonInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, marginTop: 14 },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  preset: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
});
