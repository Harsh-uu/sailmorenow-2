import { Alert, Image, Keyboard, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "@/src/components/Icon";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "@/src/theme";

export type OrgPhoto = { url: string; caption: string };

// Org gallery editor. Stores [{ url, caption }]. First item is the cover/hero.
export function OrgGalleryEditor({ value, onChange, max = 1 }: { value: OrgPhoto[]; onChange: (v: OrgPhoto[]) => void; max?: number }) {
  const { colors } = useTheme();
  const photos = value || [];

  const pick = async () => {
    Keyboard.dismiss();
    const room = max - photos.length;
    if (room <= 0) { Alert.alert("Photo limit", `You can add up to ${max} photo${max === 1 ? "" : "s"}.`); return; }
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    let status = perm.status;
    if (status !== "granted") {
      if (!perm.canAskAgain) {
        Alert.alert("Photos access needed", "Enable photo access in Settings to add photos.", [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      status = (await ImagePicker.requestMediaLibraryPermissionsAsync()).status;
      if (status !== "granted") return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 0.5,
      base64: true,
    });
    if (res.canceled) return;
    const added = (res.assets || []).filter((a) => a.base64).slice(0, room).map((a) => ({ url: `data:image/jpeg;base64,${a.base64}`, caption: "" }));
    if (added.length) onChange([...photos, ...added]);
  };

  const setCaption = (i: number, caption: string) => onChange(photos.map((p, j) => (j === i ? { ...p, caption } : p)));
  const remove = (i: number) => onChange(photos.filter((_, j) => j !== i));
  const setCover = (i: number) => { if (i === 0) return; const next = [...photos]; const [m] = next.splice(i, 1); next.unshift(m); onChange(next); };

  return (
    <View style={{ gap: 12 }}>
      {photos.map((p, i) => (
        <View key={i} testID={`gallery-item-${i}`} style={{ flexDirection: "row", gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 10 }}>
          <View>
            <Image source={{ uri: p.url }} style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: "#e2e8f0" }} accessibilityLabel={p.caption || `Photo ${i + 1}`} />
            {i === 0 ? (
              <View style={{ position: "absolute", top: -6, left: -6, backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }} testID="gallery-cover-badge">
                <Text style={{ color: colors.navy, fontSize: 8, fontWeight: "800" }}>COVER</Text>
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <TextInput value={p.caption} onChangeText={(t) => setCaption(i, t)} maxLength={140} placeholder="Add a caption (optional)" placeholderTextColor={colors.muted}
              testID={`gallery-caption-${i}`}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, color: colors.onSurface, fontSize: 14 }} />
            <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
              {i !== 0 ? (
                <Pressable testID={`gallery-set-cover-${i}`} onPress={() => setCover(i)}>
                  <Text style={{ color: colors.teal, fontWeight: "700", fontSize: 12 }}>Set as cover</Text>
                </Pressable>
              ) : null}
              <Pressable testID={`gallery-remove-${i}`} onPress={() => remove(i)}>
                <Text style={{ color: colors.error, fontWeight: "700", fontSize: 12 }}>Remove</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ))}
      {photos.length < max ? (
        <Pressable testID="gallery-add" onPress={pick} style={[styles.add, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Icon name="image-outline" size={20} color={colors.teal} footprint={20} />
          <Text style={{ color: colors.onSurfaceSecondary, fontWeight: "600" }}>Add photo ({photos.length}/{max})</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  add: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderStyle: "dashed", borderRadius: 14, paddingVertical: 16 },
});
