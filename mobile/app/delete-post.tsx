import { useState } from "react";
import { DeviceEventEmitter, StyleSheet, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { ButtonRow } from "@/src/components/ui";
import { KeyboardFormScreen } from "@/src/components/KeyboardFormScreen";
import { api, ApiError } from "@/src/lib/api";
import { MARKETPLACE_CHANGED, CONTENT_CHANGED } from "@/src/lib/events";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

// Full-screen "Delete this post?" confirmation (not a popup). Back arrow and
// "Keep it" return WITHOUT deleting.
export default function DeletePostScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const [busy, setBusy] = useState(false);

  const doDelete = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await api.del(`/posts/${id}`);
      toast.success("Listing deleted");
      DeviceEventEmitter.emit(MARKETPLACE_CHANGED, { id, next: null });
      DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "post", action: "delete", id });
      router.back();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardFormScreen
      title="Delete this post?"
      testID="delete-post-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={[
            { title: "Keep it", variant: "teal", testID: "delete-keep-btn", onPress: () => router.back() },
            { title: busy ? "Deleting" : "Delete post", variant: "danger", loading: busy, testID: "delete-confirm-btn", onPress: doDelete },
          ]}
        />
      }
    >
      {title ? <Text style={[styles.name, { color: colors.onSurface }]} numberOfLines={2}>{title}</Text> : null}
      <Text style={[styles.body, { color: colors.onSurfaceSecondary }]}>
        This cannot be undone. The listing and its comments will be removed.
      </Text>
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 17, fontWeight: "800", marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 20 },
});
