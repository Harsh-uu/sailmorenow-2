import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, DeviceEventEmitter, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { useStackBase } from "@/src/lib/stackBase";
import { BottomBarKeyboardView } from "@/src/components/BottomBarKeyboardView";
import { useBottomBarPadding } from "@/src/lib/useBottomBarPadding";
import { Avatar, Badge, Loading, ErrorState } from "@/src/components/ui";
import { Reactions } from "@/src/components/Reactions";
import { api, ApiError } from "@/src/lib/api";
import { handleUpgrade, promptCommentUpgrade } from "@/src/lib/upgrade";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";
import { useProfilePreview } from "@/src/context/ProfilePreviewContext";
import { fmtTimeAgo } from "@/src/lib/format";
import { LinkifiedText } from "@/src/lib/linkify";
import { Icon } from "@/src/components/Icon";
import { useSaved } from "@/src/lib/useSaved";
import { useAuth } from "@/src/context/AuthContext";
import { canParticipate } from "@/src/lib/plan";
import { AdminControls } from "@/src/components/AdminControls";
import { CommentDeleteButton } from "@/src/components/CommentDeleteButton";
import { MARKETPLACE_CHANGED, CONTENT_CHANGED } from "@/src/lib/events";

type Post = {
  id: string;
  type: string;
  title: string;
  body: string;
  market: string;
  author_name?: string;
  author_avatar?: string | null;
  author_id?: string;
  author_handle?: string;
  sold?: boolean;
  image_url?: string | null;
  image_urls?: string[] | null;
  price?: number | null;
  prev_price?: number | null;
  price_dropped_at?: string | null;
  condition?: string | null;
  found_crew?: boolean;
  created_at: string;
  edited_at?: string | null;
  can_edit?: boolean;
  can_delete?: boolean;
};
type Comment = {
  id: string;
  parent_id?: string | null;
  author_id: string;
  author_handle?: string;
  author_name?: string;
  author_avatar?: string | null;
  body: string;
  created_at: string;
};

export default function PostDetail() {
  const { id, compose } = useLocalSearchParams<{ id: string; compose?: string }>();
  const { colors } = useTheme();
  const base = useStackBase();
  const barPad = useBottomBarPadding();
  const { show: showPreviewRaw } = useProfilePreview();
  const toast = useToast();
  const showPreview = (h: string) => showPreviewRaw(h, base);
  const { user } = useAuth();
  const { isSaved, toggle: toggleSaved } = useSaved();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const isFree = !canParticipate(user);

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
  const [priceEdit, setPriceEdit] = useState(false);
  const [newPrice, setNewPrice] = useState("");
  const [showTools, setShowTools] = useState(false);

  const lowerPrice = async () => {
    if (!post) return;
    const val = Number(newPrice);
    if (Number.isNaN(val) || val < 0) return;
    try {
      const r = await api.post<{ price: number; price_dropped: boolean }>(`/posts/${post.id}/price`, { price: val });
      const next = { ...post, price: val, prev_price: r.price_dropped ? post.price : post.prev_price, price_dropped_at: r.price_dropped ? new Date().toISOString() : post.price_dropped_at };
      setPost(next);
      DeviceEventEmitter.emit(MARKETPLACE_CHANGED, { id: post.id, next });
      DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "post", action: "edit", item: next });
      setPriceEdit(false); setNewPrice("");
    } catch { /* noop */ }
  };
  const makeOffer = () => {
    if (!post?.author_id) return;
    router.push({ pathname: "/messages/[id]", params: { id: post.author_id, name: post.author_name || "Seller", offer: typeof post.price === "number" ? String(post.price) : "" } });
  };

  const markSold = async () => {
    if (!post) return;
    try {
      const r = await api.post<{ sold: boolean }>(`/posts/${post.id}/sold`, {});
      const next = { ...post, sold: r.sold };
      setPost(next);
      DeviceEventEmitter.emit(MARKETPLACE_CHANGED, { id: post.id, next });
      DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "post", action: "edit", item: next });
    } catch { /* noop */ }
  };

  const [foundBusy, setFoundBusy] = useState(false);
  const toggleFound = async () => {
    if (!post || foundBusy) return;
    const next = !post.found_crew;
    setFoundBusy(true);
    setPost({ ...post, found_crew: next });
    try {
      await api.post(`/posts/${post.id}/${next ? "found-crew" : "still-looking"}`, {});
      toast.success(next ? "Marked as crew found" : "Back to looking for crew");
    } catch {
      setPost((cur) => (cur ? { ...cur, found_crew: !next } : cur));
      toast.error("Couldn't update");
    } finally {
      setFoundBusy(false);
    }
  };

  const load = useCallback(async () => {
    try {
      setError(null);
      const [list, cs] = await Promise.all([
        api.get<Post[]>("/posts?market=all"),
        api.get<Comment[]>(`/posts/${id}/comments`),
      ]);
      setPost(list.find((p) => p.id === id) || null);
      setComments(cs);
    } catch (e: any) {
      setError(e?.message || "Failed to load post");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Owner edit/delete happen on full-screen routes that pop back here; refresh
  // (or leave, if deleted) when they report a change for this post.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(MARKETPLACE_CHANGED, (p: any) => {
      if (!p || p.id !== id) return;
      if (p.next === null) router.back();
      else setPost((cur) => (cur ? { ...cur, ...p.next } : p.next));
    });
    return () => sub.remove();
  }, [id]);

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

  const topLevel = comments.filter((c) => !c.parent_id);
  const repliesOf = (pid: string) => comments.filter((c) => c.parent_id === pid);

  const removeComment = (cid: string) => setComments((prev) => prev.filter((x) => x.id !== cid && x.parent_id !== cid));

  const confirmDelete = () => {
    if (!post) return;
    Alert.alert("Delete this post?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.del(`/posts/${post.id}`); toast.success("Deleted"); router.back(); }
        catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't delete"); }
      } },
    ]);
  };

  return (
    <Screen title="Post" showBack padded={false}>
      <BottomBarKeyboardView>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <FlatList
            data={topLevel}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
            ListHeaderComponent={
              post ? (
                <View style={[styles.postCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.authorRow}>
                    <Pressable onPress={() => post.author_handle && showPreview(post.author_handle)} disabled={!post.author_handle} testID={post.author_handle ? `author-link-${post.id}` : undefined}>
                      <Avatar uri={post.author_avatar} name={post.author_name} size={40} />
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.author, { color: colors.onSurface }]} onPress={() => post.author_handle && showPreview(post.author_handle)}>{post.author_name || "Sailor"}</Text>
                      <Text style={[styles.meta, { color: colors.muted }]}>
                        {post.market} · {fmtTimeAgo(post.created_at)}{post.edited_at ? " · edited" : ""}
                      </Text>
                    </View>
                    <Pressable testID={`save-${post.id}`} onPress={() => toggleSaved("post", post.id)} hitSlop={8} style={{ marginRight: 8 }}>
                      <Icon name={isSaved(post.id) ? "bookmark" : "bookmark-outline"} size={20} color={isSaved(post.id) ? colors.accent : colors.muted} footprint={20} />
                    </Pressable>
                    <Badge label="Post" tone="teal" />
                  </View>
                  <Text style={[styles.pTitle, { color: colors.onSurface }]}>{post.title}</Text>
                  {post.type === "sailing_opportunity" ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                      {post.found_crew ? (
                        <View testID="crew-found-tag" style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.tealSoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 }}>
                          <Icon name="success" size={13} color={colors.teal} footprint={13} />
                          <Text style={{ color: colors.tealText || colors.teal, fontWeight: "800", fontSize: 11.5, letterSpacing: 0.3 }}>Crew found</Text>
                        </View>
                      ) : null}
                      {user?.user_id === post.author_id ? (
                        <Pressable testID="found-crew-toggle" disabled={foundBusy} onPress={toggleFound}
                          style={{ borderWidth: 1.5, borderColor: post.found_crew ? colors.borderStrong : colors.teal, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
                          <Text style={{ color: post.found_crew ? colors.onSurface : colors.tealText || colors.teal, fontWeight: "800", fontSize: 12.5 }}>{post.found_crew ? "Still looking" : "Found crew"}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {post.type === "for_sale" ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                      {post.sold ? (
                        <View testID="sold-badge" style={{ backgroundColor: "#334155", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
                          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.6 }}>SOLD</Text>
                        </View>
                      ) : null}
                      {!post.sold && post.price_dropped_at && (Date.now() - new Date(post.price_dropped_at).getTime()) < 7 * 86400000 ? (
                        <View testID="price-drop-badge" style={{ backgroundColor: colors.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
                          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.6 }}>PRICE DROP</Text>
                        </View>
                      ) : null}
                      {user?.user_id === post.author_id ? (
                        <Pressable testID="owner-edit-toggle" onPress={() => setShowTools((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.teal, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
                          <Icon name="create-outline" size={13} color={colors.tealText} footprint={13} />
                          <Text style={{ color: colors.tealText, fontWeight: "700", fontSize: 12 }}>Edit</Text>
                          <Icon name={showTools ? "chevron-up" : "chevron-down"} size={13} color={colors.tealText} footprint={13} />
                        </Pressable>
                      ) : null}
                      {user && user.user_id !== post.author_id && !post.sold ? (
                        <Pressable testID="make-offer-btn" onPress={makeOffer} style={{ backgroundColor: colors.teal, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                          <Text style={{ color: colors.onBrandTertiary || "#fff", fontWeight: "800", fontSize: 12 }}>Make an offer</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {post.type === "for_sale" && user?.user_id === post.author_id && showTools ? (
                    <View testID="owner-tools" style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <Pressable testID="mark-sold-btn" onPress={markSold} style={{ borderWidth: 1, borderColor: colors.teal, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ color: colors.tealText, fontWeight: "700", fontSize: 12 }}>{post.sold ? "Mark available" : "Mark sold"}</Text>
                      </Pressable>
                      {!post.sold ? (
                        <Pressable testID="lower-price-btn" onPress={() => { setPriceEdit((v) => !v); setNewPrice(String(post.price ?? "")); }} style={{ borderWidth: 1, borderColor: colors.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                          <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 12 }}>Lower price</Text>
                        </Pressable>
                      ) : null}
                      <Pressable testID="edit-post-btn" onPress={() => router.push({ pathname: "/edit-post", params: { id: post.id } } as any)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 12 }}>Edit details</Text>
                      </Pressable>
                      <Pressable testID="delete-post-btn" onPress={() => router.push({ pathname: "/delete-post", params: { id: post.id, title: post.title } } as any)} style={{ borderWidth: 1, borderColor: colors.error, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ color: colors.error, fontWeight: "700", fontSize: 12 }}>Delete</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {priceEdit ? (
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <TextInput testID="lower-price-input" value={newPrice} onChangeText={setNewPrice} keyboardType="numeric" placeholder="New price"
                                 placeholderTextColor={colors.muted} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: colors.onSurface }} />
                      <Pressable testID="lower-price-save" onPress={lowerPrice} style={{ backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 }}>
                        <Text style={{ color: colors.onAccent, fontWeight: "800" }}>Save</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {post.type === "for_sale" && (typeof post.price === "number" || post.condition) ? (
                    <Text style={{ color: colors.accent, fontWeight: "800", fontSize: 16, marginTop: 4 }} testID="post-price">
                      {typeof post.price === "number" ? `$${post.price.toLocaleString()}` : ""}{post.condition ? `  ·  ${post.condition}` : ""}
                      {typeof post.prev_price === "number" && post.price_dropped_at && post.prev_price > (post.price ?? 0) ? `   was $${post.prev_price.toLocaleString()}` : ""}
                    </Text>
                  ) : null}
                  <LinkifiedText text={post.body} style={[styles.pBody, { color: colors.onSurfaceSecondary }]} />
                  <View style={{ marginTop: 12 }}>
                    {!(post.type === "for_sale" && user?.user_id === post.author_id) ? (
                      <AdminControls entity="post" item={post} onChanged={(next) => { if (!next) { router.back(); } else { setPost(next); } }} />
                    ) : null}
                  </View>
                  {post.type !== "for_sale" && (post.can_edit || post.can_delete) ? (
                    <View testID="post-author-actions" style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      {post.can_edit ? (
                        <Pressable testID="post-edit-btn" onPress={() => router.push({ pathname: "/new-post", params: { editId: post.id } } as any)}
                          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 18, minHeight: 44 }}>
                          <Icon name="create-outline" size={15} color={colors.onSurface} footprint={15} />
                          <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 14 }}>Edit</Text>
                        </Pressable>
                      ) : null}
                      {post.can_delete ? (
                        <Pressable testID="post-delete-btn" onPress={confirmDelete}
                          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.error, borderRadius: 999, paddingHorizontal: 18, minHeight: 44 }}>
                          <Icon name="trash-outline" size={15} color={colors.error} footprint={15} />
                          <Text style={{ color: colors.error, fontWeight: "700", fontSize: 14 }}>Delete</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {post.image_urls && post.image_urls.length > 1 ? (
                    <FlatList
                      horizontal
                      data={post.image_urls}
                      keyExtractor={(u, i) => `${i}`}
                      showsHorizontalScrollIndicator={false}
                      style={{ marginTop: 12 }}
                      renderItem={({ item: u }) => <Image accessibilityLabel="Post photo" source={{ uri: u }} style={[styles.postImage, { width: 260, marginRight: 10, marginTop: 0 }]} />}
                    />
                  ) : post.image_url ? <Image accessibilityLabel="Post photo" source={{ uri: post.image_url }} style={styles.postImage} /> : null}
                  <View style={{ marginTop: 14 }}>
                    <Reactions targetType="post" targetId={post.id} />
                  </View>
                  <Text style={[styles.commentsHeading, { color: colors.onSurface }]}>
                    {comments.length} {comments.length === 1 ? "Comment" : "Comments"}
                  </Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <Text style={{ color: colors.muted, textAlign: "center", marginTop: 12 }}>No comments yet - start the conversation.</Text>
            }
            renderItem={({ item }) => (
              <View>
                <CommentRow c={item} onChanged={() => load()} onDeleted={removeComment} />
                {repliesOf(item.id).map((r) => (
                  <View key={r.id} style={{ marginLeft: 34 }}>
                    <CommentRow c={r} onChanged={() => load()} onDeleted={removeComment} />
                  </View>
                ))}
              </View>
            )}
          />
        )}

        <Animated.View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: barPad }]}>
          <TextInput
            testID="comment-input"
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
            testID="comment-send-btn"
            onPress={send}
            disabled={sending || !text.trim()}
            style={[styles.sendBtn, { backgroundColor: text.trim() ? colors.accent : colors.borderStrong }]}
          >
            <Text style={{ color: text.trim() ? colors.onAccent : colors.onSurfaceSecondary, fontWeight: "700" }}>Post</Text>
          </Pressable>
        </Animated.View>
      </BottomBarKeyboardView>
    </Screen>
  );
}

function CommentRow({ c, onChanged, onDeleted }: { c: Comment; onChanged?: (next: any | null) => void; onDeleted: (id: string) => void }) {
  const { colors } = useTheme();
  const { show: showPreview } = useProfilePreview();
  return (
    <View style={styles.commentRow}>
      <Pressable onPress={() => c.author_handle && showPreview(c.author_handle)} disabled={!c.author_handle}>
        <Avatar uri={c.author_avatar} name={c.author_name} size={30} />
      </Pressable>
      <View style={[styles.bubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.cAuthor, { color: colors.onSurface }]} onPress={() => c.author_handle && showPreview(c.author_handle)}>
          {c.author_name || "Sailor"} <Text style={{ color: colors.muted, fontWeight: "400" }}>· {fmtTimeAgo(c.created_at)}</Text>
        </Text>
        <LinkifiedText text={c.body} style={[styles.cBody, { color: colors.onSurfaceSecondary }]} />
        <View style={{ marginTop: 8 }}>
          <AdminControls entity="comment" item={c} onChanged={onChanged} />
          <CommentDeleteButton comment={c} onDeleted={onDeleted} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  postCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  author: { fontWeight: "700", fontSize: 15 },
  meta: { fontSize: 12.5 },
  pTitle: { fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
  pBody: { fontSize: 15, lineHeight: 22, marginTop: 8 },
  postImage: { width: "100%", height: 200, borderRadius: 12, marginTop: 12, backgroundColor: "#e2e8f0" },
  commentsHeading: { fontSize: 15, fontWeight: "800", marginTop: 16 },
  commentRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  bubble: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 12 },
  cAuthor: { fontWeight: "700", fontSize: 13.5 },
  cBody: { fontSize: 14.5, lineHeight: 20, marginTop: 3 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, borderTopWidth: 1 },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, minHeight: 42, maxHeight: 120, fontSize: 15 },
  sendBtn: { paddingHorizontal: 18, minHeight: 42, paddingVertical: 8, borderRadius: 21, alignItems: "center", justifyContent: "center" },
});
