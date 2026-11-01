import { useCallback, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { Avatar, Badge, EmptyState, ErrorState, Loading } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { useTheme } from "@/src/theme";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { isFreeIndividual } from "@/src/lib/plan";
import { promptCommentUpgrade } from "@/src/lib/upgrade";
import { fmtTimeAgo } from "@/src/lib/format";

type Discussion = {
  id: string;
  kind: "forum" | "blog";
  title: string;
  body: string;
  author_name?: string;
  author_avatar?: string | null;
  market?: string;
  tags?: string[];
  published_at?: string;
  created_at?: string;
};

export default function Hub() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [kind, setKind] = useState<"forum" | "blog">("forum");
  const [items, setItems] = useState<Discussion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get<Discussion[]>(`/discussions?kind=${kind}&status=published`);
      setItems(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load the hub");
    }
  }, [kind]);

  useFocusEffect(
    useCallback(() => {
      setItems(null);
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <Screen title="Community Hub" showBack padded={false}>
      <View style={[styles.toggle, { backgroundColor: colors.surfaceTertiary }]}>
        {(["forum", "blog"] as const).map((k) => (
          <Pressable
            key={k}
            testID={`hub-tab-${k}`}
            onPress={() => setKind(k)}
            style={[styles.toggleBtn, kind === k && { backgroundColor: colors.surface }]}
          >
            <Text style={{ color: kind === k ? colors.navy : colors.muted, fontWeight: "700", fontSize: 14 }}>
              {k === "forum" ? "Forum" : "Blog"}
            </Text>
          </Pressable>
        ))}
      </View>

      {items == null && !error ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
          ListEmptyComponent={
            <View style={{ paddingTop: 60 }}>
              <EmptyState
                icon={kind === "forum" ? "chatbubbles-outline" : "newspaper-outline"}
                title={kind === "forum" ? "No forum topics yet" : "No blog posts yet"}
                subtitle={kind === "forum" ? "Start a conversation with the community." : "Check back soon for stories from the fleet."}
              />
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`hub-card-${item.id}`}
              onPress={() => router.push({ pathname: "/hub/[id]", params: { id: item.id } })}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.top}>
                <Avatar uri={item.author_avatar} name={item.author_name} size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.author, { color: colors.onSurface }]} numberOfLines={1}>
                    {item.author_name || "Member"}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {item.market ? `${item.market} · ` : ""}{fmtTimeAgo(item.created_at || item.published_at)}
                  </Text>
                </View>
                <Badge label={item.kind === "blog" ? "Blog" : "Forum"} tone={item.kind === "blog" ? "accent" : "teal"} />
              </View>
              <Text style={[styles.title, { color: colors.onSurface }]}>{item.title}</Text>
              <Text style={[styles.body, { color: colors.onSurfaceSecondary }]} numberOfLines={2}>
                {item.body}
              </Text>
            </Pressable>
          )}
        />
      )}

      <Pressable
        testID="hub-compose-fab"
        onPress={() => { if (isFreeIndividual(user)) { promptCommentUpgrade(toast, "Upgrade to start topics and write blog posts"); return; } router.push({ pathname: "/hub/new", params: { kind } }); }}
        style={[styles.fab, { backgroundColor: colors.accent }]}
      >
        <Icon name="create-outline" size={26} color={colors.onAccent}  footprint={26}/>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: "row", margin: 16, marginBottom: 0, padding: 4, borderRadius: 999 },
  toggleBtn: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 999 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 14 },
  top: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  author: { fontWeight: "700", fontSize: 14.5 },
  meta: { fontSize: 12.5 },
  title: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2, marginBottom: 5 },
  body: { fontSize: 14.5, lineHeight: 20 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
