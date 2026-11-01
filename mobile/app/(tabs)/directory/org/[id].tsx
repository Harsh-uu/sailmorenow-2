import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { api } from "@/src/lib/api";
import { Avatar, Button, Loading } from "@/src/components/ui";
import { PartnerBadge } from "@/src/components/partner";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";

import { useTheme } from "@/src/theme";
import { Screen } from "@/src/components/Screen";
import { fmtDateTime, eventTitleParts } from "@/src/lib/format";

type Activity = { kind: string; id: string; title?: string; body?: string; when?: string; market?: string; location?: string; post_type?: string; time_not_listed?: boolean | null };
type Data = { org: any; following: boolean; follower_count: number; upcoming_events: number; recent_posts: number; activity: Activity[] };

export default function OrgActivity() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, b] = await Promise.all([
        api.get<Data>(`/follows/${id}/activity`),
        api.get<{ blocked: { user_id: string }[] }>("/follows/blocked").catch(() => ({ blocked: [] })),
      ]);
      setData(d);
      setBlocked((b.blocked || []).some((x) => x.user_id === id));
    } catch { /* noop */ }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const toggle = async () => {
    if (!user) { toast.warning("Sign in to follow"); return; }
    if (!data) return;
    setBusy(true);
    try {
      if (data.following) { await api.del(`/follows/${id}`); setData({ ...data, following: false, follower_count: Math.max(0, data.follower_count - 1) }); }
      else { await api.post(`/follows/${id}`); setData({ ...data, following: true, follower_count: data.follower_count + 1 }); toast.success(`Following ${data.org?.name}`); }
    } catch { toast.error("Couldn't update follow"); } finally { setBusy(false); }
  };

  const doBlock = async (next: boolean) => {
    setBlockBusy(true);
    try {
      if (next) {
        await api.post(`/follows/block/${id}`);
        setBlocked(true);
        if (data) setData({ ...data, following: false, follower_count: data.following ? Math.max(0, data.follower_count - 1) : data.follower_count });
        toast.success("Blocked");
      } else {
        await api.del(`/follows/block/${id}`);
        setBlocked(false);
        toast.success("Unblocked");
      }
    } catch { toast.error("Couldn't update"); } finally { setBlockBusy(false); }
  };

  const toggleBlock = () => {
    if (!user) { toast.warning("Sign in first"); return; }
    if (blockBusy) return;
    if (blocked) { doBlock(false); return; }
    Alert.alert("Block this organization?", "They won't be able to follow or message you, and you'll stop following them.", [
      { text: "Cancel", style: "cancel" },
      { text: "Block", style: "destructive", onPress: () => doBlock(true) },
    ]);
  };

  if (!data) return <Screen title="Organization" showBack><Loading /></Screen>;
  const org = data.org || {};

  return (
    <Screen title={org.name || "Organization"} showBack padded={false}>
      <FlatList
        testID="org-activity-list"
        data={data.activity}
        keyExtractor={(a) => `${a.kind}-${a.id}`}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListHeaderComponent={
          <View style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Avatar uri={org.picture || org.avatar} name={org.name} size={56} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 18 }}>{org.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12.5 }}>{data.follower_count} follower{data.follower_count === 1 ? "" : "s"} · {data.upcoming_events} upcoming · {data.recent_posts} posts</Text>
                {org.partner_badge ? <View style={{ marginTop: 5, alignSelf: "flex-start" }}><PartnerBadge kind={org.partner_badge} /></View> : null}
              </View>
            </View>
            {org.bio ? <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, marginTop: 12 }}>{org.bio}</Text> : null}
            <View style={{ marginTop: 14 }}>
              <Button title={data.following ? "✓ Following" : "Follow"} variant={data.following ? "secondary" : "primary"} onPress={toggle} disabled={busy} testID={`org-follow-${id}`} />
            </View>
            {user && user.user_id !== id ? (
              <Pressable testID={blocked ? `org-unblock-${id}` : `org-block-${id}`} onPress={toggleBlock} disabled={blockBusy}
                style={{ alignSelf: "flex-start", marginTop: 12, paddingVertical: 4, opacity: blockBusy ? 0.5 : 1 }}>
                <Text style={{ color: colors.muted, fontSize: 13, textDecorationLine: "underline" }}>{blocked ? "Unblock this organization" : "Block this organization"}</Text>
              </Pressable>
            ) : null}
            <Text style={{ color: colors.muted, fontWeight: "800", fontSize: 11, letterSpacing: 1, marginTop: 20 }}>ACTIVITY</Text>
          </View>
        }
        ListEmptyComponent={<Text style={{ color: colors.muted, textAlign: "center", paddingVertical: 30 }}>No recent activity yet.</Text>}
        renderItem={({ item }) => (
          <Pressable
            testID={`org-activity-${item.kind}-${item.id}`}
            onPress={() => item.kind === "event" ? router.push(`/directory/events/${item.id}` as any) : router.push("/(tabs)/feed")}
            style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" }}>
              <Icon name={item.kind === "event" ? "events" : "messages-square"} size={16} color={colors.teal} footprint={16} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }}>{item.kind === "event" ? "Event" : item.post_type || "Post"}</Text>
              <Text style={{ color: colors.onSurface, fontWeight: "700" }} numberOfLines={1}>{item.kind === "event" ? eventTitleParts(item.title).title || "(untitled)" : (item.title || "(untitled)")}</Text>
              {item.kind === "event" ? (
                <Text style={{ color: colors.muted, fontSize: 12.5 }} numberOfLines={1}>{item.when ? fmtDateTime(item.when, item.time_not_listed) : ""}{item.location ? ` · ${item.location}` : ""}</Text>
              ) : item.body ? (
                <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13 }} numberOfLines={2}>{item.body}</Text>
              ) : null}
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start", borderWidth: 1, borderRadius: 14, padding: 12 },
});
