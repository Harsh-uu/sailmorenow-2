import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { CrewListingPopup } from "@/src/components/CrewListingPopup";
import { Avatar, Badge, Button, EmptyState, Loading } from "@/src/components/ui";
import { MultiSelectPicker } from "@/src/components/MultiSelectPicker";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { canInteract } from "@/src/lib/plan";
import { useTheme } from "@/src/theme";
import { useMarketPref, setMarketPref, marketParam } from "@/src/lib/marketPref";
import { useToast } from "@/src/context/ToastContext";

export default function CrewBank() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const isPaid = canInteract(user);
  const openDM = (uid: string, name?: string) => {
    if (!isPaid) { toast.error("Upgrade to message"); router.push("/pricing"); return; }
    router.push({ pathname: "/messages/[id]", params: { id: uid, name: name || "Sailor" } });
  };
  const market = useMarketPref();
  const [markets, setMarkets] = useState<string[]>([]);
  const [positionsList, setPositionsList] = useState<string[]>([]);
  const [expTypesList, setExpTypesList] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [standalone, setStandalone] = useState<any[]>([]);
  const [canList, setCanList] = useState(false);
  const [mine, setMine] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const crewMissing = mine ? [
    !mine.availability && "your availability",
    !mine.notes && "an about note",
  ].filter(Boolean) as string[] : [];

  useEffect(() => {
    api.get<{ markets: string[]; experience_types?: string[]; sailing_style_axes?: any[] }>("/markets")
      .then((d) => { setMarkets(d.markets || []); setExpTypesList(d.experience_types || []); }).catch(() => {});
    api.get<{ positions: string[] }>("/crew-positions").then((d) => setPositionsList(d.positions || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const mp = marketParam(market, user);
    const parts = [mp, verifiedOnly ? "verified_only=true" : ""].filter(Boolean);
    const qf = parts.length ? `?${parts.join("&")}` : "";
    const [s, m] = await Promise.all([
      api.get<any>(`/crew-bank/standalone${qf}`).catch(() => ({ entries: [], can_list_yourself: false })),
      api.get<any>("/crew-bank/standalone/mine").catch(() => null),
    ]);
    setStandalone(s.entries || []);
    setCanList(!!s.can_list_yourself);
    const meEntry = m?.entry || m;
    setMine(meEntry && meEntry.user_id ? meEntry : null);
    setLoading(false);
  }, [market, user, verifiedOnly]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const removeListing = () => {
    Alert.alert("Remove listing", "Take yourself off the Crew Bank?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => { try { await api.del("/crew-bank/standalone"); setMine(null); await load(); toast.info("Removed your Crew Bank listing"); } catch { toast.error("Couldn't remove your listing"); } },
      },
    ]);
  };

  const [cardBusy, setCardBusy] = useState(false);
  const setMineStatus = async (status: string) => {
    setCardBusy(true);
    try { await api.patch("/crew-bank/standalone/status", { status }); await load(); toast.success(status === "found" ? "Marked as found." : "Back to seeking."); }
    catch { toast.error("Couldn't update status"); } finally { setCardBusy(false); }
  };
  const renewMine = async () => {
    setCardBusy(true);
    try { await api.post("/crew-bank/standalone/renew", {}); await load(); toast.success("Refreshed for another 90 days."); }
    catch { toast.error("Couldn't renew"); } finally { setCardBusy(false); }
  };

  return (
    <Screen
      title="Crew Bank"
      showBack
      padded={false}
      right={
        canList ? (
          <Pressable testID="list-myself-btn" onPress={() => router.push("/crew-listing")} hitSlop={8}>
            <Icon name={mine ? "create-outline" : "add-circle-outline"} size={24} color={colors.onBrandPrimary}  footprint={24}/>
          </Pressable>
        ) : null
      }
    >
      {loading ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}>
          <Text style={[styles.lead, { color: colors.onSurface }]}>Find crew or get on the water.</Text>
          <Pressable testID="crew-sailing-opps-link" onPress={() => router.navigate({ pathname: "/(tabs)/feed", params: { filter: "sailing" } })} hitSlop={6} style={{ alignSelf: "flex-start", marginBottom: 14 }}>
            <Text style={{ color: colors.teal, fontWeight: "700", fontSize: 14 }}>Looking for a boat? See Sailing Opportunities</Text>
          </Pressable>

          <Button title="My Crew Listings" variant="secondary" icon="list-outline" onPress={() => router.push("/my-crew-listings" as any)} testID="crewbank-my-crew-listings-btn" style={{ marginBottom: 14, height: 44 }} />

          {/* Self-listing CTA */}
          {mine ? (
            <View style={[styles.mineCardCol, { backgroundColor: colors.tealSoft, borderColor: colors.teal }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Icon name="checkmark-circle" size={20} color={colors.teal} footprint={20}/>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.onSurface, fontWeight: "700" }}>You're listed as available crew</Text>
                  <Text style={{ color: colors.onSurfaceSecondary, fontSize: 12.5 }} numberOfLines={1}>
                    {(mine.positions || []).join(", ") || "Any position"}
                    {mine.status === "found" ? " · Found" : " · Seeking"}
                  </Text>
                </View>
                <Pressable onPress={removeListing} testID="remove-listing-btn" hitSlop={8}><Icon name="trash-outline" size={20} color={colors.error} footprint={20}/></Pressable>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                <Button title="Edit" variant="secondary" icon="create-outline" onPress={() => router.push("/crew-listing")} disabled={cardBusy} style={{ width: "47%", height: 44 }} testID="mine-edit" />
                {mine.status === "found"
                  ? <Button title="Seeking" variant="secondary" onPress={() => setMineStatus("seeking")} disabled={cardBusy} style={{ width: "47%", height: 44 }} testID="mine-seeking" />
                  : <Button title="Found" variant="secondary" icon="checkmark" onPress={() => setMineStatus("found")} disabled={cardBusy} style={{ width: "47%", height: 44 }} testID="mine-found" />}
                <Button title="Renew" variant="secondary" icon="refresh" onPress={renewMine} disabled={cardBusy} style={{ width: "47%", height: 44 }} testID="mine-renew" />
              </View>
            </View>
          ) : canList ? (
            <Pressable testID="list-myself-cta" onPress={() => router.push("/crew-listing")} style={[styles.mineCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Icon name="people-outline" size={20} color={colors.accent}  footprint={20}/>
              <Text style={{ flex: 1, color: colors.onSurface, fontWeight: "700" }}>List yourself as available crew</Text>
              <Icon name="chevron-forward" size={20} color={colors.borderStrong}  footprint={20}/>
            </Pressable>
          ) : (
            <Pressable testID="crew-upsell" onPress={() => router.push("/pricing")} style={[styles.mineCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Icon name="star-outline" size={20} color={colors.accent}  footprint={20}/>
              <Text style={{ flex: 1, color: colors.onSurfaceSecondary, fontSize: 13 }}>Listing yourself as crew is a Premium feature. Tap to upgrade.</Text>
              <Icon name="chevron-forward" size={20} color={colors.borderStrong}  footprint={20}/>
            </Pressable>
          )}

          {mine && crewMissing.length > 0 ? (
            <Pressable testID="crew-completeness-hint" onPress={() => router.push("/crew-listing")} style={styles.hint}>
              <Icon name="sparkles-outline" size={18} color="#d98c30"  footprint={18}/>
              <Text style={styles.hintText}>Add {crewMissing.join(" & ")} so skippers can trust you're ready.</Text>
              <Icon name="chevron-forward" size={18} color="#d98c30"  footprint={18}/>
            </Pressable>
          ) : null}

          <View style={{ flexDirection: "row", marginBottom: 16 }}>
            <MultiSelectPicker
              label="Markets"
              title="Filter by market"
              testID="crew-market-picker"
              single
              searchable={false}
              options={[{ value: "mine", label: "My markets" }, { value: "all", label: "All markets" }, ...markets.map((m) => ({ value: m, label: m }))]}
              value={[market]}
              onChange={(next) => { if (next[0]) setMarketPref(next[0]); }}
              accessibilityLabel={`Market filter: ${market === "mine" ? "My markets" : market === "all" ? "All markets" : market}`}
            />
          </View>

          <Text style={[styles.section, { color: colors.onSurface }]}>Sailors ready to hop on a boat</Text>
          <Pressable testID="crew-verified-toggle" onPress={() => setVerifiedOnly((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginBottom: 12,
                     borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6,
                     backgroundColor: verifiedOnly ? colors.teal : colors.surface, borderColor: verifiedOnly ? colors.teal : colors.border }}>
            <Icon name="funnel-outline" size={14} color={verifiedOnly ? colors.onBrandSecondary : colors.muted} footprint={14} />
            <Text style={{ fontWeight: "700", fontSize: 12.5, color: verifiedOnly ? colors.onBrandSecondary : colors.onSurfaceSecondary }}>Verified only</Text>
          </Pressable>
          {standalone.length === 0 ? (
            <View style={{ paddingVertical: 20 }}><EmptyState icon="people-outline" title="No listings yet" subtitle="Premium members can list themselves as available crew." /></View>
          ) : standalone.map((c, i) => (
            <Pressable key={`s-${c.user_id}-${i}`} testID={`crew-standalone-${c.user_id}`} onPress={() => setSelected(c)}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Avatar uri={c.user_avatar} name={c.user_name} size={40} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ color: colors.onSurface, fontWeight: "700", flexShrink: 1 }} numberOfLines={1}>{c.user_name || "Sailor"}</Text>
                  {c.user_verified ? <Icon name="verified" size={14} color={colors.teal} footprint={14} /> : null}
                </View>
                <Text style={{ color: colors.muted, fontSize: 12.5 }} numberOfLines={1}>{(c.positions || []).join(", ") || "Any position"}</Text>
                {c.notes || c.blurb ? <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 3 }} numberOfLines={2}>{c.notes || c.blurb}</Text> : null}
              </View>
              {c.user_id && c.user_id !== user?.user_id ? (
                <Button title="Message" variant="ghost" onPress={() => openDM(c.user_id, c.user_name)} style={{ height: 36, paddingHorizontal: 12 }} testID={`crew-msg-${c.user_id}`} />
              ) : <Badge label="You" tone="teal" />}
            </Pressable>
          ))}
        </ScrollView>
      )}

      <CrewListingPopup visible={!!selected} entry={selected} onClose={() => setSelected(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 17, fontWeight: "700", marginBottom: 14 },
  section: { fontSize: 16, fontWeight: "800", marginBottom: 10 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  mineCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 16 },
  mineCardCol: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 16 },
  hint: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF3C7", borderColor: "#FCD34D", borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 16 },
  hintText: { flex: 1, fontSize: 13, lineHeight: 18, color: "#92400E", fontWeight: "600" },
});
