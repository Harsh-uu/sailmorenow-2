import { useCallback, useMemo, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { fmtDateTime, eventTitleParts } from "@/src/lib/format";

import { api } from "@/src/lib/api";
import { Button, EmptyState, Loading } from "@/src/components/ui";
import { useTheme } from "@/src/theme";
import { AppHeader } from "@/src/components/AppHeader";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { canPostEvents } from "@/src/lib/plan";
import { RosterRow } from "@/src/components/RosterRow";

function Stat({ label, value, colors }: { label: string; value: number; colors: any }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statVal, { color: colors.onBrandPrimary }]}>{value}</Text>
      <Text style={[styles.statLbl, { color: colors.onBrandPrimary }]}>{label}</Text>
    </View>
  );
}

export default function MyEvents() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState<any[] | null>(null);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [rosterId, setRosterId] = useState<string | null>(null);
  const [roster, setRoster] = useState<Record<string, any[]>>({});

  const load = useCallback(() => {
    api.get("/events/mine").then((d) => setEvents(d || [])).catch(() => setEvents([]));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleRoster = async (e: any) => {
    if (rosterId === e.id) { setRosterId(null); return; }
    setRosterId(e.id);
    if (!roster[e.id]) {
      try {
        const data = await api.get<any>(`/events/${e.id}/registrations`);
        setRoster((r) => ({ ...r, [e.id]: data.registrations || [] }));
      } catch { setRoster((r) => ({ ...r, [e.id]: [] })); }
    }
  };

  const openRemind = (e: any) => router.push({ pathname: "/remind-volunteers", params: { id: e.id, title: e.title || "" } });

  const editEvent = (e: any) => router.push({
    pathname: "/new-event",
    params: {
      edit: e.id, title: e.title || "", description: e.description || "", market: e.market || "",
      starts_at: e.starts_at, ends_at: e.ends_at || "", location: e.location || "",
      is_race: e.is_race ? "1" : "0", is_volunteer: e.is_volunteer ? "1" : "0", is_paid: e.is_paid ? "1" : "0",
      volunteer_contact_email: e.volunteer_contact_email || "",
      volunteer_contact_phone: e.volunteer_contact_phone || "",
      volunteer_reminder_lead_days: String(e.volunteer_reminder_lead_days ?? 1),
      category: e.category_manual && e.category ? e.category : "",
      registration_url: e.registration_url || "",
    },
  });

  const visible = useMemo(() => (events || []).filter((e) => (tab === "past" ? e.is_past : !e.is_past)), [events, tab]);
  const totals = useMemo(
    () => (events || []).filter((e) => !e.is_past).reduce(
      (a, e) => ({ events: a.events + 1, rsvps: a.rsvps + (e.registrations?.attendee || 0), vols: a.vols + (e.registrations?.volunteer || 0) }),
      { events: 0, rsvps: 0, vols: 0 },
    ),
    [events],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <AppHeader title="My Events" right={canPostEvents(user) ? (
            <Button title="Post" icon="add-outline" onPress={() => router.push("/new-event")} testID="post-event-btn" style={styles.postBtn} />
          ) : null} />
      <View style={{ backgroundColor: colors.brandPrimary }}>
        <View style={styles.stats}>
          <Stat label="Upcoming" value={totals.events} colors={colors} />
          <Stat label="RSVPs" value={totals.rsvps} colors={colors} />
          <Stat label="Volunteers" value={totals.vols} colors={colors} />
        </View>
        <View style={styles.tabs}>
          {(["upcoming", "past"] as const).map((t) => (
            <Pressable key={t} testID={`myev-tab-${t}`} onPress={() => setTab(t)} style={[styles.tabBtn, { backgroundColor: tab === t ? colors.surface : "transparent" }]}>
              <Text style={{ color: tab === t ? colors.brandPrimary : colors.onBrandPrimary, fontWeight: "700", fontSize: 13, textTransform: "capitalize" }} maxFontSizeMultiplier={1.2}>{t}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {events === null ? (
        <Loading />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={{ paddingTop: 60 }}>
              <EmptyState
                icon="calendar-outline"
                title={tab === "upcoming" ? "No upcoming events" : "No past events"}
                subtitle={tab === "upcoming" ? "Post your first event to reach sailors across the PNW." : "Nothing here yet."}
              />
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} testID={`myev-${item.id}`}>
              {item.source === "aggregator" ? (
                <View style={[styles.importedTag, { backgroundColor: colors.teal + "22" }]} testID={`imported-tag-${item.id}`}>
                  <Icon name="cloud-download-outline" size={12} color={colors.teal} footprint={12} />
                  <Text style={{ color: colors.teal, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 }}>IMPORTED</Text>
                </View>
              ) : null}
              <Text style={[styles.title, { color: colors.onSurface }]} numberOfLines={2}>{eventTitleParts(item.title).title}</Text>
              <View style={styles.metaRow}>
                <Icon name="time-outline" size={14} color={colors.muted}  footprint={14}/>
                <Text style={[styles.meta, { color: colors.onSurfaceSecondary }]}>{fmtDateTime(item.starts_at, item.time_not_listed)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Icon name="location-outline" size={14} color={colors.muted}  footprint={14}/>
                <Text style={[styles.meta, { color: colors.onSurfaceSecondary }]}>{[item.location, item.market].filter(Boolean).join(" · ")}</Text>
              </View>
              <View style={styles.countRow}>
                <View style={styles.count}>
                  <Icon name="people-outline" size={15} color={colors.teal}  footprint={15}/>
                  <Text style={[styles.countText, { color: colors.onSurface }]}>{item.registrations?.attendee || 0} RSVPs</Text>
                </View>
                {(item.registrations?.volunteer || 0) > 0 ? (
                  <View style={styles.count}>
                    <Icon name="hand-left-outline" size={15} color={colors.accent}  footprint={15}/>
                    <Text style={[styles.countText, { color: colors.onSurface }]}>{item.registrations?.volunteer} vols</Text>
                  </View>
                ) : null}
              </View>

              {rosterId === item.id ? (
                <View style={[styles.roster, { borderColor: colors.border }]} testID={`roster-panel-${item.id}`}>
                  {roster[item.id] === undefined ? (
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Loading roster…</Text>
                  ) : roster[item.id].length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 13 }} testID={`roster-empty-${item.id}`}>No RSVPs or volunteer signups yet.</Text>
                  ) : (
                    <>
                      {roster[item.id].filter((r) => r.kind === "volunteer").length > 0 ? (
                        <Text style={[styles.rosterHead, { color: colors.accent }]}>Volunteers</Text>
                      ) : null}
                      {roster[item.id].filter((r) => r.kind === "volunteer").map((r) => (
                        <RosterRow key={r.id || r.user_id} person={r} />
                      ))}
                      {roster[item.id].filter((r) => r.kind !== "volunteer").length > 0 ? (
                        <Text style={[styles.rosterHead, { color: colors.teal }]}>Going</Text>
                      ) : null}
                      {roster[item.id].filter((r) => r.kind !== "volunteer").map((r) => (
                        <RosterRow key={r.id || r.user_id} person={r} />
                      ))}
                    </>
                  )}
                </View>
              ) : null}

              <View style={styles.actions}>
                <Pressable testID={`myev-roster-${item.id}`} onPress={() => toggleRoster(item)} style={[styles.actionBtn, { borderColor: rosterId === item.id ? colors.teal : colors.border }]}>
                  <Icon name="people-outline" size={16} color={rosterId === item.id ? colors.teal : colors.onSurface}  footprint={16}/>
                  <Text style={[styles.actionText, { color: rosterId === item.id ? colors.teal : colors.onSurface }]}>Roster</Text>
                </Pressable>
                {(item.is_volunteer || (item.registrations?.volunteer || 0) > 0) ? (
                  <Pressable testID={`myev-remind-${item.id}`} onPress={() => openRemind(item)} style={[styles.actionBtn, { borderColor: colors.border }]}>
                    <Icon name="notifications-outline" size={16} color={colors.accent}  footprint={16}/>
                    <Text style={[styles.actionText, { color: colors.onSurface }]}>Remind volunteers</Text>
                  </Pressable>
                ) : null}
                {item.source !== "aggregator" ? (
                  <>
                    <Pressable testID={`myev-edit-${item.id}`} onPress={() => editEvent(item)} style={[styles.actionBtn, { borderColor: colors.border }]}>
                      <Icon name="create-outline" size={16} color={colors.onSurface}  footprint={16}/>
                      <Text style={[styles.actionText, { color: colors.onSurface }]}>Edit</Text>
                    </Pressable>
                    <Pressable testID={`myev-cancel-${item.id}`} onPress={() => router.push({ pathname: "/cancel-event", params: { id: item.id, title: item.title || "" } } as any)} style={[styles.actionBtn, { borderColor: "#FCA5A5" }]}>
                      <Icon name="close-circle-outline" size={16} color="#DC2626"  footprint={16}/>
                      <Text style={[styles.actionText, { color: "#DC2626" }]}>Cancel</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  hTitle: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  postBtn: { height: 38, paddingHorizontal: 16 },
  stats: { flexDirection: "row", paddingHorizontal: 16, paddingBottom: 12, gap: 20 },
  stat: {},
  statVal: { fontSize: 22, fontWeight: "800" },
  statLbl: { fontSize: 11, fontWeight: "600", opacity: 0.85, marginTop: 1 },
  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 12 },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12 },
  title: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  meta: { fontSize: 13, flex: 1 },
  countRow: { flexDirection: "row", gap: 16, marginTop: 10 },
  count: { flexDirection: "row", alignItems: "center", gap: 5 },
  countText: { fontSize: 13, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  actionText: { fontSize: 13, fontWeight: "700" },
  importedTag: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginBottom: 6 },
  roster: { borderTopWidth: 1, marginTop: 12, paddingTop: 10, gap: 8 },
  rosterHead: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", marginTop: 4 },
  rosterName: { fontSize: 13.5, paddingLeft: 4 },
  confirmBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 28 },
  confirmCard: { borderRadius: 20, padding: 20 },
  confirmTitle: { fontSize: 18, fontWeight: "800" },
  confirmBody: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  reasonInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 44, fontSize: 14, marginTop: 14 },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  preset: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  confirmRow: { flexDirection: "row", gap: 10, marginTop: 18 },
});
