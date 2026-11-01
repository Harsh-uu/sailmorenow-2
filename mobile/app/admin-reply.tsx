import { useState } from "react";
import { DeviceEventEmitter, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ButtonRow } from "@/src/components/ui";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { api, ApiError } from "@/src/lib/api";
import { ADMIN_SUPPORT_CHANGED } from "@/src/lib/events";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

// Full-screen Admin support reply (was an inline input in a long list).
export default function AdminReplyScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const kb = useKbField("reply");

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`/admin/contact/${id}/reply`, { body: body.trim() });
      toast.success("Reply sent");
      DeviceEventEmitter.emit(ADMIN_SUPPORT_CHANGED);
      router.back();
    } catch (e: any) { toast.error(e instanceof ApiError ? e.message : "Failed to send"); } finally { setBusy(false); }
  };

  return (
    <KeyboardFormScreen
      title={`Reply to ${name || "message"}`}
      testID="admin-reply-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={[
            { title: "Cancel", variant: "ghost", onPress: () => router.back() },
            { title: busy ? "Sending" : "Send reply", variant: "primary", loading: busy, onPress: send, disabled: !body.trim(), weight: 1.4, testID: "admin-reply-send" },
          ]}
        />
      }
    >
      <View onLayout={kb.onLayout}>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>This is emailed to them.</Text>
        <TextInput testID="admin-reply-input" value={body} onFocus={kb.onFocus} onChangeText={setBody} multiline
          placeholder="Write your reply." placeholderTextColor={colors.muted}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, minHeight: 140, textAlignVertical: "top", fontSize: 15 }} />
      </View>
    </KeyboardFormScreen>
  );
}
