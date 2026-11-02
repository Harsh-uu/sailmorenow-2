import { useEffect, useState } from "react";
import { Alert, DeviceEventEmitter, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { Button, Picker } from "@/src/components/ui";
import { PhotoPicker } from "@/src/components/PhotoPicker";
import { MultiPhotoPicker } from "@/src/components/MultiPhotoPicker";
import { api, ApiError } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";
import { handleUpgrade } from "@/src/lib/upgrade";
import { MARKETPLACE_CHANGED, CONTENT_CHANGED } from "@/src/lib/events";

const TYPES = [
  { key: "sailing_opportunity", label: "Sailing opportunity" },
  { key: "volunteer_opportunity", label: "Volunteer opportunity" },
  { key: "general", label: "General" },
  { key: "for_sale", label: "For sale" },
];

export default function NewPost() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const { editId, type: typeParam } = useLocalSearchParams<{ editId?: string; type?: string }>();
  const isEdit = !!editId;
  const [markets, setMarkets] = useState<string[]>([]);
  const [type, setType] = useState("general");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [market, setMarket] = useState<string | null>(user?.primary_market || null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const titleKb = useKbField("post-title");
  const bodyKb = useKbField("post-body");
  const priceKb = useKbField("post-price");
  const CONDITIONS = ["New", "Like New", "Good", "Fair", "For parts"];

  useEffect(() => {
    api.get<{ markets: string[] }>("/markets").then((d) => setMarkets(d.markets || [])).catch(() => {});
  }, []);

  // Deep link from the Feed/Marketplace/Crew Bank "Add" actions preselects the type.
  useEffect(() => {
    if (!editId && typeParam && TYPES.some((t) => t.key === typeParam)) setType(typeParam);
  }, [editId, typeParam]);

  // Edit mode: prefill from the existing post. Only body and photo are editable;
  // type, title and market are fixed by the backend.
  useEffect(() => {
    if (!editId) return;
    let alive = true;
    api.get<any[]>("/posts?market=all").then((list) => {
      if (!alive) return;
      const p = (list || []).find((x) => x.id === editId);
      if (!p) { toast.error("Post not found"); router.back(); return; }
      setType(p.type || "general");
      setTitle(p.title || "");
      setBody(p.body || "");
      setMarket(p.market || null);
      setPhoto(p.image_url || null);
    }).catch(() => { toast.error("Couldn't load post"); router.back(); });
    return () => { alive = false; };
  }, [editId]);

  const submit = async () => {
    if (isEdit) {
      if (!body.trim()) return toast.warning("Add some detail");
      setSubmitting(true);
      try {
        await api.patch(`/posts/${editId}`, { body: body.trim(), image_url: photo || null });
        toast.success("Saved");
        DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "post", action: "edit", id: editId });
        router.back();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Couldn't save");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (!title.trim()) return toast.warning("Add a title");
    if (!body.trim()) return toast.warning("Add some detail");
    if (!market) return toast.warning("Pick a market");
    setSubmitting(true);
    try {
      const created = await api.post<any>("/posts", {
        type, title: title.trim(), body: body.trim(), market,
        image_url: type === "for_sale" ? (gallery[0] || undefined) : (photo || undefined),
        image_urls: type === "for_sale" ? gallery : undefined,
        price: type === "for_sale" && price !== "" ? Number(price) : null,
        condition: type === "for_sale" ? (condition || null) : null,
      });
      toast.success("Posted!");
      // Shared refresh signal (all post types) + keep the marketplace-specific
      // signal for the post-detail / profile listings that patch in place.
      DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "post", action: "create", item: created });
      if (type === "for_sale") DeviceEventEmitter.emit(MARKETPLACE_CHANGED, { id: null, next: null });
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        Alert.alert("Post limit reached", e.message, [
          { text: "Not now", style: "cancel" },
          { text: "Go Premium", onPress: () => router.replace("/pricing") },
        ]);
      } else if (!handleUpgrade(e, toast)) {
        toast.error(e instanceof ApiError ? e.message : "Try again");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardFormScreen
      title={isEdit ? "Edit post" : "New post"}
      testID="new-post-scroll"
      footer={<Button title={isEdit ? "Save changes" : "Publish post"} onPress={submit} loading={submitting} testID="publish-post-btn" style={{ flex: 1 }} />}
    >
        {isEdit ? null : (
        <>
        <Label>Type</Label>
        <View style={styles.wrap}>
          {TYPES.map((t) => (
            <Pressable
              key={t.key}
              testID={`post-type-${t.key}`}
              onPress={() => setType(t.key)}
              style={[styles.pill, { borderColor: type === t.key ? colors.teal : colors.border, backgroundColor: type === t.key ? colors.tealSoft : colors.surface }]}
            >
              <Text style={{ color: colors.onSurfaceSecondary, fontWeight: "600", fontSize: 13 }}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
        </>
        )}

        <View onLayout={titleKb.onLayout}>
          <Label>Title</Label>
          <TextInput
            testID="post-title-input"
            value={title}
            editable={!isEdit}
            onFocus={titleKb.onFocus}
            onChangeText={setTitle}
            placeholder="What's it about?"
            placeholderTextColor={colors.muted}
            style={[styles.input, { borderColor: colors.border, backgroundColor: isEdit ? colors.surfaceTertiary : colors.surface, color: isEdit ? colors.muted : colors.onSurface }]}
          />
          {isEdit ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>Title and market cannot be changed.</Text> : null}
        </View>

        <View onLayout={bodyKb.onLayout}>
          <Label>Details</Label>
          <TextInput
            testID="post-body-input"
            value={body}
            onFocus={bodyKb.onFocus}
            onChangeText={setBody}
            placeholder="Share the details…"
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.textarea, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }]}
          />
        </View>

        {isEdit ? null : (
        <>
        <Label>Market</Label>
        <Picker
          testID="post-market-picker"
          title="Choose a market"
          placeholder="Select a market"
          value={market || ""}
          options={markets.map((m) => ({ value: m, label: m }))}
          onChange={(v) => setMarket(v)}
        />
        </>
        )}

        {type === "for_sale" ? (
          <>
            <View onLayout={priceKb.onLayout}>
              <Label>Price (USD)</Label>
              <TextInput
                testID="post-price-input"
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
            <View style={styles.wrap}>
              {CONDITIONS.map((c) => (
                <Pressable
                  key={c}
                  testID={`post-condition-${c}`}
                  onPress={() => setCondition(c)}
                  style={[styles.pill, { borderColor: condition === c ? colors.teal : colors.border, backgroundColor: condition === c ? colors.tealSoft : colors.surface }]}
                >
                  <Text style={{ color: colors.onSurfaceSecondary, fontWeight: "600", fontSize: 13 }}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {type === "for_sale" ? (
          <>
            <Label>Photos (up to 6)</Label>
            <MultiPhotoPicker value={gallery} onChange={setGallery} max={6} />
          </>
        ) : (
          <>
            <Label>Photo (optional)</Label>
            <PhotoPicker value={photo} onChange={setPhoto} />
          </>
        )}
      </KeyboardFormScreen>
  );
}

function Label({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.label, { color: colors.onSurface }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: "800", marginTop: 20, marginBottom: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 15 },
  textarea: { borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 120, textAlignVertical: "top", fontSize: 15 },
});
