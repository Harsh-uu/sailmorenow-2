import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Alert, DeviceEventEmitter, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { KeyboardFormBody, useKbField } from "@/src/components/KeyboardFormScreen";
import { Badge, Button, EmptyState, Loading } from "@/src/components/ui";
import { api, ApiError } from "@/src/lib/api";
import { ADMIN_SUPPORT_CHANGED, ADMIN_FAQS_CHANGED } from "@/src/lib/events";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";
import { fmtTimeAgo, fmtDate } from "@/src/lib/format";

const TABS = [
  { key: "overview", label: "Overview", icon: "stats-chart-outline" },
  { key: "reports", label: "Reports", icon: "flag-outline" },
  { key: "support", label: "Support", icon: "chatbubbles-outline" },
  { key: "approvals", label: "Approvals", icon: "checkmark-done-outline" },
  { key: "testimonials", label: "Testimonials", icon: "star-outline" },
  { key: "faqs", label: "FAQ", icon: "help-circle-outline" },
  { key: "bans", label: "IP Bans", icon: "ban-outline" },
] as const;

export default function Admin() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<string>(TABS.some((t) => t.key === tabParam) ? (tabParam as string) : "overview");

  if (loading) return <Loading />;
  if (user && user.platform_role !== "admin") return <Redirect href="/(tabs)/profile" />;
  if (!user) return <Redirect href="/" />;

  return (
    <Screen title="Admin" showBack padded={false}>
      <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.tabs}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              testID={`admin-tab-${t.key}`}
              onPress={() => setTab(t.key)}
              style={[styles.tab, { backgroundColor: tab === t.key ? colors.brandPrimary : colors.surface, borderColor: tab === t.key ? colors.brandPrimary : colors.border }]}
            >
              <Icon name={t.icon as any} size={15} color={tab === t.key ? colors.onBrandPrimary : colors.muted}  footprint={15}/>
              <Text style={{ color: tab === t.key ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontWeight: "700", fontSize: 13 }}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={{ flex: 1 }}>
          {tab === "overview" && <Overview />}
          {tab === "reports" && <Reports />}
          {tab === "support" && <Support />}
          {tab === "approvals" && <Approvals />}
          {tab === "testimonials" && <Testimonials />}
          {tab === "faqs" && <Faqs />}
          {tab === "bans" && <Bans />}
        </View>
      </View>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.statValue, { color: colors.onSurface }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

function Overview() {
  const { colors } = useTheme();
  const [data, setData] = useState<any>(null);
  const [refer, setRefer] = useState<any>(null);
  const [rev, setRev] = useState<any>(null);
  const [sync, setSync] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api.get("/admin/analytics")); } catch { setData({}); }
    try { setRefer(await api.get("/admin/referrals")); } catch { setRefer({ top: [], recent: [] }); }
    try { setRev(await api.get("/admin/revenue")); } catch { setRev(null); }
    try { setSync(await api.get("/admin/events/sync-status")); } catch { setSync(null); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const resync = async () => {
    setSyncing(true);
    try { await api.post("/admin/events/aggregate", {}); setSync(await api.get("/admin/events/sync-status")); } catch { /* noop */ }
    finally { setSyncing(false); }
  };
  if (!data) return <Loading />;
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}>
      <View style={styles.grid}>
        <Stat label="Members" value={data.users?.total ?? "—"} />
        <Stat label="Active (7d)" value={data.users?.active_last_7d ?? "—"} />
        <Stat label="Verified" value={data.users?.verified ?? "—"} />
        <Stat label="Posts" value={data.posts?.total ?? "—"} />
        <Stat label="Posts (7d)" value={data.posts?.last_7d ?? "—"} />
        <Stat label="Events" value={data.events?.total ?? "—"} />
        <Stat label="Upcoming" value={data.events?.upcoming ?? "—"} />
        <Stat label="Comments" value={data.comments?.total ?? "—"} />
        <Stat label="Open reports" value={data.reports?.open ?? "—"} />
        <Stat label="Pending posts" value={data.discussions?.pending ?? "—"} />
        <Stat label="Referred signups" value={refer?.total ?? "—"} />
      </View>
      <Text style={[styles.sub, { color: colors.muted }]}>As of {fmtTimeAgo(data.as_of)}</Text>

      <View testID="admin-sync-card" style={{ marginTop: 18, borderRadius: 18, padding: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="calendar-outline" size={16} color={colors.teal} footprint={16} />
          <Text style={{ color: colors.muted, fontWeight: "800", fontSize: 11, letterSpacing: 1 }}>CALENDAR FRESHNESS</Text>
        </View>
        <Text style={{ color: colors.onSurface, marginTop: 8, fontSize: 13.5 }} testID="sync-last">
          Last synced {sync?.last_run_at ? fmtTimeAgo(sync.last_run_at) : "—"}
        </Text>
        <Text style={{ color: colors.onSurfaceSecondary, marginTop: 2, fontSize: 13 }} testID="sync-next">
          Next auto-sync {sync?.next_run_at ? fmtTimeAgo(sync.next_run_at) : "—"}
        </Text>
        <Pressable testID="sync-now-btn" onPress={resync} disabled={syncing}
          style={{ marginTop: 12, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brandPrimary, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, opacity: syncing ? 0.6 : 1 }}>
          <Icon name="refresh-outline" size={15} color={colors.onBrandPrimary} footprint={15} />
          <Text style={{ color: colors.onBrandPrimary, fontWeight: "700", fontSize: 13 }}>{syncing ? "Syncing…" : "Re-sync now"}</Text>
        </Pressable>
      </View>

      {rev && (
        <View testID="admin-revenue" style={{ marginTop: 22, borderRadius: 18, padding: 18, backgroundColor: colors.brandPrimary }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="trending-up" size={18} color="#F2A03B" footprint={18} />
            <Text style={{ color: colors.onBrandPrimary, opacity: 0.8, fontWeight: "800", fontSize: 11, letterSpacing: 1 }}>REVENUE SNAPSHOT</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 14 }}>
            {[
              { k: "MRR", v: `$${(rev.mrr_total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, t: "rev-mrr" },
              { k: "ARR", v: `$${(rev.arr_total ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, t: "rev-arr" },
              { k: "Active paid", v: String(rev.active_paid ?? 0), t: "rev-active" },
              { k: "Members", v: String(rev.total_users ?? 0), t: "rev-total" },
            ].map((s) => (
              <View key={s.k} style={{ width: "50%", marginBottom: 12 }}>
                <Text testID={s.t} style={{ color: colors.onBrandPrimary, fontWeight: "800", fontSize: 24 }}>{s.v}</Text>
                <Text style={{ color: colors.onBrandPrimary, opacity: 0.6, fontSize: 12 }}>{s.k}</Text>
              </View>
            ))}
          </View>
          {rev.trend && rev.trend.length > 1 ? (
            <View testID="revenue-trend" style={{ marginTop: 6, marginBottom: 12 }}>
              <Text style={{ color: colors.onBrandPrimary, opacity: 0.5, fontWeight: "800", fontSize: 10, letterSpacing: 1, marginBottom: 8 }}>COLLECTED · LAST 6 MONTHS</Text>
              <View style={{ flexDirection: "row", alignItems: "flex-end", height: 54, gap: 6 }}>
                {(() => { const max = Math.max(1, ...rev.trend.map((t: any) => t.amount)); return rev.trend.map((t: any, i: number) => (
                  <View key={i} style={{ flex: 1, alignItems: "center" }}>
                    <View style={{ width: "70%", height: Math.max(3, (t.amount / max) * 44), backgroundColor: "#F2A03B", borderRadius: 3 }} />
                    <Text style={{ color: colors.onBrandPrimary, opacity: 0.5, fontSize: 9, marginTop: 4 }}>{t.label}</Text>
                  </View>
                )); })()}
              </View>
            </View>
          ) : null}
          {(rev.by_tier || []).map((t: any) => (
            <View key={`${t.account_type}-${t.tier}`} testID={`rev-tier-${t.account_type}-${t.tier}`}
              style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.15)" }}>
              <Text style={{ color: colors.onBrandPrimary, opacity: 0.85, fontSize: 13, textTransform: "capitalize" }}>{t.account_type.replace(/_/g, " ")} · {t.tier.replace(/_/g, " ")} × {t.count}</Text>
              <Text style={{ color: colors.onBrandPrimary, fontWeight: "700", fontSize: 13 }}>${(t.mrr ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo</Text>
            </View>
          ))}
        </View>
      )}

      {refer && (refer.top?.length || refer.recent?.length) ? (
        <View testID="admin-referrals" style={{ marginTop: 22 }}>
          <Text style={[styles.h, { color: colors.onSurface }]}>Top referrers</Text>
          {(refer.top || []).slice(0, 8).map((r: any, i: number) => (
            <View key={i} style={[styles.refRow, { borderColor: colors.border }]}>
              <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{r.referrer_name || r.ref}</Text>
              <Text style={{ color: colors.teal, fontWeight: "800" }}>{r.count}</Text>
            </View>
          ))}
          <Text style={[styles.h, { color: colors.onSurface, marginTop: 18 }]}>Recent referred members</Text>
          {(refer.recent || []).slice(0, 12).map((r: any, i: number) => (
            <View key={i} style={[styles.refRow, { borderColor: colors.border }]}>
              <Text style={{ color: colors.onSurface }} numberOfLines={1}>{r.referred_name}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>via {r.referrer_name || r.ref}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function Reports() {
  const { colors } = useTheme();
  const [items, setItems] = useState<any[] | null>(null);
  const load = useCallback(async () => {
    try { const d = await api.get("/admin/reports?status=open"); setItems(d.reports || []); } catch { setItems([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const act = async (id: string, status: string, del = false) => {
    try { await api.patch(`/admin/reports/${id}`, { status, delete_target: del }); setItems((p) => p!.filter((r) => r.id !== id)); }
    catch (e) { Alert.alert("Error", e instanceof ApiError ? e.message : "Failed"); }
  };
  if (!items) return <Loading />;
  const openTarget = (item: any) => {
    const t = item.target_type;
    if (t === "discussion") router.push(`/hub/${item.target_id}` as any);
    else if (t === "post") router.push(`/post/${item.target_id}` as any);
    else if (t === "event") router.push(`/events/${item.target_id}` as any);
  };
  return (
    <FlatList
      data={items}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: 16 }}
      ListEmptyComponent={<View style={{ paddingTop: 60 }}><EmptyState icon="shield-checkmark-outline" title="No open reports" subtitle="The moderation queue is clear." /></View>}
      renderItem={({ item }) => {
        const fullText = [item.target?.title, item.target?.body].filter(Boolean).join("\n\n") || "[deleted target]";
        const canOpen = item.target && ["discussion", "post", "event"].includes(item.target_type);
        return (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
            <Badge label={item.target_type} tone="muted" />
            <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtTimeAgo(item.created_at)}</Text>
          </View>
          {item.target_type === "comment" ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }} testID={`report-parent-${item.id}`}>
              {item.parent_title ? `On ${item.parent_type || "discussion"}: ${item.parent_title}` : "Comment text only (parent not found)"}
            </Text>
          ) : null}
          <Text style={{ color: colors.onSurface, fontWeight: "600", fontSize: 14 }} testID={`report-body-${item.id}`}>
            {fullText}
          </Text>
          <Text style={{ color: colors.error, fontSize: 13, marginTop: 6 }}>Reason: {item.reason}</Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {item.category ? <Badge label={item.category} tone={item.category === "inappropriate" ? "accent" : "teal"} /> : null}
            {item.target?.hidden_pending_review ? <Badge label="Hidden" tone="muted" /> : null}
          </View>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
            by {item.reporter_name || "member"}
            {item.target?.market !== undefined ? ` · ${item.target?.market || "All markets"}` : ""}
            {item.target?.created_at ? ` · posted ${fmtDate(item.target.created_at)}` : ""}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {canOpen ? <Button title="Open" variant="secondary" icon="open-outline" onPress={() => openTarget(item)} style={{ width: "47%", height: 44 }} testID={`report-open-${item.id}`} /> : null}
            <Button title="Dismiss" variant="ghost" onPress={() => act(item.id, "dismissed")} style={{ width: "47%", height: 44 }} testID={`report-dismiss-${item.id}`} />
            <Button title="Resolve" variant="secondary" onPress={() => act(item.id, "resolved")} style={{ width: "47%", height: 44 }} testID={`report-resolve-${item.id}`} />
            <Button title="Delete" variant="danger" onPress={() => Alert.alert("Delete content?", "This removes the reported item.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => act(item.id, "resolved", true) }])} style={{ width: "47%", height: 44 }} testID={`report-delete-${item.id}`} />
          </View>
        </View>
        );
      }}
    />
  );
}

function Support() {
  const { colors } = useTheme();
  const [data, setData] = useState<any>(null);
  const [filter, setFilter] = useState<string>("all");
  const load = useCallback(async () => {
    try { setData(await api.get("/admin/contact")); } catch { setData({ messages: [] }); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(ADMIN_SUPPORT_CHANGED, () => load());
    return () => sub.remove();
  }, [load]);
  if (!data) return <Loading />;
  const all: any[] = data.messages || [];
  const messages = filter === "support" ? all.filter((m) => m.source === "profile_support")
    : filter === "public" ? all.filter((m) => m.source !== "profile_support") : all;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
        {[["all", "All"], ["support", "From Profile"], ["public", "Public site"]].map(([k, lbl]) => (
          <Pressable key={k} testID={`support-filter-${k}`} onPress={() => setFilter(k)}
            style={{ borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6,
                     backgroundColor: filter === k ? colors.brandPrimary : colors.surface, borderColor: filter === k ? colors.brandPrimary : colors.border }}>
            <Text style={{ color: filter === k ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontWeight: "700", fontSize: 12.5 }}>{lbl}</Text>
          </Pressable>
        ))}
      </View>
      {messages.length === 0 ? (
        <View style={{ paddingTop: 40 }}><EmptyState icon="chatbubbles-outline" title="No messages" subtitle="Contact submissions land here." /></View>
      ) : messages.map((m) => (
        <View key={m.id} testID={`support-msg-${m.id}`} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{m.name}</Text>
            <Badge label={m.source === "profile_support" ? "Profile" : "Public"} tone={m.source === "profile_support" ? "teal" : "muted"} />
          </View>
          {m.subject ? <Text style={{ color: colors.teal, fontWeight: "700", fontSize: 12.5, marginBottom: 2 }}>{m.subject}</Text> : null}
          <Text style={{ color: colors.muted, fontSize: 12 }}>{m.email} · {fmtTimeAgo(m.created_at)}</Text>
          <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, marginTop: 8 }}>{m.message}</Text>
          {Array.isArray(m.replies) && m.replies.length > 0 ? (
            <View style={{ marginTop: 10, gap: 6 }}>
              {m.replies.map((r: any, i: number) => (
                <View key={i} style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 10, padding: 10 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800", marginBottom: 2 }}>REPLIED {fmtTimeAgo(r.created_at)}</Text>
                  <Text style={{ color: colors.onSurface, fontSize: 13 }}>{r.body}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Button title="Reply" variant="secondary" icon="send" onPress={() => router.push({ pathname: "/admin-reply", params: { id: m.id, name: m.name || "" } } as any)} style={{ marginTop: 10, height: 40 }} testID={`support-reply-${m.id}`} />
        </View>
      ))}
    </ScrollView>
  );
}


function Approvals() {
  const { colors } = useTheme();
  const [items, setItems] = useState<any[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const load = useCallback(async () => {
    try { setItems(await api.get("/discussions?status=pending")); } catch { setItems([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const approve = async (id: string) => {
    try { await api.post(`/discussions/${id}/approve`); setItems((p) => p!.filter((d) => d.id !== id)); }
    catch (e) { Alert.alert("Error", e instanceof ApiError ? e.message : "Failed"); }
  };
  if (!items) return <Loading />;
  return (
    <FlatList
      data={items}
      keyExtractor={(d) => d.id}
      contentContainerStyle={{ padding: 16 }}
      ListEmptyComponent={<View style={{ paddingTop: 60 }}><EmptyState icon="checkmark-done-outline" title="Nothing pending" subtitle="No blog or forum posts awaiting review." /></View>}
      renderItem={({ item }) => {
        const isOpen = !!expanded[item.id];
        return (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
            <Badge label={item.kind} tone="teal" />
            <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtTimeAgo(item.created_at)}</Text>
          </View>
          <Pressable testID={`approval-toggle-${item.id}`} onPress={() => setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }))}>
            <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 15 }}>{item.title}</Text>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 4 }} numberOfLines={isOpen ? undefined : 3}>{item.body}</Text>
            <Text style={{ color: colors.teal, fontSize: 12, fontWeight: "700", marginTop: 6 }}>{isOpen ? "Show less" : "Tap to read full draft"}</Text>
          </Pressable>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>by {item.author_name || "member"} · {item.market || "All markets"}</Text>
          <Button title="Approve & publish" variant="primary" icon="checkmark" onPress={() => approve(item.id)} style={{ marginTop: 12, height: 42 }} testID={`approve-${item.id}`} />
        </View>
        );
      }}
    />
  );
}

function Testimonials() {
  const { colors } = useTheme();
  const [filter, setFilter] = useState<string>("pending");
  const [items, setItems] = useState<any[] | null>(null);
  const load = useCallback(async (f: string) => {
    try { setItems(await api.get(`/admin/testimonials${f ? `?status=${f}` : ""}`)); } catch { setItems([]); }
  }, []);
  useFocusEffect(useCallback(() => { setItems(null); load(filter); }, [load, filter]));
  const act = async (id: string, status: string) => {
    try { await api.patch(`/admin/testimonials/${id}`, { status }); setItems((p) => p!.filter((t) => t.id !== id)); }
    catch (e) { Alert.alert("Error", e instanceof ApiError ? e.message : "Failed"); }
  };
  const del = async (id: string) => {
    Alert.alert("Delete testimonial?", "This removes it permanently.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.del(`/admin/testimonials/${id}`); setItems((p) => p!.filter((t) => t.id !== id)); }
        catch (e) { Alert.alert("Error", e instanceof ApiError ? e.message : "Failed"); }
      } },
    ]);
  };
  const FILTERS: [string, string][] = [["pending", "Pending"], ["approved", "Approved"], ["hidden", "Hidden"], ["", "All"]];
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {FILTERS.map(([k, lbl]) => (
          <Pressable key={k || "all"} testID={`admin-testimonial-filter-${k || "all"}`} onPress={() => setFilter(k)}
            style={{ borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6,
                     backgroundColor: filter === k ? colors.brandPrimary : colors.surface, borderColor: filter === k ? colors.brandPrimary : colors.border }}>
            <Text style={{ color: filter === k ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontWeight: "700", fontSize: 12.5 }}>{lbl}</Text>
          </Pressable>
        ))}
      </View>
      {!items ? <Loading /> : items.length === 0 ? (
        <View style={{ paddingTop: 40 }}><EmptyState icon="star-outline" title="Nothing here" subtitle="Member testimonials land here for review." /></View>
      ) : items.map((t) => (
        <View key={t.id} testID={`admin-testimonial-${t.id}`} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ color: colors.onSurface, fontSize: 14 }}>&ldquo;{t.quote}&rdquo;</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>
            {t.show_name ? t.display_name : "name hidden"}{[t.role, t.market].filter(Boolean).length ? ` · ${[t.role, t.market].filter(Boolean).join(" · ")}` : ""}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {t.status !== "approved" && <Button title="Approve" variant="primary" onPress={() => act(t.id, "approved")} style={{ width: "47%", height: 44 }} testID={`admin-testimonial-approve-${t.id}`} />}
            {t.status !== "hidden" && <Button title="Hide" variant="secondary" onPress={() => act(t.id, "hidden")} style={{ width: "47%", height: 44 }} testID={`admin-testimonial-hide-${t.id}`} />}
            <Button title="Delete" variant="danger" onPress={() => del(t.id)} style={{ width: "47%", height: 44 }} testID={`admin-testimonial-delete-${t.id}`} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Faqs() {
  const { colors } = useTheme();
  const [items, setItems] = useState<any[] | null>(null);
  const load = useCallback(async () => {
    try { setItems(await api.get("/admin/faqs")); } catch { setItems([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(ADMIN_FAQS_CHANGED, () => load());
    return () => sub.remove();
  }, [load]);
  const openEdit = (f: any) => router.push({ pathname: "/admin-faq-edit", params: { id: f.id, q: f.question, a: f.answer } } as any);
  const toggle = async (f: any) => {
    try { await api.patch(`/admin/faqs/${f.id}`, { active: !f.active }); await load(); }
    catch (e) { Alert.alert("Error", e instanceof ApiError ? e.message : "Failed"); }
  };
  const del = async (f: any) => {
    Alert.alert("Delete FAQ?", "", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api.del(`/admin/faqs/${f.id}`); setItems((p) => p!.filter((x) => x.id !== f.id)); }
        catch (e) { Alert.alert("Error", e instanceof ApiError ? e.message : "Failed"); }
      } },
    ]);
  };
  if (!items) return <Loading />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {items.map((f) => (
        <View key={f.id} testID={`admin-faq-${f.id}`} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ color: colors.teal, fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>{f.category.toUpperCase()}</Text>
          <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 14.5, marginTop: 4 }}>{f.question}{!f.active ? "  (hidden)" : ""}</Text>
          <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 4 }} numberOfLines={3}>{f.answer}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Button title={f.active ? "Hide" : "Show"} variant="ghost" onPress={() => toggle(f)} style={{ width: "47%", height: 44 }} testID={`admin-faq-toggle-${f.id}`} />
            <Button title="Edit" variant="secondary" onPress={() => openEdit(f)} style={{ width: "47%", height: 44 }} testID={`admin-faq-edit-${f.id}`} />
            <Button title="Delete" variant="danger" onPress={() => del(f)} style={{ width: "47%", height: 44 }} testID={`admin-faq-delete-${f.id}`} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Bans() {
  const { colors } = useTheme();
  const [items, setItems] = useState<any[] | null>(null);
  const [ip, setIp] = useState("");
  const [reason, setReason] = useState("");
  const kbIp = useKbField("ban-ip");
  const kbReason = useKbField("ban-reason");
  const load = useCallback(async () => {
    try { setItems(await api.get("/admin/ip-bans")); } catch { setItems([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const addBan = async () => {
    if (!ip.trim()) return;
    try { const b = await api.post("/admin/ip-bans", { ip: ip.trim(), reason: reason.trim() }); setItems((p) => [b, ...(p || [])]); setIp(""); setReason(""); }
    catch (e) { Alert.alert("Error", e instanceof ApiError ? e.message : "Failed"); }
  };
  const remove = async (bip: string) => {
    try { await api.del(`/admin/ip-bans/${encodeURIComponent(bip)}`); setItems((p) => p!.filter((b) => b.ip !== bip)); }
    catch (e) { Alert.alert("Error", e instanceof ApiError ? e.message : "Failed"); }
  };
  if (!items) return <Loading />;
  return (
    <KeyboardFormBody padded={false} contentContainerStyle={{ padding: 16 }}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={{ color: colors.onSurface, fontWeight: "700", marginBottom: 8 }}>Ban an IP</Text>
        <TextInput testID="ban-ip-input" value={ip} onChangeText={setIp} onFocus={kbIp.onFocus} placeholder="IP address" placeholderTextColor={colors.muted} autoCapitalize="none" style={[styles.input, { borderColor: colors.border, color: colors.onSurface }]} />
        <TextInput testID="ban-reason-input" value={reason} onChangeText={setReason} onFocus={kbReason.onFocus} placeholder="Reason (optional)" placeholderTextColor={colors.muted} style={[styles.input, { borderColor: colors.border, color: colors.onSurface, marginTop: 8 }]} />
        <Button title="Add ban" variant="danger" onPress={addBan} style={{ marginTop: 10, height: 42 }} testID="add-ban-btn" />
      </View>
      {items.length === 0 ? (
        <Text style={{ color: colors.muted, textAlign: "center", marginTop: 20 }}>No IPs are currently banned.</Text>
      ) : items.map((b) => (
        <View key={b.ip} style={[styles.banRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{b.ip}</Text>
            {b.reason ? <Text style={{ color: colors.muted, fontSize: 12 }}>{b.reason}</Text> : null}
          </View>
          <Button title="Unban" variant="ghost" onPress={() => remove(b.ip)} style={{ height: 36, paddingHorizontal: 12 }} testID={`unban-${b.ip}`} />
        </View>
      ))}
    </KeyboardFormBody>
  );
}

const styles = StyleSheet.create({
  tabs: { padding: 12, gap: 8 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, marginRight: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { width: "47%", borderRadius: 14, borderWidth: 1, padding: 14 },
  statValue: { fontSize: 24, fontWeight: "800" },
  statLabel: { fontSize: 12.5, marginTop: 2 },
  sub: { fontSize: 12, marginTop: 14, textAlign: "center" },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 15 },
  banRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 8 },
  h: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
  refRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 12 },
});
