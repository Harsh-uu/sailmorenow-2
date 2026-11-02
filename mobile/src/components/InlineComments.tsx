import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Avatar } from "@/src/components/ui";
import { Icon } from "@/src/components/Icon";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";
import { fmtTimeAgo } from "@/src/lib/format";
import { LinkifiedText } from "@/src/lib/linkify";
import { useToast } from "@/src/context/ToastContext";
import { handleUpgrade, promptCommentUpgrade } from "@/src/lib/upgrade";
import { canParticipate } from "@/src/lib/plan";
import { useProfilePreview } from "@/src/context/ProfilePreviewContext";
import { CommentDeleteButton } from "@/src/components/CommentDeleteButton";

type Comment = {
  id: string;
  author_id?: string;
  author_handle?: string;
  author_name?: string;
  author_avatar?: string | null;
  body: string;
  created_at: string;
  parent_id?: string | null;
};

export function InlineComments({ targetId, allowComments = true, onCount, onCompose }: { targetId: string; allowComments?: boolean; onCount?: (n: number) => void; onCompose?: () => void }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const { show: showPreview } = useProfilePreview();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const inputRef = useRef<TextInput>(null);
  const isFree = !canParticipate(user);

  // Free accounts: block the comment box on focus (prompt + Pricing), blur and
  // clear any draft so no unsent text is left when they come back.
  const onFocusComment = () => {
    if (!isFree) return;
    setDraft("");
    setReplyTo(null);
    inputRef.current?.blur();
    promptCommentUpgrade(toast);
  };

  const load = useCallback(async () => {
    try {
      const cs = await api.get<Comment[]>(`/posts/${targetId}/comments`);
      setComments(cs);
      onCount?.(cs.length);
    } catch {
      setComments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    if (!user) { toast.warning("Sign in to comment"); return; }
    setBusy(true);
    try {
      const c = await api.post<Comment>(`/posts/${targetId}/comments`, { body, parent_id: replyTo?.id || null });
      setComments((prev) => { const next = [...(prev || []), c]; onCount?.(next.length); return next; });
      setDraft("");
      setReplyTo(null);
    } catch (e: any) {
      if (!handleUpgrade(e, toast)) toast.error(e?.message || "Couldn't post comment");
    } finally {
      setBusy(false);
    }
  };

  const openAuthor = (c: Comment) => { if (c.author_handle) showPreview(c.author_handle); };

  const onDeleted = (cid: string) => {
    setComments((prev) => {
      const next = (prev || []).filter((x) => x.id !== cid && x.parent_id !== cid);
      onCount?.(next.length);
      return next;
    });
  };

  // Feed cards pass onCompose: instead of typing inline (the feed list has no
  // keyboard handling), we open the post's full detail screen with its comment
  // bar focused. Free accounts still get the existing upgrade prompt here.
  const handleCompose = () => {
    if (!user) { toast.warning("Sign in to comment"); return; }
    if (isFree) { promptCommentUpgrade(toast); return; }
    onCompose?.();
  };

  const top = (comments || []).filter((c) => !c.parent_id);
  const repliesOf = (pid: string) => (comments || []).filter((c) => c.parent_id === pid);
  const count = (comments || []).length;

  const renderC = (c: Comment, depth = 0) => (
    <View key={c.id} testID={`comment-${c.id}`} style={{ marginLeft: depth > 0 ? 20 : 0, marginTop: 10 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={() => openAuthor(c)} disabled={!c.author_handle}>
          <Avatar uri={c.author_avatar} name={c.author_name} size={28} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12.5 }}>
            <Text onPress={() => openAuthor(c)} style={{ fontWeight: "800", color: colors.onSurface }}>{c.author_name || "Anonymous"}</Text>
            <Text style={{ color: colors.muted }}>  ·  {fmtTimeAgo(c.created_at)}</Text>
          </Text>
          <LinkifiedText text={c.body} style={{ fontSize: 14, color: colors.onSurfaceSecondary, marginTop: 2 }} />
          {user ? (
            <View style={{ flexDirection: "row", gap: 16, marginTop: 3 }}>
              <Pressable testID={`reply-${c.id}`} onPress={() => (onCompose ? handleCompose() : setReplyTo(c))} hitSlop={6}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.teal }}>Reply</Text>
              </Pressable>
              <CommentDeleteButton comment={c} onDeleted={onDeleted} />
            </View>
          ) : null}
        </View>
      </View>
      {repliesOf(c.id).map((r) => renderC(r, depth + 1))}
    </View>
  );

  return (
    <View style={{ marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10 }}>
      <Text style={{ fontSize: 13, fontWeight: "800", color: colors.onSurface }}>{count} {count === 1 ? "Comment" : "Comments"}</Text>
      {comments == null ? (
        <ActivityIndicator style={{ marginTop: 10 }} color={colors.teal} />
      ) : top.length === 0 ? (
        <Text style={{ color: colors.muted, marginTop: 8, fontSize: 13 }}>{allowComments ? "No comments yet - start the conversation." : "Comments are turned off."}</Text>
      ) : (
        top.map((c) => renderC(c))
      )}
      {allowComments && user ? (
        onCompose ? (
          <Pressable testID={`comment-compose-${targetId}`} onPress={handleCompose}
            style={{ marginTop: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.surfaceSecondary }}>
            <Text style={{ color: colors.muted, fontSize: 14 }}>Add a comment…</Text>
          </Pressable>
        ) : (
        <View style={{ marginTop: 12 }}>
          {replyTo ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Replying to <Text style={{ fontWeight: "800", color: colors.onSurface }}>{replyTo.author_name || "member"}</Text></Text>
              <Pressable testID="reply-cancel" onPress={() => setReplyTo(null)} hitSlop={6}><Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted }}>· cancel</Text></Pressable>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <TextInput testID={`comment-input-${targetId}`} ref={inputRef} value={draft} onFocus={onFocusComment} onChangeText={(t) => { if (!isFree) setDraft(t); }} placeholder={replyTo ? `Reply to ${replyTo.author_name || "member"}…` : "Add a comment…"} placeholderTextColor={colors.muted} multiline
              style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, maxHeight: 100 }} />
            <Pressable testID={`comment-submit-${targetId}`} onPress={submit} disabled={busy || !draft.trim()}
              style={{ backgroundColor: colors.brandPrimary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, opacity: busy || !draft.trim() ? 0.5 : 1 }}>
              <Icon name="send" size={16} color={colors.onBrandPrimary} footprint={16} />
            </Pressable>
          </View>
        </View>
        )
      ) : null}
    </View>
  );
}
