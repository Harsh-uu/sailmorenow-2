import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { ButtonRow } from "@/src/components/ui";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { api } from "@/src/lib/api";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

const REASONS = [
  { key: "inappropriate", label: "Against the Code of Conduct" },
  { key: "inaccurate", label: "Some information is inaccurate" },
  { key: "other", label: "Other" },
];

// Full-screen report form (was a Modal sheet). Reached from ReportButton.
export default function ReportScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { targetType, targetId } = useLocalSearchParams<{ targetType: string; targetId: string }>();
  const [reason, setReason] = useState(REASONS[0].key);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const detailKb = useKbField("detail");

  const submit = async () => {
    const label = REASONS.find((r) => r.key === reason)?.label || reason;
    setBusy(true);
    try {
      const res = await api.post<{ duplicate?: boolean; hidden?: boolean }>("/reports", {
        target_type: targetType, target_id: targetId,
        reason: detail.trim() ? `${label}: ${detail.trim()}` : label, category: reason,
      });
      toast.success(res.duplicate ? "Already reported. Thank you."
        : res.hidden ? "Reported. Hidden pending review."
        : "Report sent to moderators.");
      router.back();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't send report");
    } finally { setBusy(false); }
  };

  return (
    <KeyboardFormScreen
      title="Report to moderators"
      testID="report-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={[
            { title: "Cancel", variant: "ghost", onPress: () => router.back() },
            { title: busy ? "Sending" : "Send report", variant: "danger", onPress: submit, loading: busy, weight: 1.4, testID: "flag-submit" },
          ]}
        />
      }
    >
      {REASONS.map((r) => (
        <Pressable key={r.key} testID={`flag-reason-${r.key}`} onPress={() => setReason(r.key)}
          style={[styles.reason, { borderColor: reason === r.key ? colors.teal : colors.border }]}>
          <Icon name={reason === r.key ? "radio-button-on" : "radio-button-off"} size={20} color={reason === r.key ? colors.teal : colors.muted} footprint={20} />
          <Text style={{ color: colors.onSurface, fontSize: 14, flex: 1 }}>{r.label}</Text>
        </Pressable>
      ))}
      {reason === "inappropriate" ? (
        <Text style={{ color: colors.accent, fontSize: 12, marginTop: 6 }}>This hides the content from public view until a moderator reviews it.</Text>
      ) : null}
      <View onLayout={detailKb.onLayout}>
        <TextInput testID="flag-detail" value={detail} onFocus={detailKb.onFocus} onChangeText={setDetail} multiline
          placeholder="Anything else? (optional)" placeholderTextColor={colors.muted}
          style={[styles.input, { borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surfaceSecondary }]} />
      </View>
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  reason: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 90, textAlignVertical: "top", fontSize: 14, marginTop: 6 },
});
