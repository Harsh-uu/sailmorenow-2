import { useRef, useState } from "react";
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Icon } from "@/src/components/Icon";
import { MotionModal } from "@/src/components/MotionModal";

/**
 * Shared full-size image viewer (mobile). Shows the saved image larger, with a
 * close button (44px), tap-outside to close, swipe between images, and a small
 * "n of m" counter. Renders nothing when there is no image.
 */
export function ImageLightbox({ images = [], index = 0, open, onClose }: {
  images?: { uri: string; alt?: string }[]; index?: number; open?: boolean; onClose?: () => void;
}) {
  const { width, height } = Dimensions.get("window");
  const listRef = useRef<FlatList>(null);
  const start = Math.min(index, Math.max(0, images.length - 1));
  const [cur, setCur] = useState(start);
  const resolve = (u: string) => (u && u.startsWith("/api/") ? `${process.env.EXPO_PUBLIC_BACKEND_URL}${u}` : u);
  if (!open || images.length === 0) return null;

  return (
    <MotionModal visible={open} transparent animationType="fade" onRequestClose={onClose} onShow={() => setCur(start)}>
      <View style={styles.backdrop} testID="image-lightbox">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close image viewer" />
        <FlatList
          ref={listRef}
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={start}
          onMomentumScrollEnd={(e) => setCur(Math.round(e.nativeEvent.contentOffset.x / width))}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => (
            <Pressable style={{ width, height, alignItems: "center", justifyContent: "center" }} onPress={onClose}>
              <ExpoImage source={{ uri: resolve(item.uri) }} style={{ width: width * 0.92, height: height * 0.8 }} contentFit="contain" accessibilityLabel={item.alt} testID="lightbox-image" />
            </Pressable>
          )}
        />
        {images.length > 1 ? (
          <View style={styles.counter} testID="lightbox-counter" pointerEvents="none">
            <Text style={styles.counterText}>{Math.min(cur, images.length - 1) + 1} of {images.length}</Text>
          </View>
        ) : null}
        <Pressable onPress={onClose} testID="lightbox-close" accessibilityLabel="Close" style={styles.close}>
          <Icon name="close" size={24} color="#fff" footprint={24} />
        </Pressable>
      </View>
    </MotionModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
  close: { position: "absolute", top: 48, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  counter: { position: "absolute", top: 54, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  counterText: { color: "rgba(255,255,255,0.95)", fontSize: 13, fontWeight: "700" },
});
