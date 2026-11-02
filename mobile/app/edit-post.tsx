import { useEffect, useState } from "react";
import { DeviceEventEmitter, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { ButtonRow, Loading, Picker } from "@/src/components/ui";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { MultiPhotoPicker } from "@/src/components/MultiPhotoPicker";
import { api, ApiError } from "@/src/lib/api";
import { MARKETPLACE_CHANGED, CONTENT_CHANGED } from "@/src/lib/events";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

const CONDITIONS = ["New", "Like New", "Good", "Fair", "For parts"];

// Full-screen edit form for a For-Sale listing (owner). Same picker and
// compression as New post. Mark sold/available and Lower price stay separate.
export default function EditPostScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState("");
  const [gallery, setGallery] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const titleKb = useKbField("edit-title");
  const bodyKb = useKbField("edit-body");
  const priceKb = useKbField("edit-price");

  useEffect(() => {
    let alive = true;
    api.get<any[]>("/posts/mine/for-sale")
      .then((list) => {
        if (!alive) return;
        const p = (list || []).find((x) => x.id === id);
        if (p) {
          setTitle(p.title || "");
          setBody(p.body || "");
          setPrice(typeof p.price === "number" ? String(p.price) : "");
          setCondition(p.condition || "");
          setGallery(p.image_urls || (p.image_url ? [p.image_url] : []));
        } else {
          toast.error("Listing not found");
          router.back();
        }
      })
      .catch(() => { if (alive) { toast.error("Couldn't load listing"); router.back(); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const save = async () => {
    if (!title.trim()) return toast.warning("Add a title");
    if (!body.trim()) return toast.warning("Add some detail");
    setSubmitting(true);
    try {
      const next = await api.patch<any>(`/posts/${id}`, {
        title: title.trim(),
        body: body.trim(),
        price: price !== "" ? Number(price) : null,
        condition: condition || null,
        image_urls: gallery,
      });
      toast.success("Listing updated");
      DeviceEventEmitter.emit(MARKETPLACE_CHANGED, { id, next });
      DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "post", action: "edit", item: next });
      router.back();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <KeyboardFormScreen
      title="Edit listing"
      testID="edit-post-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={[
            { title: "Cancel", variant: "ghost", testID: "edit-post-cancel", onPress: () => router.back() },
            { title: submitting ? "Saving" : "Save changes", loading: submitting, weight: 1.6, testID: "edit-post-save", onPress: save },
          ]}
        />
      }
    >
      <View onLayout={titleKb.onLayout}>
        <Label>Title</Label>
        <TextInput
          testID="edit-title-input"
          value={title}
          onFocus={titleKb.onFocus}
          onChangeText={setTitle}
          placeholder="What are you selling?"
          placeholderTextColor={colors.muted}
          style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }]}
        />
      </View>

      <View onLayout={bodyKb.onLayout}>
        <Label>Description</Label>
        <TextInput
          testID="edit-body-input"
          value={body}
          onFocus={bodyKb.onFocus}
          onChangeText={setBody}
          placeholder="Share the details..."
          placeholderTextColor={colors.muted}
          multiline
          style={[styles.textarea, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }]}
        />
      </View>

      <View onLayout={priceKb.onLayout}>
        <Label>Price (USD)</Label>
        <TextInput
          testID="edit-price-input"
          value={price}
          onFocus={priceKb.onFocus}
          onChangeText={setPrice}
          placeholder="e.g. 1200"
          placeholderTextColor={colors.muted}
          keyboardType="numeric"
          style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }]}
        />
      </View>

      <Label>Condition</Label>
      <Picker
        testID="edit-condition-picker"
        title="Choose a condition"
        placeholder="Select a condition"
        value={condition}
        options={CONDITIONS.map((c) => ({ value: c, label: c }))}
        onChange={(v) => setCondition(v)}
      />

      <Label>Photos (up to 6)</Label>
      <MultiPhotoPicker value={gallery} onChange={setGallery} max={6} />
    </KeyboardFormScreen>
  );
}

function Label({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.label, { color: colors.onSurface }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: "800", marginTop: 20, marginBottom: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, minHeight: 50, paddingVertical: 10, fontSize: 15 },
  textarea: { borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 120, textAlignVertical: "top", fontSize: 15 },
});
