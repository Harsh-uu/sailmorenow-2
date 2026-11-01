import { useCallback, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";

import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { Button, Badge, EmptyState, Loading } from "@/src/components/ui";
import { useTheme } from "@/src/theme";

function MonthDelta({ arr, colors }: { arr: any[]; colors: any }) {
  const [open, setOpen] = useState(false);
  if (!arr || arr.length < 2) return null;
  const d = arr[arr.length - 1].count - arr[arr.length - 2].count;
  const up = d > 0;
  const c = d === 0 ? colors.muted : up ? "#10B981" : "#EF4444";
  return (
    <View style={{ alignItems: "center", marginTop: 3 }}>
      <Pressable onPress={() => setOpen((o) => !o)} testID="compare-toggle" style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
        {d !== 0 ? <Icon name={up ? "arrow-up" : "arrow-down"} size={11} color={c}  footprint={11}/> : null}
        <Text style={{ fontSize: 10.5, fontWeight: "700", color: c }}>{d === 0 ? "no change" : `${Math.abs(d)} vs last mo`}</Text>
      </Pressable>
      {open ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 5, marginTop: 4 }} testID="compare-breakdown">
          {arr.map((b, i) => (<Text key={i} style={{ fontSize: 9.5, color: colors.muted }}>{b.month} {b.count}</Text>))}
        </View>
      ) : null}
    </View>
  );
}

export default function MyListing() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [pro, setPro] = useState<any | undefined>(undefined); // undefined = loading, null = none yet
  const [insights, setInsights] = useState<any | null>(null);
  const [months, setMonths] = useState(6);

  const load = useCallback(() => {
    api.get("/boat-pros/mine").then((d) => setPro(d)).catch(() => setPro(null));
    api.get(`/boat-pros/insights?months=${months}`).then((d) => setInsights(d)).catch(() => setInsights(null));
  }, [months]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const tier = pro?.tier || user?.subscription_tier || "basic";
  const isPremium = tier === "premium";
  const checks = pro
    ? [!!pro.company_name, !!pro.short_bio, (pro.categories || []).length > 0, (pro.markets || []).length > 0, ...(isPremium ? [(pro.photos || []).length >= 3] : [])]
    : [];
  const done = checks.filter(Boolean).length;
  const pct = checks.length ? Math.round((done / checks.length) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.brandPrimary }}>
        <View style={styles.header}>
          <Text style={[styles.hTitle, { color: colors.onBrandPrimary }]}>My Listing</Text>
        </View>
      </SafeAreaView>

      {pro === undefined ? (
        <Loading />
      ) : pro === null ? (
        <View style={{ padding: 24, paddingTop: 60 }}>
          <EmptyState icon="briefcase-outline" title="No listing yet" subtitle="Create your Boat Pro listing so owners across the PNW can find and hire you." />
          <Button title="Create my listing" icon="add-outline" onPress={() => router.push("/profile/pro-edit")} testID="create-listing-btn" style={{ marginTop: 16 }} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={[styles.meter, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="completeness-meter">
            <View style={styles.meterTop}>
              <Text style={[styles.meterLbl, { color: colors.onSurface }]}>Profile completeness</Text>
              <Text style={[styles.meterPct, { color: colors.accent }]} testID="completeness-pct">{pct}%</Text>
            </View>
            <View style={[styles.meterTrack, { backgroundColor: colors.surfaceSecondary }]}>
              <View style={[styles.meterFill, { width: `${pct}%`, backgroundColor: colors.teal }]} />
            </View>
            <View style={{ marginTop: 12 }}>
              {[
                { label: "Company name", done: !!pro.company_name, focus: "company" },
                { label: "Short bio", done: !!pro.short_bio, focus: "bio" },
                { label: "At least one specialty", done: (pro.categories || []).length > 0, focus: "categories" },
                { label: "At least one market", done: (pro.markets || []).length > 0, focus: "markets" },
                ...(isPremium ? [{ label: "Three or more photos", done: (pro.photos || []).length >= 3, focus: "photos" }] : []),
              ].map((c) => (
                <Pressable key={c.label} disabled={c.done} onPress={() => router.push({ pathname: "/profile/pro-edit", params: { focus: c.focus } })} testID={c.done ? "check-done" : "check-missing"} style={styles.checkRow}>
                  <Icon name={c.done ? "checkmark-circle" : "ellipse-outline"} size={18} color={c.done ? "#10B981" : colors.accent}  footprint={18}/>
                  <Text style={[styles.checkLbl, { color: c.done ? colors.muted : colors.onSurface, textDecorationLine: c.done ? "line-through" : "none" }]}>{c.label}</Text>
                  {!c.done ? <Icon name="chevron-forward" size={16} color={colors.muted}  footprint={16}/> : null}
                </Pressable>
              ))}
              {!isPremium ? (
                <Pressable onPress={() => router.push("/pricing")} testID="photos-locked-row" style={styles.checkRow}>
                  <Icon name="lock-closed" size={18} color={colors.muted} footprint={18} />
                  <Text style={[styles.checkLbl, { color: colors.muted }]}>Photos — upgrade to Premium</Text>
                  <Icon name="rocket-outline" size={16} color={colors.accent} footprint={16} />
                </Pressable>
              ) : null}
            </View>
          </View>
          {insights ? (
            <View style={[styles.insights, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="listing-insights">
              <View style={styles.insCol}>
                <Text style={[styles.insNum, { color: colors.teal }]}>{insights.views_this_month}</Text>
                <Text style={[styles.insLbl, { color: colors.onSurfaceSecondary }]}>Views this month</Text>
                <MonthDelta arr={insights.views_by_month} colors={colors} />
              </View>
              <View style={[styles.insDiv, { backgroundColor: colors.border }]} />
              <View style={styles.insCol}>
                <Text style={[styles.insNum, { color: colors.accent }]}>{insights.contacts_this_month}</Text>
                <Text style={[styles.insLbl, { color: colors.onSurfaceSecondary }]}>People contacted you</Text>
                <MonthDelta arr={insights.contacts_by_month} colors={colors} />
              </View>
            </View>
          ) : null}
          {insights ? (
            <View style={styles.rangeRow}>
              {[6, 12].map((m) => (
                <Pressable key={m} testID={`range-${m}`} onPress={() => setMonths(m)} style={[styles.rangeBtn, { backgroundColor: months === m ? colors.teal : colors.surface, borderColor: colors.border }]}>
                  <Text style={{ color: months === m ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontWeight: "700", fontSize: 12.5 }}>{m}M</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {insights?.views_by_month?.length ? (
            <View style={[styles.trend, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="views-trend">
              <Text style={[styles.trendTitle, { color: colors.onSurfaceSecondary }]}>Views · last {months} months</Text>
              <View style={styles.bars}>
                {insights.views_by_month.map((b: any, i: number) => {
                  const max = Math.max(1, ...insights.views_by_month.map((x: any) => x.count));
                  return (
                    <View key={i} style={styles.barCol}>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { height: `${Math.round((b.count / max) * 100)}%`, backgroundColor: colors.teal }]} />
                      </View>
                      <Text style={[styles.barLbl, { color: colors.muted }]}>{b.month}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
          {insights?.contacts_by_month?.length ? (
            <View style={[styles.trend, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="contacts-trend">
              <Text style={[styles.trendTitle, { color: colors.onSurfaceSecondary }]}>Contacts · last {months} months</Text>
              <View style={styles.bars}>
                {insights.contacts_by_month.map((b: any, i: number) => {
                  const max = Math.max(1, ...insights.contacts_by_month.map((x: any) => x.count));
                  return (
                    <View key={i} style={styles.barCol}>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { height: `${Math.round((b.count / max) * 100)}%`, backgroundColor: colors.accent }]} />
                      </View>
                      <Text style={[styles.barLbl, { color: colors.muted }]}>{b.month}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.company, { color: colors.onSurface }]} numberOfLines={2}>{pro.company_name}</Text>
              <Badge label={String(tier).toUpperCase()} tone="accent" />
            </View>
            {pro.short_bio ? <Text style={[styles.bio, { color: colors.onSurfaceSecondary }]}>{pro.short_bio}</Text> : null}
            <View style={styles.metaRow}>
              <Icon name="pricetags-outline" size={15} color={colors.teal}  footprint={15}/>
              <Text style={[styles.meta, { color: colors.onSurfaceSecondary }]}>{(pro.categories || []).join(", ") || "No specialties yet"}</Text>
            </View>
            <View style={styles.metaRow}>
              <Icon name="location-outline" size={15} color={colors.teal}  footprint={15}/>
              <Text style={[styles.meta, { color: colors.onSurfaceSecondary }]}>{(pro.markets || []).join(", ") || "No markets yet"}</Text>
            </View>
            <View style={styles.metaRow}>
              <Icon name="images-outline" size={15} color={colors.teal}  footprint={15}/>
              <Text style={[styles.meta, { color: colors.onSurfaceSecondary }]}>{isPremium ? `${(pro.photos || []).length} photos` : "Photos — Premium only"}</Text>
            </View>
          </View>

          <Button title="Edit listing" icon="create-outline" onPress={() => router.push("/profile/pro-edit")} testID="edit-listing-btn" style={{ marginTop: 14 }} />
          <Button title="Edit card & photos" variant="secondary" icon="images-outline" onPress={() => router.push("/profile/boat-pro-listing")} testID="edit-pro-card-btn" style={{ marginTop: 10 }} />
          <Button title={tier === "premium" ? "Manage plan" : "Upgrade plan"} variant="secondary" icon="rocket-outline" onPress={() => router.push("/pricing")} testID="upgrade-listing-btn" style={{ marginTop: 10 }} />
          {user?.handle ? (
            <Button title="View public page" variant="secondary" icon="open-outline" onPress={() => router.push(`/profile/u/${user.handle}` as any)} testID="view-public-btn" style={{ marginTop: 10 }} />
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { height: 52, justifyContent: "center", paddingHorizontal: 16 },
  hTitle: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  company: { fontSize: 19, fontWeight: "800", flex: 1, letterSpacing: -0.3 },
  bio: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  meta: { fontSize: 13.5, flex: 1 },
  insights: { flexDirection: "row", alignItems: "center", borderRadius: 18, borderWidth: 1, paddingVertical: 16, marginBottom: 14 },
  insCol: { flex: 1, alignItems: "center" },
  insNum: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  insLbl: { fontSize: 11.5, fontWeight: "600", marginTop: 3 },
  insDiv: { width: 1, alignSelf: "stretch", marginVertical: 6 },
  trend: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 14 },
  trendTitle: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  bars: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", height: 64 },
  barCol: { flex: 1, alignItems: "center" },
  barTrack: { width: 14, height: 44, justifyContent: "flex-end", borderRadius: 4, overflow: "hidden" },
  barFill: { width: "100%", minHeight: 3, borderRadius: 4 },
  barLbl: { fontSize: 10, fontWeight: "600", marginTop: 5 },
  nudge: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FEF3C7", borderColor: "#FCD34D", borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 },
  nudgeText: { flex: 1, fontSize: 13, lineHeight: 18, color: "#92400E", fontWeight: "600" },
  meter: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 14 },
  meterTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  meterLbl: { fontSize: 14, fontWeight: "700" },
  meterPct: { fontSize: 16, fontWeight: "800" },
  meterTrack: { height: 9, borderRadius: 999, overflow: "hidden" },
  meterFill: { height: "100%", borderRadius: 999 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7 },
  checkLbl: { flex: 1, fontSize: 14, fontWeight: "600" },
  rangeRow: { flexDirection: "row", justifyContent: "flex-end", gap: 6, marginBottom: 12 },
  rangeBtn: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
});
