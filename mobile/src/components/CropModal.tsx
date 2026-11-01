import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import * as ImageManipulator from "expo-image-manipulator";
import { useTheme } from "@/src/theme";

type Props = {
  visible: boolean;
  uri: string | null;
  aspect: number;
  round?: boolean;
  title?: string;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
  onError?: (msg: string) => void;
  format?: "jpeg" | "png";
};

// Gesture crop (drag to reposition, pinch to zoom) over a fixed-aspect frame.
// Crops the ORIGINAL via expo-image-manipulator so editing stays non-destructive.
export function CropModal({ visible, uri, aspect, round = false, title = "Crop photo", onCancel, onSave, onError, format = "jpeg" }: Props) {
  const { colors } = useTheme();
  const { width: winW } = useWindowDimensions();
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const frameW = Math.min(winW - 32, 440);
  const frameH = frameW / aspect;

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  useEffect(() => {
    if (!uri) return;
    setNat(null);
    scale.value = 1; savedScale.value = 1; tx.value = 0; ty.value = 0; savedTx.value = 0; savedTy.value = 0;
    Image.getSize(uri, (w, h) => {
      setNat({ w, h });
      // Logo (round): open with the WHOLE image fitted inside the circle.
      if (round) { const r = Math.min(w, h) / Math.max(w, h); scale.value = r; savedScale.value = r; }
    }, () => setNat({ w: 1000, h: 1000 }));
  }, [uri, round, scale, savedScale, tx, ty, savedTx, savedTy]);

  const baseScale = nat ? Math.max(frameW / nat.w, frameH / nat.h) : 1;
  // Minimum zoom: logos can shrink until the whole image fits the circle; other
  // crops stay at cover (fill the frame).
  const minScale = nat && round ? Math.min(nat.w, nat.h) / Math.max(nat.w, nat.h) : 1;

  const pan = Gesture.Pan()
    .onUpdate((e) => { tx.value = savedTx.value + e.translationX; ty.value = savedTy.value + e.translationY; })
    .onEnd(() => { savedTx.value = tx.value; savedTy.value = ty.value; });
  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.value = Math.max(minScale, Math.min(4, savedScale.value * e.scale)); })
    .onEnd(() => { savedScale.value = scale.value; });
  const gesture = Gesture.Simultaneous(pan, pinch);

  const imgStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const save = async () => {
    if (!nat || !uri) return;
    setSaving(true);
    try {
      const S = baseScale * scale.value;
      const IW = nat.w * S, IH = nat.h * S;
      let cropX = (IW / 2 - frameW / 2 - tx.value) / S;
      let cropY = (IH / 2 - frameH / 2 - ty.value) / S;
      // Clamp the crop rect to the image so a fully fitted (contained) logo never
      // asks the manipulator to read outside the image (which would fail).
      const cropW = Math.min(frameW / S, nat.w);
      const cropH = Math.min(frameH / S, nat.h);
      cropX = Math.max(0, Math.min(nat.w - cropW, cropX));
      cropY = Math.max(0, Math.min(nat.h - cropH, cropY));
      // Never upscale a small logo beyond its natural size on save.
      const outW = round ? Math.min(512, Math.round(cropW)) : 1600;
      const res = await ImageManipulator.manipulateAsync(
        uri,
        [{ crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } }, { resize: { width: outW } }],
        { compress: 0.8, format: format === "png" ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG },
      );
      if (!res?.uri) throw new Error("No image produced");
      onSave(res.uri);
    } catch (e) {
      // Never leave Save doing nothing: surface a clear message and keep the
      // screen usable (Save re-enables via finally; user can retry or Cancel).
      onError?.("Sorry, we couldn't crop that photo. Please try again, or upload a different one.");
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.hint}>Drag to reposition · pinch to zoom</Text>
          <View style={[styles.frame, { width: frameW, height: frameH, borderRadius: round ? frameW / 2 : 16, backgroundColor: round ? "#ffffff" : "#111" }]}>
            {nat ? (
              <GestureDetector gesture={gesture}>
                <Animated.View style={{ width: frameW, height: frameH, alignItems: "center", justifyContent: "center" }}>
                  <Animated.Image source={{ uri: uri as string }} style={[{ width: nat.w * baseScale, height: nat.h * baseScale }, imgStyle]} resizeMode="cover" />
                </Animated.View>
              </GestureDetector>
            ) : (
              <ActivityIndicator color="#fff" style={{ flex: 1 }} />
            )}
          </View>
          <View style={styles.actions}>
            <Pressable testID="crop-cancel" onPress={onCancel} style={[styles.btn, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable testID="crop-save" onPress={save} disabled={saving || !nat} style={[styles.btn, { backgroundColor: colors.accent }]}>
              <Text style={[styles.btnText, { color: colors.navy }]}>{saving ? "Saving…" : "Save"}</Text>
            </Pressable>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: 16, gap: 10 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  hint: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 4 },
  frame: { overflow: "hidden", backgroundColor: "#111", borderWidth: 2, borderColor: "rgba(255,255,255,0.5)" },
  actions: { flexDirection: "row", gap: 12, marginTop: 18 },
  btn: { minHeight: 48, borderRadius: 999, paddingHorizontal: 28, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
