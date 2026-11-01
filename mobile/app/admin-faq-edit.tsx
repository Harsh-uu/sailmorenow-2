import { useState } from "react";
import { DeviceEventEmitter, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ButtonRow } from "@/src/components/ui";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { api, ApiError } from "@/src/lib/api";
import { ADMIN_FAQS_CHANGED } from "@/src/lib/events";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

// Full-screen Admin FAQ edit (was an inline input in a long list).
export default function AdminFaqEditScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{ id: string; q: string; a: string }>();
  const [q, setQ] = useState(params.q || "");
  const [a, setA] = useState(params.a || "");
  const [busy, setBusy] = useState(false);
  const qKb = useKbField("q");
  const aKb = useKbField("a");

  const save = async () => {
    if (!q.trim() || !a.trim()) { toast.error("Question and answer are required."); return; }
    setBusy(true);
    try {
      await api.patch(`/admin/faqs/${params.id}`, { question: q.trim(), answer: a.trim() });
      toast.success("FAQ updated");
      DeviceEventEmitter.emit(ADMIN_FAQS_CHANGED);
      router.back();
    } catch (e: any) { toast.error(e instanceof ApiError ? e.message : "Failed"); } finally { setBusy(false); }
  };

  const input = { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, fontSize: 15 };

  return (
    <KeyboardFormScreen
      title="Edit FAQ"
      testID="admin-faq-edit-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={[
            { title: "Cancel", variant: "ghost", onPress: () => router.back() },
            { title: busy ? "Saving" : "Save", variant: "primary", loading: busy, onPress: save, weight: 1.4, testID: "admin-faq-edit-save" },
          ]}
        />
      }
    >
      <View onLayout={qKb.onLayout}>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>Question</Text>
        <TextInput testID="admin-faq-edit-q" value={q} onFocus={qKb.onFocus} onChangeText={setQ} placeholder="Question" placeholderTextColor={colors.muted} style={input} />
      </View>
      <View style={{ marginTop: 14 }} onLayout={aKb.onLayout}>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>Answer</Text>
        <TextInput testID="admin-faq-edit-a" value={a} onFocus={aKb.onFocus} onChangeText={setA} placeholder="Answer" placeholderTextColor={colors.muted} multiline style={[input, { minHeight: 140, textAlignVertical: "top" }]} />
      </View>
    </KeyboardFormScreen>
  );
}
