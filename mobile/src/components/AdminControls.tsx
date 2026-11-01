import { useEffect, useState } from "react";
import { DeviceEventEmitter, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { api } from "@/src/lib/api";
import { ADMIN_CONTENT_CHANGED } from "@/src/lib/events";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

type Field = { k: string; label: string; multiline?: boolean; numeric?: boolean };
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

// Inline admin Edit + Delete for a content item (mobile). Edit opens the
// full-screen admin edit form (keyboard-safe); Delete uses a confirm step (no
// inputs). Renders nothing for non-admins.
export function AdminControls({ entity, item, onChanged }: { entity: string; item: any; onChanged?: (next: any | null) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { colors } = useTheme();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const fields = FIELD_DEFS[entity] || [];
  const id = item?.id;

  // The edit form is a separate screen; it reports the saved item back here.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(ADMIN_CONTENT_CHANGED, (p: any) => {
      if (p?.entity === entity && p?.id === id) onChanged?.({ ...item, ...p.next });
    });
    return () => sub.remove();
  }, [entity, id, item, onChanged]);

  if (!user || user.platform_role !== "admin") return null;

  const openEdit = () => {
    const values: Record<string, string> = {};
    fields.forEach((f) => { values[f.k] = item[f.k] != null ? String(item[f.k]) : ""; });
    router.push({ pathname: "/admin-edit", params: { entity, id, values: JSON.stringify(values) } } as any);
  };
  const doDelete = async () => {
    setBusy(true);
    try {
      await api.del(`/admin/content/${entity}/${id}`);
      toast.success(`${entity} deleted`);
      setConfirmOpen(false);
      onChanged?.(null);
    } catch (e: any) { toast.error(e?.message || "Couldn't delete"); } finally { setBusy(false); }
  };

  return (
    <View style={styles.row} testID={`admin-controls-${entity}-${id}`}>
      {fields.length > 0 && (
        <Pressable testID={`admin-edit-${entity}-${id}`} onPress={openEdit} style={[styles.pill, { borderColor: "#6366f1" }]}>
          <Icon name="create-outline" size={13} color="#4f46e5" footprint={13} />
          <Text style={[styles.pillTxt, { color: "#4f46e5" }]}>Edit</Text>
        </Pressable>
      )}
      <Pressable testID={`admin-delete-${entity}-${id}`} onPress={() => setConfirmOpen(true)} style={[styles.pill, { borderColor: "#fca5a5" }]}>
        <Icon name="trash-outline" size={13} color="#dc2626" footprint={13} />
        <Text style={[styles.pillTxt, { color: "#dc2626" }]}>Delete</Text>
      </Pressable>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sheetTitle, { color: colors.onSurface }]}>Delete {entity}?</Text>
            <Text style={{ color: colors.muted, marginTop: 8, fontSize: 13.5 }}>This permanently deletes it{(entity === "post" || entity === "discussion") ? " and its comments" : ""}. This cannot be undone.</Text>
            <View style={styles.sheetBtns}>
              <Pressable onPress={() => setConfirmOpen(false)} style={styles.sheetBtn}><Text style={{ color: colors.muted, fontWeight: "700" }}>Cancel</Text></Pressable>
              <Pressable testID="admin-delete-confirm-btn" onPress={doDelete} disabled={busy} style={[styles.sheetBtn, { backgroundColor: "#dc2626", opacity: busy ? 0.5 : 1 }]}><Text style={{ color: "#fff", fontWeight: "800" }}>{busy ? "Deleting" : "Delete"}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  pillTxt: { fontSize: 12, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 },
  sheet: { borderRadius: 18, padding: 18 },
  sheetTitle: { fontSize: 18, fontWeight: "800" },
  sheetBtns: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 18 },
  sheetBtn: { borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
});
