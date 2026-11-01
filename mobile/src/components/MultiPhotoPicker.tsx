import { useState } from "react";
import { ActivityIndicator, Alert, Image, Keyboard, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/src/components/Icon";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "@/src/theme";
import { compressPhotoToDataUrl } from "@/src/lib/photo";

// Up to `max` photos (returns base64 data URLs). Used by For Sale posts.
// Grid of fixed slots like the org / Boat Pro gallery editor: tap a filled slot
// to Replace or Remove it, tap an empty slot (plus) to add. No separate X.
export function MultiPhotoPicker({ value, onChange, max = 6 }: { value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [menuIndex, setMenuIndex] = useState<number | null>(null);

  const ensurePerm = async (): Promise<boolean> => {
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (perm.status === "granted") return true;
    if (!perm.canAskAgain) {
      Alert.alert("Photos access needed", "Enable photo access in Settings to attach photos.", [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => Linking.openSettings() },
      ]);
      return false;
    }
    return (await ImagePicker.requestMediaLibraryPermissionsAsync()).status === "granted";
  };

  const warnTooLarge = (n: number) => {
    if (!n) return;
    Alert.alert(
      "Some photos too large",
      n === 1
        ? "We couldn't add 1 photo because it was too large. Please pick a smaller one."
        : `We couldn't add ${n} photos because they were too large. Please pick smaller ones.`,
    );
  };

  // Add one or more photos to the empty slots at the end.
  const addPhotos = async () => {
    Keyboard.dismiss();
    const room = max - value.length;
    if (room <= 0) { Alert.alert("Photo limit", `You can add up to ${max} photos.`); return; }
    if (!(await ensurePerm())) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: room, quality: 1 });
    if (res.canceled) return;
    const assets = (res.assets || []).filter((a) => a.uri).slice(0, room);
    setBusy(true);
    const added: string[] = [];
    let tooLarge = 0;
    try {
      for (const a of assets) {
        const out = await compressPhotoToDataUrl(a.uri, a.width, a.height);
        if (out && out.ok) added.push(out.dataUrl); else tooLarge++;
      }
    } finally { setBusy(false); }
    if (added.length) onChange([...value, ...added]);
    warnTooLarge(tooLarge);
  };

  // Replace the photo at a specific slot with a single newly-picked one.
  const replacePhoto = async (i: number) => {
    setMenuIndex(null);
    Keyboard.dismiss();
    if (!(await ensurePerm())) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, quality: 1 });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    const a = res.assets[0];
    setBusy(true);
    let out;
    try { out = await compressPhotoToDataUrl(a.uri, a.width, a.height); } finally { setBusy(false); }
    if (out && out.ok) onChange(value.map((u, j) => (j === i ? out!.dataUrl : u)));
    else warnTooLarge(1);
  };

  const removePhoto = (i: number) => {
    setMenuIndex(null);
    onChange(value.filter((_, j) => j !== i));
  };

  const slots = Array.from({ length: max });

  return (
    <View>
      <View style={styles.grid}>
        {slots.map((_, i) => {
          const uri = value[i];
          const isFirstEmpty = i === value.length;
          if (uri) {
            return (
              <Pressable key={i} testID={`photo-slot-${i}`} onPress={() => setMenuIndex(i)} style={styles.slot}>
                <Image accessibilityLabel={`Photo ${i + 1}`} source={{ uri }} style={styles.thumb} />
                <View style={styles.camBadge} pointerEvents="none"><Icon name="camera" size={13} color="#fff" footprint={13} /></View>
              </Pressable>
            );
          }
          if (isFirstEmpty) {
            return (
              <Pressable key={i} testID="photo-add-btn" onPress={addPhotos} disabled={busy} style={[styles.slot, styles.empty, { borderColor: colors.border, backgroundColor: colors.surface, opacity: busy ? 0.6 : 1 }]}>
                {busy ? <ActivityIndicator color={colors.teal} /> : <Icon name="add" size={22} color={colors.teal} footprint={22} />}
                {!busy ? <Text style={{ color: colors.muted, fontSize: 11 }}>Add</Text> : null}
              </Pressable>
            );
          }
          return <View key={i} testID={`photo-slot-empty-${i}`} style={[styles.slot, styles.emptyMuted, { borderColor: colors.border }]} />;
        })}
      </View>
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>{value.length}/{max} photos</Text>

      <Modal visible={menuIndex !== null} transparent animationType="slide" onRequestClose={() => setMenuIndex(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenuIndex(null)} testID="photo-slot-menu">
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 15, padding: 14 }}>Photo</Text>
            <Pressable testID="photo-menu-replace" onPress={() => menuIndex !== null && replacePhoto(menuIndex)} style={styles.sheetRow}>
              <Icon name="image-outline" size={18} color={colors.teal} footprint={18} />
              <Text style={[styles.sheetText, { color: colors.onSurface }]}>Replace photo</Text>
            </Pressable>
            <Pressable testID="photo-menu-remove" onPress={() => menuIndex !== null && removePhoto(menuIndex)} style={styles.sheetRow}>
              <Icon name="trash-outline" size={18} color={colors.error} footprint={18} />
              <Text style={[styles.sheetText, { color: colors.error }]}>Remove photo</Text>
            </Pressable>
            <Pressable testID="photo-menu-cancel" onPress={() => setMenuIndex(null)} style={[styles.sheetRow, { justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
              <Text style={[styles.sheetText, { color: colors.muted }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slot: { width: 88, height: 88, borderRadius: 12, overflow: "hidden" },
  thumb: { width: "100%", height: "100%", backgroundColor: "#e2e8f0" },
  empty: { borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 2 },
  emptyMuted: { borderWidth: 1, borderStyle: "dashed", backgroundColor: "transparent" },
  camBadge: { position: "absolute", right: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, minHeight: 52 },
  sheetText: { fontSize: 15, fontWeight: "600" },
});
