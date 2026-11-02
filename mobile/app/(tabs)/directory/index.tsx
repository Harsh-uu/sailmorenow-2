import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { NotificationBell } from "@/src/components/NotificationBell";
import { FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";

import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { storage } from "@/src/utils/storage";
import { Avatar, Button, EmptyState, ErrorState, Loading } from "@/src/components/ui";
import { LogoCircle } from "@/src/components/LogoCircle";
import { MultiSelectPicker } from "@/src/components/MultiSelectPicker";
import { useTheme } from "@/src/theme";
import { AppHeader } from "@/src/components/AppHeader";

type Pro = {
  user_id: string;
  company_name: string;
  short_bio?: string;
  categories?: string[];
  markets?: string[];
  logo_url?: string | null;
  tier?: string;
  is_complete?: boolean;
  identity_verified?: boolean;
  rating?: number | null;
  review_count?: number;
};

export default function Directory() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [pros, setPros] = useState<Pro[] | null>(null);
  const [markets, setMarkets] = useState<string[]>([]);
  const [market, setMarket] = useState("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [catCounts, setCatCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    api.get<{ markets: string[]; categories: string[] }>("/markets")
      .then((d) => { setMarkets(d.markets || []); setCategories(d.categories || []); })
      .catch(() => {});
  }, []);

  // Restore the member's last-picked market + specialty so the directory opens where they left off.
  useEffect(() => {
    (async () => {
      const m = await storage.getItem("smn-dir-market", "all");
      const c = await storage.getItem("smn-dir-category", "");
      setMarket(m || "all");
      setCategory(c || "");
      setHydrated(true);
    })();
  }, []);
  useEffect(() => { if (hydrated) storage.setItem("smn-dir-market", market).catch(() => {}); }, [market, hydrated]);
  useEffect(() => { if (hydrated) storage.setItem("smn-dir-category", category).catch(() => {}); }, [category, hydrated]);

  // Per-specialty counts for the current market (drives the picker badges).
  useEffect(() => {
    const p = market && market !== "all" ? `?market=${encodeURIComponent(market)}` : "";
    api.get<{ counts: Record<string, number>; total: number }>(`/boat-pros/category-counts${p}`)
      .then((d) => { setCatCounts(d.counts || {}); setTotal(d.total || 0); })
      .catch(() => {});
  }, [market]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (market !== "all") params.set("market", market);
      if (category) params.set("category", category);
      const data = await api.get<Pro[]>(`/boat-pros${params.toString() ? `?${params}` : ""}`);
      setPros(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load directory");
    }
  }, [market, category]);

  useEffect(() => {
    if (hydrated) load();
  }, [load, hydrated]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const marketOptions = [{ value: "all", label: "All markets" }, ...markets.map((m) => ({ value: m, label: m }))];
  const catOptions = [
    { value: "", label: "All specialties", count: total },
    ...categories.map((c) => ({ value: c, label: c, count: catCounts[c] || 0 })),
  ];
  const clearFilters = () => { setMarket("all"); setCategory(""); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <AppHeader title="Boat Pros" right={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <Pressable testID="directory-clubs-link" onPress={() => router.push("/directory/clubs" as any)} style={styles.clubsLink} accessibilityRole="button" accessibilityLabel="Clubs and Orgs">
              <Icon name="org" size={15} color={colors.onBrandPrimary} footprint={15} />
              <Text style={{ color: colors.onBrandPrimary, fontWeight: "700", fontSize: 13 }} numberOfLines={1} maxFontSizeMultiplier={1.2}>Clubs & Orgs</Text>
              <Icon name="chevron-forward" size={14} color={colors.onBrandPrimary} footprint={14} />
            </Pressable>
            <NotificationBell />
          </View>
      } />

      <View style={styles.controls}>
        <View style={styles.pickerRow}>
          <MultiSelectPicker
            label="Market"
            title="Filter by market"
            options={marketOptions}
            value={[market]}
            onChange={(next) => setMarket(next[0] || "all")}
            single
            testID="dir-market-picker"
            accessibilityLabel={`Market: ${market === "all" ? "All markets" : market}`}
          />
          <MultiSelectPicker
            label="Specialty"
            title="Filter by specialty"
            options={catOptions}
            value={[category]}
            onChange={(next) => setCategory(next[0] || "")}
            single
            placeholder="All specialties"
            valueLabel={category ? `${category} (${catCounts[category] ?? 0})` : undefined}
            testID="dir-specialty-picker"
            accessibilityLabel={`Specialty: ${category || "All specialties"}`}
          />
        </View>
        {user?.account_type === "boat_pro" ? (
          <Pressable testID="directory-my-listing-link" onPress={() => router.push({ pathname: "/directory/boat-pro-listing", params: { from: "directory" } } as any)} style={[styles.myListing, { borderColor: colors.border, backgroundColor: colors.surface }]} accessibilityRole="button" accessibilityLabel="My Listing">
            <Icon name="myListing" size={16} color={colors.teal} footprint={16} />
            <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 13, flex: 1 }}>My Listing</Text>
            <Icon name="chevron-forward" size={16} color={colors.muted} footprint={16} />
          </Pressable>
        ) : null}
      </View>

      {pros == null && !error ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <FlatList
          data={pros}
          keyExtractor={(p) => p.user_id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
          ListEmptyComponent={
            <View style={{ paddingTop: 50, paddingHorizontal: 8 }}>
              <EmptyState
                icon="compass-outline"
                title={category ? `No ${category} pros yet` : "No Boat Pros found"}
                subtitle={category
                  ? `No ${category} pros in ${market === "all" ? "the PNW" : market} yet. Know a great one? Invite them to get listed.`
                  : "Try a different market or specialty."}
              />
              {(category || market !== "all") ? (
                <Button title="Clear filters" variant="secondary" onPress={clearFilters} testID="dir-clear-filters" style={{ marginTop: 16, alignSelf: "center" }} />
              ) : null}
              {category ? (
                <Button
                  title="Invite a pro you know"
                  icon="share-social-outline"
                  onPress={() => Share.share({ message: `Know a great ${category} in ${market === "all" ? "the PNW" : market}? They should get listed on Sail More Now - the Pacific Northwest sailing community.` }).catch(() => {})}
                  testID="invite-pro-btn"
                  style={{ marginTop: 12, alignSelf: "center" }}
                />
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const isOwnerCard = !!user && item.user_id === user.user_id;
            // Tier shown ONLY as a border colour (never a name/badge): Premium orange, Featured teal, Basic slate.
            const borderColor = item.tier === "premium" ? "#F2A03B" : item.tier === "featured" ? colors.teal : colors.border;
            const fg = colors.onSurface;
            const fgSub = colors.onSurfaceSecondary;
            const fgMuted = colors.muted;
            return (
            <Pressable
              testID={`pro-card-${item.user_id}`}
              onPress={() => router.push(`/directory/pro/${item.user_id}` as any)}
              style={[styles.card, { backgroundColor: colors.surface, borderColor, borderWidth: 2 }]}
            >
              <LogoCircle uri={item.logo_url} size={48} testID={`pro-logo-${item.user_id}`}
                fallback={<Avatar uri={null} name={item.company_name} size={48} />} />
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={[styles.title, { color: fg, flexShrink: 1 }]} numberOfLines={2}>
                    {item.company_name}
                  </Text>
                  {item.identity_verified ? <Icon name="verified" size={16} color={colors.teal} footprint={16} testID={`pro-verified-${item.user_id}`} /> : null}
                </View>
                {item.short_bio ? (
                  <Text style={[styles.bio, { color: fgSub }]} numberOfLines={2}>
                    {item.short_bio}
                  </Text>
                ) : null}
                <View style={styles.metaRow}>
                  {item.rating != null ? (
                    <View style={styles.rating}>
                      <Icon name="star" size={13} color={colors.accent} footprint={13} />
                      <Text style={[styles.meta, { color: fgSub }]}>
                        {item.rating} ({item.review_count})
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.meta, { color: fgMuted }]}>No reviews yet</Text>
                  )}
                  <Text style={[styles.meta, { color: fgMuted, flexShrink: 1 }]} numberOfLines={1}>
                    · {(item.categories || [])[0] || "Boat Pro"}
                  </Text>
                </View>
              </View>
              {isOwnerCard ? (
                <Pressable testID={`pro-card-edit-${item.user_id}`} onPress={(e) => { e.stopPropagation(); router.push({ pathname: "/directory/boat-pro-listing", params: { from: "directory" } } as any); }}
                  accessibilityRole="button" accessibilityLabel="Edit"
                  style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.teal, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" }}>
                  <Icon name="create-outline" size={14} color={colors.teal} footprint={14} />
                  <Text style={{ color: colors.teal, fontWeight: "800", fontSize: 12.5 }}>Edit</Text>
                </Pressable>
              ) : null}
            </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { height: 52, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  hTitle: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3, flexShrink: 1 },
  clubsLink: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  controls: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 10 },
  pickerRow: { flexDirection: "row", gap: 10 },
  myListing: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, minHeight: 44 },
  card: { borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 12, flexDirection: "row", gap: 12, alignItems: "center" },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 16, fontWeight: "700", flex: 1, letterSpacing: -0.2 },
  bio: { fontSize: 13.5, lineHeight: 19, marginTop: 3 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  meta: { fontSize: 12.5 },
});
