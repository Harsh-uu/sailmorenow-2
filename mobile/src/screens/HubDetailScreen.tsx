import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Alert, Animated, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { useStackBase } from "@/src/lib/stackBase";
import { BottomBarKeyboardView } from "@/src/components/BottomBarKeyboardView";
import { useBottomBarPadding } from "@/src/lib/useBottomBarPadding";
import { Avatar, Badge, ErrorState, Loading } from "@/src/components/ui";
import { Reactions } from "@/src/components/Reactions";
import { api, ApiError } from "@/src/lib/api";
import { handleUpgrade, promptCommentUpgrade } from "@/src/lib/upgrade";
import { canInteract } from "@/src/lib/plan";
import { useToast } from "@/src/context/ToastContext";
import { shareLink } from "@/src/lib/share";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";
import { useProfilePreview } from "@/src/context/ProfilePreviewContext";
import { fmtTimeAgo } from "@/src/lib/format";
import { LinkifiedText } from "@/src/lib/linkify";
import { useSaved } from "@/src/lib/useSaved";
import { AdminControls } from "@/src/components/AdminControls";
import { CommentDeleteButton } from "@/src/components/CommentDeleteButton";

type Discussion = {
  id: string;
  author_id?: string;
  kind: "forum" | "blog";
  title: string;
  body: string;
  author_name?: string;
  author_avatar?: string | null;
  author_handle?: string;
  market?: string;
  tags?: string[];
  image_url?: string | null;
  published_at?: string;
  created_at?: string;
  edited_at?: string | null;
  can_edit?: boolean;
  can_delete?: boolean;
};
type Comment = { id: string; author_id?: string; author_handle?: string; author_name?: string; author_avatar?: string | null; body: string; created_at: string; parent_id?: string | null };

export default function HubDetail() {
  const { id, compose } = useLocalSearchParams<{ id: string; compose?: string }>();
  const { colors } = useTheme();
  const base = useStackBase();
  const barPad = useBottomBarPadding();
  const { show: showPreviewRaw } = useProfilePreview();
  const showPreview = (h: string) => showPreviewRaw(h, base);
  const { user } = useAuth();
  const toast = useToast();
  const { isSaved, toggle: toggleSaved } = useSaved();
  const [d, setD] = useState<Discussion | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const isFree = !canInteract(user);

  const onFocusComment = () => {
    if (!isFree) return;
    setText("");
    inputRef.current?.blur();
    promptCommentUpgrade(toast);
  };

  // Opened from a feed card's "Add a comment": focus the composer once so the
  // comment bar is ready to type. Non-free only (free users are prompted to
  // upgrade before they ever navigate here).
  useEffect(() => {
    if (compose === "1" && !isFree) {
      const t = setTimeout(() => inputRef.current?.focus(), 450);
      return () => clearTimeout(t);
    }
  }, [compose, isFree]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [disc, cs] = await Promise.all([
        api.get<Discussion>(`/discussions/${id}`),
        api.get<Comment[]>(`/posts/${id}/comments`).catch(() => []),
      ]);
      setD(disc);
      setComments(cs);
    } catch (e: any) {
      setError(e?.message || "Not found");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const c = await api.post<Comment>(`/posts/${id}/comments`, { body });
      setComments((prev) => [...prev, c]);
      setText("");
    } catch (e) {
      if (!handleUpgrade(e, toast)) Alert.alert("Couldn't comment", e instanceof ApiError ? e.message : "Try again");
    } finally {
      setSending(false);
    }
  };

  const removeComment = (cid: string) => setComments((prev) => prev.filter((x) => x.id !== cid && x.parent_id !== cid));

  const deleteDiscussion = () => {
    if (!d) return;
    const label = d.kind === "blog" ? "blog post" : "topic";
    Alert.alert(`Delete this ${label}?`, "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.del(`/discussions/${d.id}`);
            toast.success("Deleted");
            router.back();
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : "Couldn't delete");
          }
        },
      },
    ]);
  };

  return (
    <Screen
      title={d?.kind === "blog" ? "Blog" : "Forum"}
      showBack
      padded={false}
      right={
        d ? (
          <Pressable
            testID="hub-share-btn"
            onPress={() =>
              shareLink(
                `${d.kind === "blog" ? "Read" : "Join the discussion"}: "${d.title}" on Sail More Now`,
                `/community-hub/${d.id}`,
                user?.handle || user?.name,
              )
            }
            hitSlop={10}
          >
            <Icon name="share-outline" size={22} color={colors.onBrandPrimary}  footprint={22}/>
          </Pressable>
        ) : null
      }
    >
      <BottomBarKeyboardView>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !d ? (
          <ErrorState message="Not found" />
        ) : (
          <FlatList
            data={comments.filter((c) => !c.parent_id)}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
            ListHeaderComponent={
              <View style={[styles.postCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Badge label={d.kind === "blog" ? "Blog" : "Forum"} tone={d.kind === "blog" ? "accent" : "teal"} />
                  <Pressable testID={`save-${d.id}`} onPress={() => toggleSaved("discussion", d.id)} hitSlop={8}>
                    <Icon name={isSaved(d.id) ? "bookmark" : "bookmark-outline"} size={20} color={isSaved(d.id) ? colors.accent : colors.muted} footprint={20} />
                  </Pressable>
                </View>
                <Text style={[styles.title, { color: colors.onSurface }]}>{d.title}</Text>
                <View style={styles.authorRow}>
                  <Pressable onPress={() => d.author_handle && showPreview(d.author_handle)} disabled={!d.author_handle} testID={d.author_handle ? `author-link-${d.id}` : undefined} style={styles.authorRow}>
                    <Avatar uri={d.author_avatar} name={d.author_name} size={30} />
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {d.author_name || "Member"} · {fmtTimeAgo(d.created_at || d.published_at)}
                      {d.market ? ` · ${d.market}` : ""}{d.edited_at ? " · edited" : ""}
                    </Text>
                  </Pressable>
                </View>
                <LinkifiedText text={d.body} style={[styles.body, { color: colors.onSurfaceSecondary }]} />
                {d.image_url ? <Image accessibilityLabel="Post photo" source={{ uri: d.image_url }} style={styles.postImage} /> : null}
                {d.tags && d.tags.length ? (
                  <View style={styles.tags}>
                    {d.tags.map((t) => (
                      <Badge key={t} label={t} tone="muted" />
                    ))}
                  </View>
                ) : null}
                <View style={{ marginTop: 14 }}>
                  <Reactions targetType="discussion" targetId={d.id} />
                </View>
                <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <AdminControls entity="discussion" item={d} onChanged={(next) => { if (!next) { router.back(); } else { setD((cur: any) => cur ? { ...cur, ...next } : cur); } }} />
                  {d.can_edit ? (
                    <Pressable testID="discussion-edit-btn" onPress={() => router.push({ pathname: "/hub/new", params: { editId: d.id } } as any)}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 18, minHeight: 44 }}>
                      <Icon name="create-outline" size={15} color={colors.onSurface} footprint={15} />
                      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.onSurface }}>Edit</Text>
                    </Pressable>
                  ) : null}
                  {d.can_delete ? (
                    <Pressable testID="discussion-delete-btn" onPress={deleteDiscussion}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.error, borderRadius: 999, paddingHorizontal: 18, minHeight: 44 }}>
                      <Icon name="trash-outline" size={15} color={colors.error} footprint={15} />
                      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.error }}>Delete</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={[styles.commentsHeading, { color: colors.onSurface }]}>
                  {comments.length} {comments.length === 1 ? "Comment" : "Comments"}
                </Text>
              </View>
            }
            ListEmptyComponent={
              <Text style={{ color: colors.muted, textAlign: "center", marginTop: 12 }}>No comments yet - start the conversation.</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.commentRow}>
                <Pressable onPress={() => item.author_handle && showPreview(item.author_handle)} disabled={!item.author_handle}>
                  <Avatar uri={item.author_avatar} name={item.author_name} size={30} />
                </Pressable>
                <View style={[styles.bubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.cAuthor, { color: colors.onSurface }]} onPress={() => item.author_handle && showPreview(item.author_handle)}>
                    {item.author_name || "Member"} <Text style={{ color: colors.muted, fontWeight: "400" }}>· {fmtTimeAgo(item.created_at)}</Text>
                  </Text>
                  <LinkifiedText text={item.body} style={[styles.cBody, { color: colors.onSurfaceSecondary }]} />
                  <View style={{ marginTop: 8 }}>
                    <AdminControls entity="comment" item={item} onChanged={() => load()} />
                    <CommentDeleteButton comment={item} onDeleted={removeComment} />
                  </View>
                </View>
              </View>
            )}
          />
        )}
        {d ? (
          <Animated.View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: barPad }]}>
            <TextInput
              testID="hub-comment-input"
              ref={inputRef}
              value={text}
              onFocus={onFocusComment}
              onChangeText={(t) => { if (!isFree) setText(t); }}
              placeholder="Add a comment…"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surfaceTertiary, color: colors.onSurface }]}
              multiline
            />
            <Pressable
              testID="hub-comment-send-btn"
              onPress={send}
              disabled={sending || !text.trim()}
              style={[styles.sendBtn, { backgroundColor: text.trim() ? colors.accent : colors.borderStrong }]}
            >
              <Text style={{ color: text.trim() ? colors.onAccent : colors.onSurfaceSecondary, fontWeight: "700" }}>Post</Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </BottomBarKeyboardView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  postCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4, marginTop: 10 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  meta: { fontSize: 12.5 },
  body: { fontSize: 15, lineHeight: 22, marginTop: 14 },
  postImage: { width: "100%", height: 200, borderRadius: 12, marginTop: 12, backgroundColor: "#e2e8f0" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 14 },
  commentsHeading: { fontSize: 15, fontWeight: "800", marginTop: 18 },
  commentRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  bubble: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 12 },
  cAuthor: { fontWeight: "700", fontSize: 13.5 },
  cBody: { fontSize: 14.5, lineHeight: 20, marginTop: 3 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, borderTopWidth: 1 },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 100, fontSize: 15 },
  sendBtn: { paddingHorizontal: 18, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
});
