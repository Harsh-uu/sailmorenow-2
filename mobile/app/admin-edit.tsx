import { useState } from "react";
import { DeviceEventEmitter, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ButtonRow } from "@/src/components/ui";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { api } from "@/src/lib/api";
import { ADMIN_CONTENT_CHANGED } from "@/src/lib/events";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

type Field = { k: string; label: string; multiline?: boolean; numeric?: boolean };

function AdminField({ f, value, onChange }: { f: Field; value: string; onChange: (t: string) => void }) {
  const { colors } = useTheme();
  const kb = useKbField(f.k);
  return (
    <View style={{ marginTop: 10 }} onLayout={kb.onLayout}>
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", marginBottom: 4 }}>{f.label}</Text>
      <TextInput testID={`admin-edit-field-${f.k}`} value={value} onFocus={kb.onFocus} onChangeText={onChange}
        multiline={f.multiline} keyboardType={f.numeric ? "numeric" : "default"}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, minHeight: f.multiline ? 100 : 44, textAlignVertical: f.multiline ? "top" : "center" }} />
    </View>
  );
}
const FIELD_DEFS: Record<string, Field[]> = {
  post: [
    { k: "title", label: "Title" },
    { k: "body", label: "Body", multiline: true },
    { k: "price", label: "Price", numeric: true },
    { k: "condition", label: "Condition" },
  ],
  discussion: [
    { k: "title", label: "Title" },
    { k: "body", label: "Body", multiline: true },
  ],
  comment: [{ k: "body", label: "Comment", multiline: true }],
  review: [
    { k: "rating", label: "Rating (1-5)", numeric: true },
    { k: "comment", label: "Comment", multiline: true },
  ],
};

// Full-screen admin edit form (was a Modal sheet). Reached from AdminControls.
export default function AdminEditScreen() {
  const toast = useToast();
  const { entity, id, values } = useLocalSearchParams<{ entity: string; id: string; values: string }>();
  const fields = FIELD_DEFS[entity as string] || [];
  const [form, setForm] = useState<Record<string, string>>(() => {
    try { return JSON.parse(values || "{}"); } catch { return {}; }
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const payload: Record<string, any> = {};
      fields.forEach((f) => { const v = form[f.k]; if (v === "" || v == null) return; payload[f.k] = f.numeric ? Number(v) : v; });
      const next = await api.patch<any>(`/admin/content/${entity}/${id}`, payload);
      toast.success(`${entity} updated`);
      DeviceEventEmitter.emit(ADMIN_CONTENT_CHANGED, { entity, id, next: { ...next, ...payload } });
      router.back();
    } catch (e: any) { toast.error(e?.message || "Couldn't save"); } finally { setBusy(false); }
  };

  return (
    <KeyboardFormScreen
      title={`Edit ${entity}`}
      testID="admin-edit-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={[
            { title: "Cancel", variant: "ghost", onPress: () => router.back() },
            { title: busy ? "Saving" : "Save", variant: "secondary", onPress: save, loading: busy, weight: 1.4, testID: "admin-edit-save" },
          ]}
        />
      }
    >
      {fields.map((f) => (
        <AdminField key={f.k} f={f} value={form[f.k] ?? ""} onChange={(t) => setForm((s) => ({ ...s, [f.k]: t }))} />
      ))}
    </KeyboardFormScreen>
  );
}
