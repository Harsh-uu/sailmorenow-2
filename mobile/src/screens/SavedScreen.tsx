import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter, Stack } from "expo-router";
import { api } from "@/src/lib/api";
import { Icon } from "@/src/components/Icon";
import { EmptyState, Loading } from "@/src/components/ui";
import { useTheme } from "@/src/theme";
import { useGo } from "@/src/lib/stackBase";

const TYPE_LABEL: Record<string, string> = {
  for_sale: "For Sale", volunteer_opportunity: "Volunteer", sailing_opportunity: "Sailing",
  general: "Post", blog: "Blog", forum: "Forum",
};

export default function Saved() {
  const { colors } = useTheme();
  const router = useRouter();
  const go = useGo();
  const [items, setItems] = useState<any[] | null>(null);
  const load = useCallback(() => {
    api.get<any[]>("/saved").then((d) => setItems(d || [])).catch(() => setItems([]));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const remove = async (id: string) => {
    setItems((cur) => (cur || []).filter((x) => x.id !== id));
    try { await api.del(`/saved/${id}`); } catch { load(); }
  };
  const open = (it: any) => {
    if (it.saved_type === "discussion") go(`/hub/${it.id}`);
    else go(`/post/${it.id}`);
  };
  const tagFor = (it: any) => it.saved_type === "discussion" ? (TYPE_LABEL[it.kind] || "Hub") : (TYPE_LABEL[it.type] || "Post");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={["top"]}>
      <Stack.Screen options={{ title: "Saved" }} />
      <View style={styles.header}>
        <Pressable testID="saved-back" onPress={() => router.back()} hitSlop={10}><Icon name="chevron-back" size={24} color={colors.onSurface} footprint={24} /></Pressable>
        <Text style={[styles.title, { color: colors.onSurface }]}>Saved</Text>
        <View style={{ width: 24 }} />
      </View>
      {items === null ? <Loading /> : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          ListEmptyComponent={<View style={{ paddingTop: 70 }}><EmptyState icon="bookmark-outline" title="Nothing saved yet" subtitle="Tap the bookmark on any post, listing, forum topic or blog to keep it here." /></View>}
          renderItem={({ item }) => (
            <Pressable testID={`saved-item-${item.id}`} onPress={() => open(item)} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.6, marginBottom: 2 }}>{tagFor(item).toUpperCase()}</Text>
                <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 15 }} numberOfLines={2}>{item.title}</Text>
                {item.type === "for_sale" && typeof item.price === "number" ? (
                  <Text style={{ color: colors.accent, fontWeight: "800", marginTop: 2 }}>${item.price.toLocaleString()}</Text>
                ) : null}
              </View>
              <Pressable testID={`saved-remove-${item.id}`} onPress={() => remove(item.id)} hitSlop={8} style={[styles.remove, { borderColor: colors.border }]}>
                <Icon name="trash-outline" size={16} color={colors.error} footprint={16} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: "800" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 10 },
  remove: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
