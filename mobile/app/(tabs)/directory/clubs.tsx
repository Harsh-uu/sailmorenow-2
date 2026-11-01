import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { api } from "@/src/lib/api";
import { Button, EmptyState, ErrorState, Loading } from "@/src/components/ui";
import { LogoCircle } from "@/src/components/LogoCircle";

import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";

import { useTheme } from "@/src/theme";

type Org = {
  user_id: string; handle?: string; name?: string; avatar?: string | null; picture?: string | null;
  bio?: string; primary_market?: string; partner_badge?: string | null; follower_count?: number;
  logo_url?: string | null; rating?: number | null; review_count?: number;
};

type FeedItem = { kind: string; id: string; title?: string; body?: string; when?: string; market?: string; location?: string; org?: { name?: string } };

export default function Clubs() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [feedOpen, setFeedOpen] = useState(false);
  const [search, setSearch] = useState("");

  const loadFeed = useCallback(() => {
    if (!user) { setFeed([]); return; }
    api.get<{ activity: FeedItem[] }>("/follows/feed").then((d) => setFeed(d.activity || [])).catch(() => {});
  }, [user]);

  useEffect(() => {
    api.get<{ partners: Org[] }>("/partners")
      .then((d) => setOrgs(d.partners || []))
      .catch((e: any) => setErr(e?.message || "Failed to load"));
  }, []);
  useEffect(() => {
    if (!user) { setFollowed(new Set()); setFeed([]); setBlocked(new Set()); return; }
    api.get<{ ids: string[] }>("/follows").then((d) => setFollowed(new Set(d.ids || []))).catch(() => {});
    api.get<{ blocked: { user_id: string }[] }>("/follows/blocked").then((d) => setBlocked(new Set((d.blocked || []).map((b) => b.user_id)))).catch(() => {});
    loadFeed();
  }, [user, loadFeed]);

  const toggleFollow = async (org: Org) => {
    if (!user) { toast.warning("Sign in to follow organizations"); return; }
    const id = org.user_id;
    const isF = followed.has(id);
    setBusy(id);
    try {
      if (isF) { await api.del(`/follows/${id}`); setFollowed((s) => { const n = new Set(s); n.delete(id); return n; }); }
      else { await api.post(`/follows/${id}`); setFollowed((s) => new Set(s).add(id)); toast.success(`Following ${org.name}`); }
    } catch { toast.error("Couldn't update follow"); } finally { setBusy(null); loadFeed(); }
  };

  const toggleBlock = async (org: Org) => {
    if (!user) { toast.warning("Sign in first"); return; }
    const id = org.user_id;
    const isB = blocked.has(id);
    setBusy(id);
    try {
      if (isB) { await api.del(`/follows/block/${id}`); setBlocked((s) => { const n = new Set(s); n.delete(id); return n; }); toast.success("Unblocked"); }
      else {
        await api.post(`/follows/block/${id}`);
        setBlocked((s) => new Set(s).add(id));
        setFollowed((s) => { const n = new Set(s); n.delete(id); return n; });
        toast.success(`Blocked ${org.name}`);
      }
    } catch { toast.error("Couldn't update"); } finally { setBusy(null); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.brandPrimary }}>
        <View style={styles.header}>
          <Pressable testID="clubs-back" onPress={() => router.back()} hitSlop={12}>
            <Icon name="chevron-back" size={24} color={colors.onBrandPrimary}  footprint={24}/>
          </Pressable>
          <Text style={[styles.hTitle, { color: colors.onBrandPrimary }]} numberOfLines={1}>Clubs & Organizations</Text>
          <View style={{ width: 24 }} />
        </View>
      </SafeAreaView>

      {err ? (
        <ErrorState message={err} />
      ) : !orgs ? (
        <Loading />
      ) : (
        <FlatList
          testID="clubs-list"
          data={(orgs || []).filter((o) => {
            const q = search.trim().toLowerCase();
            return !q || (o.name || "").toLowerCase().includes(q) || (o.handle || "").toLowerCase().includes(q);
          })}
          keyExtractor={(o) => o.user_id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListHeaderComponent={
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, marginBottom: 14 }}>
                <Icon name="search-outline" size={18} color={colors.muted} footprint={18} />
                <TextInput value={search} onChangeText={setSearch} placeholder="Search organizations by name…" placeholderTextColor={colors.muted}
                  testID="clubs-search-input" style={{ flex: 1, paddingVertical: 11, color: colors.onSurface, fontSize: 15 }} returnKeyType="search" />
                {search ? (
                  <Pressable testID="clubs-search-clear" onPress={() => setSearch("")} hitSlop={8}>
                    <Icon name="close" size={18} color={colors.muted} footprint={18} />
                  </Pressable>
                ) : null}
              </View>
              {user?.account_type === "partner" ? (
                <Pressable testID="clubs-edit-my-listing" onPress={() => router.push("/profile/org-listing" as any)}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.accent, borderRadius: 999, paddingVertical: 12, marginBottom: 14 }}>
                  <Icon name="create-outline" size={18} color={colors.onAccent} footprint={18} />
                  <Text style={{ color: colors.onAccent, fontWeight: "800", fontSize: 15 }}>Edit my listing</Text>
                </Pressable>
              ) : null}
              {feed.length > 0 ? (
                <View testID="following-feed" style={{ marginBottom: 4 }}>
                  <Pressable
                    testID="following-feed-toggle"
                    accessibilityRole="button"
                    accessibilityState={{ expanded: feedOpen }}
                    onPress={() => setFeedOpen((o) => !o)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: feedOpen ? 8 : 0, paddingVertical: 4 }}>
                    <Icon name="hub" size={18} color={colors.teal} footprint={18} />
                    <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 15 }}>From orgs you follow</Text>
                    <Icon name={feedOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} footprint={18} style={{ marginLeft: "auto" }} />
                  </Pressable>
                  {feedOpen ? (
                  <>
                  {feed.slice(0, 6).map((a) => (
                    <Pressable key={`${a.kind}-${a.id}`} testID={`following-feed-${a.kind}-${a.id}`}
                      onPress={() => a.kind === "event" ? router.push(`/directory/events/${a.id}` as any) : router.push("/(tabs)/feed" as any)}
                      style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 }}>
                      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" }}>
                        <Icon name={a.kind === "event" ? "calendar-outline" : "chatbubble-outline"} size={16} color={colors.teal} footprint={16} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 }} numberOfLines={1}>{(a.org?.name || (a.kind === "event" ? "EVENT" : "POST")).toUpperCase()}</Text>
                        <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>{a.title || "(untitled)"}</Text>
                        {a.kind === "event" ? <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{a.location || a.market}</Text> : (a.body ? <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13 }} numberOfLines={2}>{a.body}</Text> : null)}
                      </View>
                    </Pressable>
                  ))}
                  </>
                  ) : null}
                  <Text style={{ color: colors.muted, fontWeight: "800", fontSize: 13, marginTop: 4, marginBottom: 2 }}>All organizations</Text>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={search.trim() ? (
            <View style={{ paddingTop: 50 }} testID="clubs-search-empty"><EmptyState icon="search-outline" title={`No orgs match “${search}”`} subtitle="Try a different name or clear the search." /></View>
          ) : (
            <View style={{ paddingTop: 70 }}><EmptyState icon="org" title="No organizations yet" subtitle="Clubs and community partners will show up here." /></View>
          )}
          renderItem={({ item }) => {
            const isCP = !!item.partner_badge; // Community Partner or Founding Partner → navy card
            const isFounding = item.partner_badge === "founding";
            const cardBg = isCP ? colors.brandPrimary : colors.surface;
            const cardBorder = isCP ? colors.brandPrimary : colors.border;
            const onCard = isCP ? "#FFFFFF" : colors.onSurface;
            const subCard = isCP ? "rgba(255,255,255,0.72)" : colors.muted;
            return (
            <Pressable
              testID={`club-card-${item.handle || item.user_id}`}
              onPress={() => router.push(item.handle ? ({ pathname: "/directory/u/[handle]", params: { handle: item.handle } } as any) : (`/directory/org/${item.user_id}` as any))}
              style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}
            >
              {isCP ? (
                <View style={{ position: "absolute", top: 12, right: 12, zIndex: 1 }}
                      accessibilityLabel={isFounding ? "Founding Partner" : "Community Partner"}
                      testID={`${isFounding ? "fp" : "cp"}-flag-${item.user_id}`}>
                  <Icon name="flag" size={20} color={isFounding ? colors.accent : colors.teal} footprint={20} />
                </View>
              ) : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingRight: 28 }}>
                {item.picture || item.avatar || item.logo_url
                  ? <LogoCircle uri={item.logo_url || item.picture || item.avatar} size={48} accessibilityLabel={`${item.name} logo`} />
                  : <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: isCP ? "rgba(255,255,255,0.15)" : colors.tealSoft, alignItems: "center", justifyContent: "center" }}><Icon name="org" size={22} color={isCP ? "#fff" : colors.teal} footprint={22} /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: onCard, fontWeight: "800", fontSize: 15 }} numberOfLines={1}>{item.name}</Text>
                  {item.primary_market ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
                      <Icon name="location-outline" size={12} color={subCard} footprint={12} />
                      <Text style={{ color: subCard, fontSize: 12 }}>{item.primary_market}</Text>
                    </View>
                  ) : null}
                  {item.handle ? <Text style={{ color: subCard, fontSize: 11.5, marginTop: 2 }}>@{item.handle}</Text> : null}
                  <Text testID={`follower-count-${item.user_id}`} style={{ color: subCard, fontSize: 12, marginTop: 4 }}>
                    {item.rating ? `★ ${item.rating} · ` : ""}{item.follower_count || 0} follower{(item.follower_count || 0) === 1 ? "" : "s"}
                  </Text>
                </View>
              </View>
              {item.bio ? <Text style={{ color: isCP ? "rgba(255,255,255,0.85)" : colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18, marginTop: 10 }} numberOfLines={3}>{item.bio}</Text> : null}
              <View style={{ marginTop: 12 }}>
                {user?.user_id === item.user_id ? (
                  <Button title="Edit listing" variant="primary" icon="create-outline" onPress={() => router.push("/profile/org-listing" as any)} style={{ height: 40 }} testID={`edit-listing-${item.user_id}`} />
                ) : blocked.has(item.user_id) ? (
                  <Button title="Unblock" variant="secondary" icon="checkmark" onPress={() => toggleBlock(item)} disabled={busy === item.user_id} style={{ height: 40 }} testID={`unblock-btn-${item.user_id}`} />
                ) : (
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <View style={{ flex: 1 }}>
                      <Button title={followed.has(item.user_id) ? "✓ Following" : "Follow"} variant={isCP ? "secondary" : (followed.has(item.user_id) ? "secondary" : "primary")} onPress={() => toggleFollow(item)} disabled={busy === item.user_id} style={[{ height: 40 }, isCP ? { backgroundColor: "rgba(255,255,255,0.18)" } : null]} testID={`follow-btn-${item.user_id}`} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button title="Message" variant={isCP ? "primary" : "secondary"} icon="chatbubble-outline" onPress={() => router.push({ pathname: "/messages/[id]", params: { id: item.user_id, name: item.name || "" } })} style={{ height: 40 }} testID={`message-btn-${item.user_id}`} />
                    </View>
                  </View>
                )}
              </View>
            </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  hTitle: { fontSize: 18, fontWeight: "800", flexShrink: 1, paddingHorizontal: 8 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
});
