import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { Screen } from "@/src/components/Screen";
import { Avatar, EmptyState, Loading } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";
import { useGo } from "@/src/lib/stackBase";

type Org = { user_id: string; name?: string; handle?: string; avatar?: string | null; picture?: string | null; account_type?: string; partner_badge?: string | null };
const ORG_TYPES = new Set(["partner", "community_partner", "boat_pro"]);

export default function FollowingList() {
  const { colors } = useTheme();
  const toast = useToast();
  const go = useGo();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [suggestions, setSuggestions] = useState<Org[]>([]);
  const [followers, setFollowers] = useState<Org[]>([]);
  const [blocked, setBlocked] = useState<Org[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ orgs: Org[] }>("/follows");
      setOrgs(d.orgs || []);
    } catch {
      setOrgs([]);
    }
    try { setSuggestions((await api.get<{ suggestions: Org[] }>("/follows/suggestions?limit=6")).suggestions || []); } catch { /* ignore */ }
    try { setFollowers((await api.get<{ followers: Org[] }>("/follows/followers")).followers || []); } catch { /* ignore */ }
    try { setBlocked((await api.get<{ blocked: Org[] }>("/follows/blocked")).blocked || []); } catch { /* ignore */ }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const blockUser = async (item: Org) => {
    setBusyId(item.user_id);
    try {
      await api.post(`/follows/block/${item.user_id}`);
      setFollowers((p) => p.filter((x) => x.user_id !== item.user_id));
      setBlocked((p) => [...p, item]);
      toast.success(`Blocked ${item.name || "member"}`);
    } catch { toast.error("Couldn't block"); } finally { setBusyId(null); }
  };
  const unblockUser = async (item: Org) => {
    setBusyId(item.user_id);
    try { await api.del(`/follows/block/${item.user_id}`); setBlocked((p) => p.filter((x) => x.user_id !== item.user_id)); toast.success(`Unblocked ${item.name || "member"}`); }
    catch { toast.error("Couldn't unblock"); } finally { setBusyId(null); }
  };

  const followSuggestion = async (item: Org) => {
    setBusyId(item.user_id);
    try {
      await api.post(`/follows/${item.user_id}`);
      setOrgs((prev) => (prev ? [...prev, item] : [item]));
      setSuggestions((prev) => prev.filter((s) => s.user_id !== item.user_id));
      toast.success(`Following ${item.name || "member"}`);
    } catch {
      toast.error("Couldn't follow");
    } finally {
      setBusyId(null);
    }
  };
  const dismissSuggestion = async (item: Org) => {
    setSuggestions((prev) => prev.filter((s) => s.user_id !== item.user_id));
    try { await api.post(`/follows/suggestions/${item.user_id}/dismiss`); } catch { /* ignore */ }
  };

  const unfollow = async (item: Org) => {
    setBusyId(item.user_id);
    try {
      await api.del(`/follows/${item.user_id}`);
      setOrgs((prev) => (prev ? prev.filter((o) => o.user_id !== item.user_id) : prev));
      toast.success(`Unfollowed ${item.name || "member"}`);
    } catch {
      toast.error("Couldn't unfollow");
    } finally {
      setBusyId(null);
    }
  };

  const ql = q.trim().toLowerCase();
  const match = (o: Org) => !ql || (o.name || "").toLowerCase().includes(ql) || (o.handle || "").toLowerCase().includes(ql);
  const people = (orgs || []).filter((o) => !ORG_TYPES.has(o.account_type || "")).filter(match);
  const organizations = (orgs || []).filter((o) => ORG_TYPES.has(o.account_type || "")).filter(match);

  const renderRow = (item: Org) => (
    <View testID={`following-row-${item.user_id}`} style={[styles.row, { borderColor: colors.border }]}>
      <Avatar uri={item.picture || item.avatar} name={item.name} size={44} />
      <View style={{ flex: 1 }}>
        <Pressable onPress={() => item.handle && go(`/u/${item.handle}`)}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ color: colors.onSurface, fontWeight: "700" }} numberOfLines={1}>{item.name || "Member"}</Text>
            {item.partner_badge ? <Icon name="flag" size={14} color={item.partner_badge === "founding" ? colors.accent : colors.teal} footprint={14} /> : null}
          </View>
          {item.handle ? <Text style={{ color: colors.muted, fontSize: 12.5 }}>@{item.handle}</Text> : null}
        </Pressable>
      </View>
      <Pressable testID={`unfollow-${item.user_id}`} onPress={() => unfollow(item)} disabled={busyId === item.user_id}
        style={[styles.unfollowBtn, { borderColor: colors.border }]}>
        <Text style={{ color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: 12.5 }}>{busyId === item.user_id ? "…" : "Unfollow"}</Text>
      </Pressable>
    </View>
  );

  const followedIds = new Set((orgs || []).map((o) => o.user_id));
  const suggestVisible = suggestions.filter((s) => !followedIds.has(s.user_id));
  const showSuggest = orgs != null && orgs.length < 5 && suggestVisible.length > 0;
  const renderSuggestions = () => (
    <View testID="follow-suggestions" style={{ marginTop: 8, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
      <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "800", letterSpacing: 1, marginBottom: 10 }}>SUGGESTED FOR YOU</Text>
      {suggestVisible.map((s) => (
        <View key={s.user_id} testID={`suggestion-${s.user_id}`} style={[styles.row, { borderColor: colors.border }]}>
          <Avatar uri={s.picture || s.avatar} name={s.name} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.onSurface, fontWeight: "700" }} numberOfLines={1}>{s.name || "Member"}</Text>
            {(() => {
              const isOrg = ORG_TYPES.has(s.account_type || "") || !!s.partner_badge;
              const sub = s.reason || (isOrg ? "" : "Sailor");
              return sub ? <Text style={{ color: colors.teal, fontSize: 12.5 }} numberOfLines={1}>{sub}</Text> : null;
            })()}
          </View>
          <Pressable testID={`suggestion-follow-${s.user_id}`} onPress={() => followSuggestion(s)} disabled={busyId === s.user_id}
            style={[styles.followBtn, { backgroundColor: colors.teal, opacity: busyId === s.user_id ? 0.5 : 1 }]}>
            <Text style={{ color: colors.onBrandSecondary, fontWeight: "800", fontSize: 12.5 }}>Follow</Text>
          </Pressable>
          <Pressable testID={`suggestion-dismiss-${s.user_id}`} onPress={() => dismissSuggestion(s)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
            <Icon name="close" size={18} color={colors.muted} footprint={18} />
          </Pressable>
        </View>
      ))}
    </View>
  );

  const renderFollowers = () => (
    <View testID="followers-section" style={{ marginTop: 8, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
      <Text style={{ color: colors.onSurface, fontSize: 12, fontWeight: "800", letterSpacing: 1, marginBottom: 10 }}>YOUR FOLLOWERS ({followers.length})</Text>
      {followers.length === 0 ? (
        <Text testID="followers-empty" style={{ color: colors.muted, fontSize: 13 }}>No followers yet.</Text>
      ) : followers.map((f) => (
        <View key={f.user_id} testID={`follower-row-${f.user_id}`} style={[styles.row, { borderColor: colors.border }]}>
          <Avatar uri={f.picture || f.avatar} name={f.name} size={44} />
          <View style={{ flex: 1 }}><Text style={{ color: colors.onSurface, fontWeight: "700" }} numberOfLines={1}>{f.name || "Member"}</Text>
            {f.handle ? <Text style={{ color: colors.muted, fontSize: 12.5 }}>@{f.handle}</Text> : null}</View>
          <Pressable testID={`block-${f.user_id}`} onPress={() => blockUser(f)} disabled={busyId === f.user_id}
            style={[styles.unfollowBtn, { borderColor: colors.border, opacity: busyId === f.user_id ? 0.5 : 1 }]}>
            <Text style={{ color: colors.error, fontWeight: "700", fontSize: 12.5 }}>Block</Text>
          </Pressable>
        </View>
      ))}
      {blocked.length > 0 ? (
        <View testID="blocked-section" style={{ marginTop: 18 }}>
          <Text style={{ color: colors.error, fontSize: 12, fontWeight: "800", letterSpacing: 1, marginBottom: 10 }}>BLOCKED ({blocked.length})</Text>
          {blocked.map((b) => (
            <View key={b.user_id} testID={`blocked-row-${b.user_id}`} style={[styles.row, { borderColor: colors.border }]}>
              <Avatar uri={b.picture || b.avatar} name={b.name} size={40} />
              <View style={{ flex: 1 }}><Text style={{ color: colors.onSurfaceSecondary, fontWeight: "700" }} numberOfLines={1}>{b.name || "Member"}</Text></View>
              <Pressable testID={`unblock-${b.user_id}`} onPress={() => unblockUser(b)} disabled={busyId === b.user_id}
                style={[styles.followBtn, { backgroundColor: colors.surfaceSecondary, opacity: busyId === b.user_id ? 0.5 : 1 }]}>
                <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 12.5 }}>Unblock</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen title="Following" showBack padded={false}>
      {orgs == null ? (
        <Loading />
      ) : orgs.length === 0 ? (
        <FlatList
          data={[]}
          keyExtractor={(_, i) => String(i)}
          renderItem={null as any}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <>
              <EmptyState icon="people" title="Not following anyone yet" message="Follow people and organizations to see them here." />
              {showSuggest ? renderSuggestions() : null}
              {renderFollowers()}
            </>
          }
        />
      ) : (
        <FlatList
          data={[{ section: "People", items: people }, { section: "Organizations", items: organizations }]}
          keyExtractor={(s) => s.section}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <View style={[styles.searchWrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Icon name="search" size={16} color={colors.muted} footprint={16} />
              <TextInput testID="following-search" value={q} onChangeText={setQ}
                placeholder="Search by name or @username" placeholderTextColor={colors.muted}
                style={{ flex: 1, color: colors.onSurface, fontSize: 14.5, padding: 0 }} />
            </View>
          }
          ListFooterComponent={<>{showSuggest ? renderSuggestions() : null}{renderFollowers()}</>}
          renderItem={({ item: group }) => (
            <View style={{ marginBottom: 22 }}>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1, marginBottom: 6 }}>
                {group.section.toUpperCase()} ({group.items.length})
              </Text>
              {group.items.length === 0
                ? <Text style={{ color: colors.muted, fontSize: 13, paddingVertical: 6 }}>None yet.</Text>
                : group.items.map((it) => <View key={it.user_id}>{renderRow(it)}</View>)}
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 },
  unfollowBtn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  followBtn: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
});
