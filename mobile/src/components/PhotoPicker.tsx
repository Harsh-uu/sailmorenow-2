import { useState } from "react";
import { ActivityIndicator, Alert, Image, Keyboard, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/src/components/Icon";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "@/src/theme";
import { compressPhotoToDataUrl, PHOTO_TOO_LARGE_MESSAGE } from "@/src/lib/photo";

// Single optional photo attachment (returns a base64 data URL, or null).
export function PhotoPicker({ value, onChange, aspect, circle = false, label = "Add a photo" }: { value: string | null; onChange: (v: string | null) => void; aspect?: [number, number]; circle?: boolean; label?: string }) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    Keyboard.dismiss();
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    let status = perm.status;
    if (status !== "granted") {
      if (!perm.canAskAgain) {
        Alert.alert("Photos access needed", "Enable photo access in Settings to attach a photo.", [
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
      allowsEditing: true,
      aspect: aspect,
      quality: 1,
    });
    const asset = res.assets?.[0];
    if (res.canceled || !asset?.uri) return;
    // Downscale + compress on the phone so a normal iPhone photo fits under the
    // server size limit before upload (see src/lib/photo.ts).
    setBusy(true);
    try {
      const out = await compressPhotoToDataUrl(asset.uri, asset.width, asset.height);
      if (!out || !out.ok) {
        Alert.alert("Photo too large", PHOTO_TOO_LARGE_MESSAGE);
        return;
      }
      onChange(out.dataUrl);
    } catch {
      Alert.alert("Couldn't add photo", "Sorry, we couldn't process that photo. Please try another one.");
    } finally {
      setBusy(false);
    }
  };

  if (value) {
    return (
      <View style={styles.wrap}>
        <Image accessibilityLabel="Selected photo preview" source={{ uri: value }} style={[styles.preview, circle ? styles.circlePreview : null]} />
        <Pressable testID="photo-remove-btn" onPress={() => onChange(null)} style={[styles.remove, { backgroundColor: colors.error }]}>
          <Icon name="close" size={16} color="#fff"  footprint={16}/>
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable testID="photo-add-btn" onPress={pick} disabled={busy} style={[styles.add, { borderColor: colors.border, backgroundColor: colors.surface, opacity: busy ? 0.6 : 1 }]}>
      {busy ? <ActivityIndicator color={colors.teal} /> : <Icon name="image-outline" size={20} color={colors.teal}  footprint={20}/>}
      <Text style={{ color: colors.onSurfaceSecondary, fontWeight: "600" }}>{busy ? "Adding photo…" : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  preview: { width: "100%", height: 180, borderRadius: 14, backgroundColor: "#e2e8f0" },
  circlePreview: { width: 96, height: 96, borderRadius: 48 },
  remove: { position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  add: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderStyle: "dashed", borderRadius: 14, paddingVertical: 18 },
});
