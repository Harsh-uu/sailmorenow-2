import { useEffect, useState } from "react";
import { Alert, DeviceEventEmitter, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { MultiSelectPicker } from "@/src/components/MultiSelectPicker";
import { Button } from "@/src/components/ui";
import { PhotoPicker } from "@/src/components/PhotoPicker";
import { api, ApiError } from "@/src/lib/api";
import { CONTENT_CHANGED } from "@/src/lib/events";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { handleUpgrade } from "@/src/lib/upgrade";
import { useTheme } from "@/src/theme";

export default function HubNew() {
  const { kind: kindParam, editId } = useLocalSearchParams<{ kind?: string; editId?: string }>();
  const isEdit = !!editId;
  const { user } = useAuth();
  const toast = useToast();
  const { colors } = useTheme();
  const ALL_MARKET = "__all_pnw__";
  const [markets, setMarkets] = useState<string[]>([]);
  const [kind, setKind] = useState<"forum" | "blog">(kindParam === "blog" ? "blog" : "forum");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [market, setMarket] = useState<string | null>(user?.primary_market || null);
  const [tags, setTags] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const titleKb = useKbField("hub-title");
  const bodyKb = useKbField("hub-body");
  const tagsKb = useKbField("hub-tags");

  useEffect(() => {
    api.get<{ markets: string[] }>("/markets").then((d) => setMarkets(d.markets || [])).catch(() => {});
  }, []);

  // Edit mode: prefill from the existing discussion. kind and market are fixed;
  // title, body, tags and cover image are editable.
  useEffect(() => {
    if (!editId) return;
    api.get<any>(`/discussions/${editId}`).then((d) => {
      setKind(d.kind === "blog" ? "blog" : "forum");
      setTitle(d.title || "");
      setBody(d.body || "");
      setTags((d.tags || []).join(", "));
      setMarket(d.market || null);
      setPhoto(d.image_url || null);
    }).catch(() => { toast.error("Couldn't load post"); router.back(); });
  }, [editId]);

  const submit = async () => {
    if (!title.trim()) return Alert.alert("Add a title");
    if (!body.trim()) return Alert.alert("Add some content");
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8);
    if (isEdit) {
      setSubmitting(true);
      try {
        await api.patch(`/discussions/${editId}`, {
          title: title.trim(), body: body.trim(), tags: tagList, image_url: photo || null,
        });
        toast.success("Saved");
        DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "discussion", action: "edit", id: editId });
        if (router.canGoBack()) router.back();
        else router.replace("/hub");
      } catch (e) {
        Alert.alert("Couldn't save", e instanceof ApiError ? e.message : "Try again");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.post<any>("/discussions", {
        kind,
        title: title.trim(),
        body: body.trim(),
        market: market || undefined,
        tags: tagList,
        image_url: photo || undefined,
      });
      // Forum topics go live immediately; blog posts are held for review, so a
      // blog create will not appear in the Feed yet (the refetch simply confirms
      // the current list). Emit regardless; the list ignores what it does not show.
      DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "discussion", action: "create", item: created });
      Alert.alert(
        kind === "forum" ? "Posted" : "Submitted for review",
        kind === "forum" ? "Your topic is live in the Community Hub." : "Blog posts are published after an admin review.",
      );
      if (router.canGoBack()) router.back();
      else router.replace("/hub");
    } catch (e) {
      if (!handleUpgrade(e, toast)) Alert.alert("Couldn't post", e instanceof ApiError ? e.message : "Try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardFormScreen
      title={isEdit ? "Edit post" : "New post"}
      testID="hub-new-scroll"
      footer={<Button title={isEdit ? "Save changes" : "Publish"} onPress={submit} loading={submitting} testID="hub-publish-btn" style={{ flex: 1 }} />}
    >
        {isEdit ? null : (
        <>
        <Label>Type</Label>
        <View style={styles.wrap}>
          {(["forum", "blog"] as const).map((k) => (
            <Pressable
              key={k}
              testID={`hub-new-kind-${k}`}
              onPress={() => setKind(k)}
              style={[styles.pill, { borderColor: kind === k ? colors.teal : colors.border, backgroundColor: kind === k ? colors.tealSoft : colors.surface }]}
            >
              <Text style={{ color: colors.onSurfaceSecondary, fontWeight: "600", fontSize: 13 }}>
                {k === "forum" ? "Forum topic" : "Blog post"}
              </Text>
            </Pressable>
          ))}
        </View>
        {kind === "blog" ? (
          <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 6 }}>Blog posts are reviewed by an admin before publishing.</Text>
        ) : null}
        </>
        )}

        <View onLayout={titleKb.onLayout}>
          <Label>Title</Label>
          <TextInput testID="hub-title-input" value={title} onFocus={titleKb.onFocus} onChangeText={setTitle} keyboardType="default" autoCapitalize="sentences" placeholder="Give it a clear title" placeholderTextColor={colors.muted} style={inp(colors)} />
        </View>

        <View onLayout={bodyKb.onLayout}>
          <Label>Content</Label>
          <TextInput testID="hub-body-input" value={body} onFocus={bodyKb.onFocus} onChangeText={setBody} keyboardType="default" autoCapitalize="sentences" placeholder="Share your thoughts…" placeholderTextColor={colors.muted} multiline style={area(colors)} />
        </View>

        {isEdit ? null : (
        <>
        <Label>Market (optional)</Label>
        <View style={{ flexDirection: "row", marginBottom: 4 }}>
          <MultiSelectPicker
            label="Market"
            title="Select market"
            testID="hub-market-picker"
            single
            searchable={false}
            placeholder="All markets"
            options={[{ value: ALL_MARKET, label: "All markets" }, ...markets.map((m) => ({ value: m, label: m }))]}
            value={market ? [market] : [ALL_MARKET]}
            onChange={(next) => { const v = next[0]; setMarket(!v || v === ALL_MARKET ? null : v); }}
            valueLabel={market || "All markets"}
            accessibilityLabel={`Market: ${market || "All markets"}`}
          />
        </View>
        </>
        )}

        <View onLayout={tagsKb.onLayout}>
          <Label>Tags (optional, comma-separated)</Label>
          <TextInput testID="hub-tags-input" value={tags} onFocus={tagsKb.onFocus} onChangeText={setTags} placeholder="racing, crew, gear" placeholderTextColor={colors.muted} autoCapitalize="none" style={inp(colors)} />
        </View>

        <Label>Photo (optional)</Label>
        <PhotoPicker value={photo} onChange={setPhoto} />
      </KeyboardFormScreen>
  );
}

function Label({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.label, { color: colors.onSurface }]}>{children}</Text>;
}
const inp = (colors: any) => [styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }];
const area = (colors: any) => [styles.textarea, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }];

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: "800", marginTop: 20, marginBottom: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 15 },
  textarea: { borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 140, textAlignVertical: "top", fontSize: 15 },
});
