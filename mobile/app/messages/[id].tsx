import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Animated, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { BottomBarKeyboardView } from "@/src/components/BottomBarKeyboardView";
import { useBottomBarPadding } from "@/src/lib/useBottomBarPadding";

import { Screen } from "@/src/components/Screen";
import { MotionModal as Modal } from "@/src/components/MotionModal";
import { ButtonRow, Loading } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useAppSocket } from "@/src/context/WebSocketContext";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";
import { handleUpgrade } from "@/src/lib/upgrade";

type Msg = { id: string; thread_id: string; from_id: string; from_name?: string; to_id?: string | null; body: string; created_at: string; read_at?: string | null; deleted_for_all?: boolean; recipient_locked?: boolean; recipient_name?: string | null; locked_members?: string[] };
type Member = { user_id: string; name?: string; is_free?: boolean };

export default function ChatThread() {
  const { id, name, group, offer, thread, to, as } = useLocalSearchParams<{ id: string; name?: string; group?: string; offer?: string; thread?: string; to?: string; as?: string }>();
  const { user } = useAuth();
  const { subscribe } = useAppSocket();
  const { colors } = useTheme();
  const toast = useToast();
  const barPad = useBottomBarPadding();
  const listRef = useRef<FlatList>(null);
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [text, setText] = useState(offer ? `Hi! I'd like to offer $${Number(offer).toLocaleString()} for your listing. Is it still available?` : "");
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersOpen, setMembersOpen] = useState(false);
  const [menuMsg, setMenuMsg] = useState<Msg | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [confirmConv, setConfirmConv] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<Msg | null>(null);
  const [meta, setMeta] = useState<{ channel?: string; business_name?: string; viewer_is_boat_pro?: boolean }>({});

  const isGroup = group === "1";
  // The recipient for a 1:1 is the other user (`to` when provided, else `id`).
  const recipientId = isGroup ? "" : ((to as string) || (id as string) || "");
  // Thread id is decided once: use the explicit `thread` passed from the inbox or
  // a notification (keeps the "~b" business suffix); otherwise derive the channel
  // from `as` so a message from a business profile opens the business thread.
  const threadId = useMemo(() => {
    if (isGroup) return id || "";
    if (thread) return thread as string;
    if (!user?.user_id || !recipientId) return "";
    const base = [user.user_id, recipientId].sort().join("-");
    return as === "business" ? `${base}~b` : base;
  }, [isGroup, user?.user_id, id, thread, recipientId, as]);

  const load = useCallback(async () => {
    if (!threadId) return;
    // Load the label/header from the thread itself so a screen opened from a
    // notification shows the same pill as from the inbox list (no param reliance).
    if (!isGroup) {
      api.get<{ channel?: string; business_name?: string; viewer_is_boat_pro?: boolean }>(`/messages/thread-meta/${threadId}`)
        .then(setMeta).catch(() => {});
    }
    try {
      const data = await api.get<Msg[]>(`/messages/${threadId}`);
      setMessages(data);
      api.post(`/messages/${threadId}/read`).catch(() => {});
      if (isGroup) {
        api.get<{ members: Member[] }>(`/messages/${threadId}/info`)
          .then((d) => setMembers(d.members || [])).catch(() => {});
      }
    } catch {
      setMessages([]);
    }
  }, [threadId, isGroup]);

  useFocusEffect(
    useCallback(() => {
      load();
      const off = subscribe("message", (m) => {
        if (m?.message?.thread_id === threadId) {
          setMessages((prev) => (prev ? [...prev, m.message] : [m.message]));
          api.post(`/messages/${threadId}/read`).catch(() => {});
        }
      });
      const offDel = subscribe("message.deleted", (m) => {
        if (m?.thread_id === threadId) {
          setMessages((prev) => (prev ? prev.map((x) => (x.id === m.message_id ? { ...x, deleted_for_all: true, body: "" } : x)) : prev));
        }
      });
      const offEdit = subscribe("message.edited", (m) => {
        if (m?.thread_id === threadId) {
          setMessages((prev) => (prev ? prev.map((x) => (x.id === m.message_id ? { ...x, body: m.body, edited_at: m.edited_at } : x)) : prev));
        }
      });
      return () => { off?.(); offDel?.(); offEdit?.(); };
    }, [load, subscribe, threadId]),
  );

  const deleteMessage = async (m: Msg | null, scope: "me" | "everyone") => {
    setMenuMsg(null);
    setConfirmMsg(null);
    if (!m) return;
    try {
      await api.del(`/messages/item/${m.id}?scope=${scope}`);
      if (scope === "everyone") setMessages((prev) => (prev ? prev.map((x) => (x.id === m.id ? { ...x, deleted_for_all: true, body: "" } : x)) : prev));
      else setMessages((prev) => (prev ? prev.filter((x) => x.id !== m.id) : prev));
    } catch (e: any) {
      toast.error(e?.message || "Couldn't delete message");
    }
  };

  const blockMember = async (uid?: string, nm?: string) => {
    if (!uid) return;
    try { await api.post(`/follows/block/${uid}`, {}); toast.success(`Blocked ${nm || "member"}`); }
    catch (e: any) { toast.error(e?.message || "Couldn't block"); }
  };

  const startEdit = (m: Msg) => { setMenuMsg(null); setEditingId(m.id); setText(m.body || ""); };

  const hasInbound = !isGroup && !!recipientId && (messages || []).some((m) => m.from_id === recipientId);
  const deleteConversation = async () => {
    setConfirmConv(false);
    try {
      await api.del(`/messages/thread/${threadId}`);
      router.back();
    } catch (e: any) { toast.error(e?.message || "Couldn't delete conversation"); }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    if (editingId) {
      setSending(true);
      try {
        const res = await api.patch<{ body: string; edited_at: string }>(`/messages/item/${editingId}`, { body });
        setMessages((prev) => (prev ? prev.map((x) => (x.id === editingId ? { ...x, body: res.body, edited_at: res.edited_at } : x)) : prev));
        setEditingId(null);
        setText("");
      } catch (e: any) {
        toast.error(e?.message || "Couldn't edit message");
      } finally {
        setSending(false);
      }
      return;
    }
    setSending(true);
    setText("");
    try {
      const msg = await api.post<Msg>(isGroup ? `/messages/group/${id}` : `/messages/${recipientId}`,
        isGroup ? { body } : { body, thread_id: threadId });
      setMessages((prev) => (prev ? [...prev, msg] : [msg]));
      if (!isGroup && msg.recipient_locked) {
        toast.info(`${msg.recipient_name || "This member"} is on a free plan and can't receive messages yet. We've sent them a notification to upgrade.`);
      }
      if (isGroup && msg.locked_members && msg.locked_members.length) {
        toast.info(`On a free plan — won't receive this until they upgrade: ${msg.locked_members.join(", ")}.`);
      }
    } catch (e) {
      setText(body);
      if (!handleUpgrade(e, toast)) toast.error("Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen title={name || "Chat"} showBack padded={false}
      right={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {hasInbound ? (
            <Pressable testID="block-chat-user-btn" onPress={() => blockMember(recipientId, name as string)} hitSlop={8}>
              <Icon name="ban-outline" size={20} color={colors.onBrandPrimary} footprint={20} />
            </Pressable>
          ) : null}
          <Pressable testID="thread-header-menu" onPress={() => setHeaderMenu(true)} hitSlop={8}>
            <Icon name="ellipsis-horizontal" size={20} color={colors.onBrandPrimary} footprint={20} />
          </Pressable>
        </View>
      }>
      <BottomBarKeyboardView>
        {!isGroup && meta.viewer_is_boat_pro ? (
          <View style={{ flexDirection: "row", paddingHorizontal: 14, paddingTop: 8 }}>
            <View style={[styles.hdrLabel, { backgroundColor: meta.channel === "business" ? colors.brandPrimary + "1A" : colors.surfaceTertiary }]}>
              <Text style={[styles.hdrLabelText, { color: meta.channel === "business" ? colors.brandPrimary : colors.muted }]} numberOfLines={1}>
                {meta.channel === "business" ? (meta.business_name || "Business") : "Personal"}
              </Text>
            </View>
          </View>
        ) : null}
        {isGroup && members.length > 0 ? (
          <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
            <Pressable testID="group-members-toggle" onPress={() => setMembersOpen((o) => !o)}
                       style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10 }}>
              <Icon name="people" size={16} color={colors.teal} footprint={16} />
              <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 13.5, flex: 1 }}>{members.length} participants</Text>
              <Icon name={membersOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} footprint={16} />
            </Pressable>
            {membersOpen ? (
              <View testID="group-members-list" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingBottom: 12 }}>
                {members.map((m) => (
                  <Pressable key={m.user_id} testID={`group-member-${m.user_id}`}
                        onLongPress={() => m.user_id !== user?.user_id && blockMember(m.user_id, m.name)}
                        style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: m.is_free ? "#DC2626" : colors.tealSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                    <Text style={{ color: m.is_free ? "#fff" : colors.teal, fontWeight: "700", fontSize: 12.5 }}>{m.name || "Sailor"}</Text>
                    {m.is_free ? <Text style={{ color: "#fff", fontSize: 10.5, fontWeight: "700" }}>· free</Text> : null}
                    {m.user_id !== user?.user_id ? (
                      <Pressable testID={`block-member-${m.user_id}`} onPress={() => blockMember(m.user_id, m.name)} hitSlop={6}>
                        <Icon name="close" size={12} color={m.is_free ? "#fff" : colors.muted} footprint={12} />
                      </Pressable>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
        {messages == null ? (
          <Loading />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: 14, paddingBottom: 8 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={{ alignItems: "center", paddingTop: 60 }}>
                <Icon name="chatbubbles-outline" size={40} color={colors.borderStrong}  footprint={40}/>
                <Text style={{ color: colors.muted, marginTop: 8 }}>Say hello to start the conversation.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const mine = item.from_id === user?.user_id;
              if (item.deleted_for_all) {
                return (
                  <View style={[styles.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
                    <View style={[styles.bubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text testID={`message-deleted-${item.id}`} style={{ color: colors.muted, fontStyle: "italic", fontSize: 14 }}>This message was deleted</Text>
                    </View>
                  </View>
                );
              }
              return (
                <View style={[styles.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start", alignItems: "center", gap: 4 }]}>
                  {mine ? (
                    <Pressable testID={`message-menu-${item.id}`} onPress={() => setMenuMsg(item)} hitSlop={8} style={{ padding: 2 }}>
                      <Icon name="ellipsis-horizontal" size={16} color={colors.muted} footprint={18} />
                    </Pressable>
                  ) : null}
                  <Pressable
                    testID={`message-${item.id}`}
                    onLongPress={() => mine && setMenuMsg(item)}
                    delayLongPress={300}
                    style={[
                      styles.bubble,
                      {
                        backgroundColor: mine ? colors.brandPrimary : colors.surface,
                        borderColor: colors.border,
                        borderTopRightRadius: mine ? 4 : 16,
                        borderTopLeftRadius: mine ? 16 : 4,
                      },
                    ]}
                  >
                    {isGroup && !mine && item.from_name ? (
                      <Text style={{ color: colors.teal, fontSize: 12, fontWeight: "800", marginBottom: 2 }}>{item.from_name}</Text>
                    ) : null}
                    <Text style={{ color: mine ? colors.onBrandPrimary : colors.onSurface, fontSize: 15, lineHeight: 20 }}>
                      {item.body}
                      {item.edited_at ? <Text style={{ fontSize: 11, color: mine ? colors.onBrandPrimary : colors.muted, opacity: 0.6 }}>  (edited)</Text> : null}
                    </Text>
                  </Pressable>
                </View>
              );
            }}
          />
        )}
        <Animated.View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.border, flexDirection: "column", alignItems: "stretch", paddingBottom: barPad }]}>
          {editingId ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <Text style={{ color: colors.teal, fontSize: 12.5, fontWeight: "700" }}>Editing message</Text>
              <Pressable testID="edit-cancel" onPress={() => { setEditingId(null); setText(""); }} hitSlop={8}>
                <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: "700" }}>Cancel</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
            <TextInput
              testID="chat-input"
              value={text}
              onChangeText={setText}
              placeholder="Message…"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surfaceTertiary, color: colors.onSurface }]}
              multiline
            />
            <Pressable
              testID="chat-send-btn"
              onPress={send}
              disabled={!text.trim() || sending}
              style={[styles.sendBtn, { backgroundColor: text.trim() ? colors.accent : colors.borderStrong }]}
            >
              <Icon name={editingId ? "checkmark" : "send"} size={18} color={colors.onAccent} footprint={18} />
            </Pressable>
          </View>
        </Animated.View>
      </BottomBarKeyboardView>

      <Modal visible={!!menuMsg} transparent animationType="fade" onRequestClose={() => setMenuMsg(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuMsg(null)}>
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sheetTitle, { color: colors.onSurface }]}>Message</Text>
            <Pressable testID="edit-msg" onPress={() => menuMsg && startEdit(menuMsg)} style={styles.sheetRow}>
              <Icon name="create-outline" size={20} color={colors.onSurface} footprint={20} />
              <Text style={{ color: colors.onSurface, fontSize: 16, marginLeft: 12 }}>Edit</Text>
            </Pressable>
            <Pressable testID="delete-msg" onPress={() => { const m = menuMsg; setMenuMsg(null); setConfirmMsg(m); }} style={styles.sheetRow}>
              <Icon name="trash" size={20} color="#DC2626" footprint={20} />
              <Text style={{ color: "#DC2626", fontSize: 16, marginLeft: 12 }}>Delete</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!confirmMsg} transparent animationType="fade" onRequestClose={() => setConfirmMsg(null)}>
        <Pressable style={styles.backdrop} onPress={() => setConfirmMsg(null)}>
          <Pressable style={[styles.confirmCard, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <Text style={{ color: colors.onSurface, fontSize: 18, fontWeight: "800", marginBottom: 8 }}>Delete message?</Text>
            <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20, marginBottom: 18 }}>This removes the message for everyone in the conversation.</Text>
            <ButtonRow
              buttons={[
                { title: "Cancel", variant: "secondary", testID: "delete-message-cancel", onPress: () => setConfirmMsg(null) },
                { title: "Delete", testID: "delete-message-confirm", onPress: () => deleteMessage(confirmMsg, "everyone") },
              ]}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={headerMenu} transparent animationType="fade" onRequestClose={() => setHeaderMenu(false)}>
        <Pressable style={styles.backdrop} onPress={() => setHeaderMenu(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sheetTitle, { color: colors.onSurface }]}>Conversation</Text>
            <Pressable testID="delete-conversation-row" onPress={() => { setHeaderMenu(false); setConfirmConv(true); }} style={styles.sheetRow}>
              <Icon name="trash-outline" size={20} color="#DC2626" footprint={20} />
              <Text style={{ color: "#DC2626", fontSize: 16, marginLeft: 12 }}>Delete conversation</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={confirmConv} transparent animationType="fade" onRequestClose={() => setConfirmConv(false)}>
        <Pressable style={styles.backdrop} onPress={() => setConfirmConv(false)}>
          <Pressable style={[styles.confirmCard, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <Text style={{ color: colors.onSurface, fontSize: 18, fontWeight: "800", marginBottom: 8 }}>Delete conversation?</Text>
            <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20, marginBottom: 18 }}>This removes it from your inbox. The other person keeps their copy.</Text>
            <ButtonRow
              buttons={[
                { title: "Cancel", variant: "secondary", testID: "delete-conversation-cancel", onPress: () => setConfirmConv(false) },
                { title: "Delete", testID: "delete-conversation-confirm", onPress: deleteConversation },
              ]}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bubbleRow: { flexDirection: "row", marginBottom: 8 },
  hdrLabel: { alignSelf: "flex-start", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  hdrLabelText: { fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  bubble: { maxWidth: "78%", borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, borderTopWidth: 1 },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 100, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingVertical: 20, paddingHorizontal: 16 },
  sheetTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
  sheetRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.06)" },
  confirmCard: { margin: 16, borderRadius: 18, padding: 20 },
});
