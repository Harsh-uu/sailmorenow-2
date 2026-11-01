import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { Screen } from "@/src/components/Screen";
import { EmptyState, Loading } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";
import { fmtDateTime, eventTitleParts } from "@/src/lib/format";

type FeedItem = {
  kind: string; id: string; title?: string; body?: string; when?: string;
  market?: string; location?: string; org?: { name?: string }; time_not_listed?: boolean | null;
};

export default function Following() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [followingCount, setFollowingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ activity: FeedItem[]; following_count: number }>("/follows/feed");
      setItems(d.activity || []);
      setFollowingCount(d.following_count || 0);
    } catch {
      setItems([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  return (
    <Screen title="Following" subtitle={followingCount ? `${followingCount} organization${followingCount === 1 ? "" : "s"}` : undefined}>
      {items == null ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => `${it.kind}-${it.id}`}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
          ListEmptyComponent={
            <View style={{ paddingTop: 70 }}>
              <EmptyState icon="org" title="Nothing here yet"
                subtitle="Follow clubs and organizations to see their events and posts here." />
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`following-item-${item.kind}-${item.id}`}
              onPress={() => item.kind === "event"
                ? router.push(`/events/events/${item.id}` as any)
                : router.push("/(tabs)/feed" as any)}
              style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" }}>
                <Icon name={item.kind === "event" ? "calendar-outline" : "chatbubble-outline"} size={18} color={colors.teal} footprint={18} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 }} numberOfLines={1}>
                  {(item.org?.name || (item.kind === "event" ? "EVENT" : "POST")).toUpperCase()}
                </Text>
                <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 15 }} numberOfLines={2}>{item.kind === "event" ? eventTitleParts(item.title).title || "(untitled)" : (item.title || "(untitled)")}</Text>
                {item.kind === "event"
                  ? <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>{item.when ? fmtDateTime(item.when, item.time_not_listed) : ""}{item.location ? ` · ${item.location}` : ""}</Text>
                  : (item.body ? <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 }} numberOfLines={2}>{item.body}</Text> : null)}
              </View>
              <Icon name="chevron-forward" size={18} color={colors.muted} footprint={18} />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, alignItems: "center", borderWidth: 1, borderRadius: 14, padding: 12 },
});
