import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { NotificationBell } from "@/src/components/NotificationBell";
import { MotionModal as Modal } from "@/src/components/MotionModal";

import { api } from "@/src/lib/api";
import { Avatar, ButtonRow, EmptyState, ErrorState, Loading } from "@/src/components/ui";
import { useTheme } from "@/src/theme";
import { AppHeader } from "@/src/components/AppHeader";
import { fmtTimeAgo } from "@/src/lib/format";
import { useAppSocket } from "@/src/context/WebSocketContext";
import { useAuth } from "@/src/context/AuthContext";
import { canInteract } from "@/src/lib/plan";
import { useToast } from "@/src/context/ToastContext";

type Thread = {
  thread_id: string;
  last_message?: string;
  updated_at?: string;
  unread?: number;
  is_group?: boolean;
  title?: string;
  channel?: string;
  business_name?: string;
  viewer_is_boat_pro?: boolean;
  members?: { user_id: string; name?: string; avatar?: string | null; picture?: string | null }[];
  other_user?: { user_id: string; name?: string; avatar?: string | null; picture?: string | null };
};

export default function Messages() {
  const { colors } = useTheme();
  const { subscribe } = useAppSocket();
  const { user } = useAuth();
  const toast = useToast();
  const isPaid = canInteract(user);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [unlock, setUnlock] = useState<{ count: number } | null>(null);
  const [menuThread, setMenuThread] = useState<Thread | null>(null);
  const [confirmThread, setConfirmThread] = useState<Thread | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get<Thread[]>("/messages/threads");
      setThreads(data);
      if (isPaid) {
        api.get<{ show: boolean; count: number }>("/messages/unlock-banner")
          .then((d) => { if (d?.show) setUnlock({ count: d.count }); }).catch(() => {});
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load messages");
    }
  }, [isPaid]);

  const dismissUnlock = () => { setUnlock(null); api.post("/messages/unlock-banner/ack").catch(() => {}); };

  const deleteThread = async (t: Thread) => {
    setConfirmThread(null);
    try {
      await api.del(`/messages/thread/${t.thread_id}`);
      setThreads((prev) => (prev ? prev.filter((x) => x.thread_id !== t.thread_id) : prev));
    } catch (e: any) {
      toast.error(e?.message || "Couldn't delete conversation");
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
      const off1 = subscribe("message", () => load());
      const off2 = subscribe("message.read", () => load());
      return () => {
        off1();
        off2();
      };
    }, [load, subscribe]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <AppHeader title="Messages" right={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <NotificationBell />
            {isPaid ? (
              <Pressable testID="new-message-btn" onPress={() => router.push("/messages/new" as any)} hitSlop={10}>
                <Icon name="add" size={24} color={colors.onBrandPrimary} footprint={24} />
              </Pressable>
            ) : null}
          </View>
      } />

      {unlock ? (
        <View testID="inbox-unlock-banner" style={{ flexDirection: "row", alignItems: "center", gap: 10, margin: 12, marginBottom: 0, padding: 12, borderRadius: 14, backgroundColor: colors.accent + "1A", borderWidth: 1, borderColor: colors.accent + "55" }}>
          <Icon name="mail" size={18} color={colors.accent} footprint={18} />
          <Text style={{ flex: 1, color: colors.onSurface, fontWeight: "700", fontSize: 13.5 }}>You have {unlock.count} message{unlock.count === 1 ? "" : "s"} waiting - now unlocked.</Text>
          <Pressable testID="inbox-unlock-dismiss" onPress={dismissUnlock} hitSlop={8}>
            <Icon name="close" size={16} color={colors.muted} footprint={16} />
          </Pressable>
        </View>
      ) : null}

      {!isPaid ? (
        <View testID="messages-upgrade-wall" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Icon name="messages" size={30} color={colors.accent} footprint={30} />
          </View>
          <Text style={{ color: colors.onSurface, fontSize: 20, fontWeight: "800", textAlign: "center" }}>Messaging is a Premium feature</Text>
          <Text style={{ color: colors.muted, fontSize: 14.5, textAlign: "center", marginTop: 8, lineHeight: 21 }}>
            Upgrade your membership to send direct messages, start group chats, and connect with Boat Pros and the crew.
          </Text>
          <Pressable
            testID="messages-upgrade-btn"
            onPress={() => router.push("/pricing" as any)}
            style={{ marginTop: 22, backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 26, paddingVertical: 13 }}
          >
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>See membership plans</Text>
          </Pressable>
        </View>
      ) : threads == null && !error ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.thread_id}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
          ListEmptyComponent={
            <View style={{ paddingTop: 80 }}>
              <EmptyState
                icon="mail-outline"
                title="No conversations yet"
                subtitle="Message a Boat Pro or sailor from their profile to get started."
              />
            </View>
          }
          renderItem={({ item }) => {
            const unread = item.unread || 0;
            if (item.is_group) {
              const title = item.title || (item.members || []).map((m) => m.name?.split(" ")[0]).filter(Boolean).slice(0, 3).join(", ") || "Group chat";
              return (
                <Pressable
                  testID={`thread-group-${item.thread_id}`}
                  onPress={() =>
                    router.push({ pathname: "/messages/[id]", params: { id: item.thread_id, name: title, group: "1" } })
                  }
                  style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={[styles.groupAvatar, { backgroundColor: colors.tealSoft }]}>
                    <Icon name="people" size={22} color={colors.teal} footprint={22} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={[styles.name, { color: colors.onSurface, flexShrink: 1 }]} numberOfLines={2}>{title}</Text>
                      <Text style={[styles.time, { color: colors.muted }]} maxFontSizeMultiplier={1.3}>{fmtTimeAgo(item.updated_at)}</Text>
                    </View>
                    <View style={styles.rowBottom}>
                      <Text style={[styles.preview, { color: unread ? colors.onSurface : colors.muted, fontWeight: unread ? "700" : "400" }]} numberOfLines={1}>
                        {item.last_message || "Say hello 👋"}
                      </Text>
                      {unread ? (
                        <View style={[styles.unread, { backgroundColor: colors.accent }]}>
                          <Text style={styles.unreadText}>{unread}</Text>
                        </View>
                      ) : (
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{(item.members || []).length} people</Text>
                      )}
                    </View>
                  </View>
                  <Pressable testID={`thread-menu-${item.thread_id}`} onPress={() => setMenuThread(item)} hitSlop={8} style={{ paddingLeft: 4 }}>
                    <Icon name="ellipsis-horizontal" size={18} color={colors.muted} footprint={24} />
                  </Pressable>
                </Pressable>
              );
            }
            const other = item.other_user;
            return (
              <Pressable
                testID={`thread-${other?.user_id}`}
                onPress={() =>
                  other?.user_id &&
                  router.push({
                    pathname: "/messages/[id]",
                    params: { id: other.user_id, name: other?.name || "Sailor", thread: item.thread_id },
                  })
                }
                style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Avatar uri={other?.picture || other?.avatar} name={other?.name} size={48} />
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <Text style={[styles.name, { color: colors.onSurface, flexShrink: 1 }]} numberOfLines={2}>
                      {other?.name || "Sailor"}
                    </Text>
                    <Text style={[styles.time, { color: colors.muted }]} maxFontSizeMultiplier={1.3}>{fmtTimeAgo(item.updated_at)}</Text>
                  </View>
                  {item.viewer_is_boat_pro && item.channel === "business" && item.business_name ? (
                    <View style={[styles.labelPill, { backgroundColor: colors.brandPrimary + "1A" }]}>
                      <Text style={[styles.labelPillText, { color: colors.brandPrimary }]} numberOfLines={1}>
                        {item.business_name}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.rowBottom}>
                    <Text
                      style={[styles.preview, { color: unread ? colors.onSurface : colors.muted, fontWeight: unread ? "700" : "400" }]}
                      numberOfLines={1}
                    >
                      {item.last_message || "Say hello 👋"}
                    </Text>
                    {unread ? (
                      <View style={[styles.unread, { backgroundColor: colors.accent }]}>
                        <Text style={styles.unreadText}>{unread}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Pressable testID={`thread-menu-${other?.user_id}`} onPress={() => setMenuThread(item)} hitSlop={8} style={{ paddingLeft: 4 }}>
                  <Icon name="ellipsis-horizontal" size={18} color={colors.muted} footprint={24} />
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}

      <Modal visible={!!menuThread} transparent animationType="fade" onRequestClose={() => setMenuThread(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuThread(null)}>
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sheetTitle, { color: colors.onSurface }]}>Conversation</Text>
            <Pressable testID="delete-conversation-row" onPress={() => { const t = menuThread; setMenuThread(null); setConfirmThread(t); }} style={styles.sheetRow}>
              <Icon name="trash-outline" size={20} color="#DC2626" footprint={20} />
              <Text style={{ color: "#DC2626", fontSize: 16, marginLeft: 12 }}>Delete conversation</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!confirmThread} transparent animationType="fade" onRequestClose={() => setConfirmThread(null)}>
        <Pressable style={styles.backdrop} onPress={() => setConfirmThread(null)}>
          <Pressable style={[styles.confirmCard, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <Text style={{ color: colors.onSurface, fontSize: 18, fontWeight: "800", marginBottom: 8 }}>Delete conversation?</Text>
            <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20, marginBottom: 18 }}>This removes it from your inbox. The other person keeps their copy.</Text>
            <ButtonRow
              buttons={[
                { title: "Cancel", variant: "secondary", testID: "delete-conversation-cancel", onPress: () => setConfirmThread(null) },
                { title: "Delete", testID: "delete-conversation-confirm", onPress: () => confirmThread && deleteThread(confirmThread) },
              ]}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  hTitle: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3, flexShrink: 1 },
  groupAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, marginBottom: 8 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 15.5, fontWeight: "700", flex: 1 },
  time: { fontSize: 12 },
  rowBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 3 },
  preview: { fontSize: 14, flex: 1 },
  labelPill: { alignSelf: "flex-start", marginTop: 3, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  labelPillText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  unread: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  unreadText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingVertical: 20, paddingHorizontal: 16 },
  sheetTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
  sheetRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  confirmCard: { margin: 16, borderRadius: 18, padding: 20 },
});
