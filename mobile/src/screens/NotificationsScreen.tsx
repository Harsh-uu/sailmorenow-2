import { useCallback, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { EmptyState, Loading } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";
import { fmtTimeAgo } from "@/src/lib/format";
import { useNotifications } from "@/src/context/NotificationsContext";
import { Notif, notifIcon, notificationHref } from "@/src/lib/notifications";

const PAGE = 20;

export default function Notifications() {
  const { colors } = useTheme();
  const toast = useToast();
  const { refresh: refreshBadges } = useNotifications();
  const [items, setItems] = useState<Notif[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [undoInfo, setUndoInfo] = useState<Record<string, { action: string; meta: any; snapshot?: any }>>({});

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ items: Notif[]; has_more?: boolean }>(`/notifications?limit=${PAGE}&skip=0`);
      setItems(data.items || []);
      setHasMore(!!data.has_more);
      setError(false);
      refreshBadges();
    } catch {
      setError(true);
      setItems([]);
    }
  }, [refreshBadges]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !items) return;
    setLoadingMore(true);
    try {
      const data = await api.get<{ items: Notif[]; has_more?: boolean }>(`/notifications?limit=${PAGE}&skip=${items.length}`);
      setItems((prev) => [...(prev || []), ...(data.items || [])]);
      setHasMore(!!data.has_more);
    } catch { /* keep */ }
    finally { setLoadingMore(false); }
  }, [loadingMore, hasMore, items]);

  const markAll = async () => {
    try {
      await api.post("/notifications/mark-all-read", {});
      setItems((prev) => (prev ? prev.map((n) => ({ ...n, read: true })) : prev));
      refreshBadges();
    } catch { /* ignore */ }
  };

  // Tap a row: mark it read, refresh the badge, then open its destination
  // (review kinds -> the Reviews screen, with the session id passed along).
  const openRow = async (n: Notif) => {
    if (!n.read) {
      setItems((prev) => (prev ? prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)) : prev));
      try { await api.patch(`/notifications/${n.id}/read`, {}); } catch { /* ignore */ }
      refreshBadges();
    }
    const href = notificationHref(n);
    // withAnchor places the destination tab's root beneath the target so Back
    // returns to the tab root (e.g. review notifications -> Reviews -> Back to
    // the Profile menu) instead of leaving the tab.
    if (href) router.push(href as any, { withAnchor: true });
  };

  const moderate = async (n: Notif, action: "restore" | "remove") => {
    const meta = n.meta || {};
    if (!meta.target_type || !meta.target_id) return;
    setActingId(n.id);
    try {
      const res = await api.post<any>(`/admin/moderation/${action}`, { target_type: meta.target_type, target_id: meta.target_id });
      await api.patch(`/notifications/${n.id}/read`, {}).catch(() => {});
      setItems((prev) => (prev ? prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)) : prev));
      setUndoInfo((p) => ({ ...p, [n.id]: { action, meta, snapshot: res?.snapshot } }));
      refreshBadges();
      toast.success(action === "restore" ? "Content restored" : "Content removed");
    } catch (e: any) {
      toast.error(e?.message || "Action failed");
    } finally { setActingId(null); }
  };

  const undo = async (id: string) => {
    const info = undoInfo[id];
    if (!info) return;
    setActingId(id);
    try {
      if (info.action === "restore") await api.post("/admin/moderation/hide", { target_type: info.meta.target_type, target_id: info.meta.target_id });
      else await api.post("/admin/moderation/restore-doc", { target_type: info.meta.target_type, snapshot: info.snapshot });
      setUndoInfo((p) => { const n = { ...p }; delete n[id]; return n; });
      toast.success("Undone");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't undo");
    } finally { setActingId(null); }
  };

  const reviewNudge = async (n: Notif, action: "snooze" | "off") => {
    setActingId(n.id);
    try {
      await api.post("/review-nudge/preference", { action });
      await api.patch(`/notifications/${n.id}/read`, {}).catch(() => {});
      setItems((prev) => (prev ? prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)) : prev));
      refreshBadges();
      toast.success(action === "off" ? "Review reminders turned off" : "We'll remind you later");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't update");
    } finally { setActingId(null); }
  };

  return (
    <Screen
      title="Notifications"
      showBack
      padded={false}
      right={
        <Pressable testID="mark-all-read-btn" onPress={markAll} hitSlop={8} style={{ paddingHorizontal: 4, paddingVertical: 6 }}>
          <Text style={{ color: colors.onBrandPrimary, fontWeight: "700", fontSize: 13 }}>Mark all as read</Text>
        </Pressable>
      }
    >
      {items == null ? (
        <Loading />
      ) : error ? (
        <View style={{ paddingTop: 80, alignItems: "center", gap: 14 }}>
          <EmptyState icon="cloud-offline-outline" title="Couldn't load notifications" subtitle="Check your connection and try again." />
          <Pressable testID="notifications-retry" onPress={load} style={{ backgroundColor: colors.brandPrimary, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10 }}>
            <Text style={{ color: colors.onBrandPrimary, fontWeight: "800" }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          ListEmptyComponent={
            <View style={{ paddingTop: 80 }}>
              <EmptyState icon="notifications-outline" title="You're all caught up." subtitle="New activity will show up here." />
            </View>
          }
          ListFooterComponent={loadingMore ? <View style={{ paddingVertical: 16 }}><ActivityIndicator color={colors.teal} /></View> : null}
          renderItem={({ item }) => {
            const hasActions = (item.kind === "content_hidden" && item.meta?.target_id) || item.kind === "review_nudge";
            return (
              <Pressable
                testID={`notif-row-${item.id}`}
                onPress={() => openRow(item)}
                style={[styles.row, { backgroundColor: item.read ? colors.surface : colors.tealSoft, borderColor: colors.border }]}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.brandTertiary }]}>
                  <Icon name={notifIcon(item.kind)} size={18} color={colors.navy} footprint={18} testID={`notif-icon-${item.kind}`} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 14.5 }}>{item.title}</Text>
                  {item.body ? <Text numberOfLines={2} style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, marginTop: 2 }}>{item.body}</Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{fmtTimeAgo(item.created_at)}</Text>

                  {item.kind === "content_hidden" && item.meta?.target_id ? (
                    undoInfo[item.id] ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 }}>
                        <Text style={{ color: colors.muted, fontSize: 12.5, flex: 1 }}>{undoInfo[item.id].action === "restore" ? "Restored" : "Removed"}</Text>
                        <Pressable testID={`notif-undo-${item.id}`} disabled={actingId === item.id} onPress={() => undo(item.id)}
                          style={{ backgroundColor: colors.brandPrimary, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8, opacity: actingId === item.id ? 0.5 : 1 }}>
                          <Text style={{ color: colors.onBrandPrimary, fontWeight: "800", fontSize: 12.5 }}>Undo</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                        <Pressable testID={`notif-restore-${item.id}`} disabled={actingId === item.id} onPress={() => moderate(item, "restore")}
                          style={{ flex: 1, backgroundColor: colors.tealSoft, borderRadius: 999, paddingVertical: 8, alignItems: "center", opacity: actingId === item.id ? 0.5 : 1 }}>
                          <Text style={{ color: colors.teal, fontWeight: "800", fontSize: 12.5 }}>Restore</Text>
                        </Pressable>
                        <Pressable testID={`notif-remove-${item.id}`} disabled={actingId === item.id} onPress={() => moderate(item, "remove")}
                          style={{ flex: 1, backgroundColor: "rgba(220,38,38,0.12)", borderRadius: 999, paddingVertical: 8, alignItems: "center", opacity: actingId === item.id ? 0.5 : 1 }}>
                          <Text style={{ color: colors.error, fontWeight: "800", fontSize: 12.5 }}>Remove</Text>
                        </Pressable>
                      </View>
                    )
                  ) : null}

                  {item.kind === "review_nudge" ? (
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                      <Pressable testID={`notif-snooze-${item.id}`} disabled={actingId === item.id} onPress={() => reviewNudge(item, "snooze")}
                        style={{ flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: 999, paddingVertical: 8, alignItems: "center", opacity: actingId === item.id ? 0.5 : 1 }}>
                        <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 12.5 }}>Remind me later</Text>
                      </Pressable>
                      <Pressable testID={`notif-nudge-off-${item.id}`} disabled={actingId === item.id} onPress={() => reviewNudge(item, "off")}
                        style={{ flex: 1, backgroundColor: "rgba(220,38,38,0.12)", borderRadius: 999, paddingVertical: 8, alignItems: "center", opacity: actingId === item.id ? 0.5 : 1 }}>
                        <Text style={{ color: colors.error, fontWeight: "800", fontSize: 12.5 }}>Turn off</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>

                {!item.read ? <View testID={`notif-unread-${item.id}`} style={[styles.dot, { backgroundColor: colors.accent }]} /> : null}
                {!hasActions ? <Icon name="chevron-forward" size={16} color={colors.borderStrong} footprint={16} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 8, alignItems: "flex-start" },
  iconWrap: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 4 },
});
