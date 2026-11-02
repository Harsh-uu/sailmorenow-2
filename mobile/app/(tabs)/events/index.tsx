import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { NotificationBell } from "@/src/components/NotificationBell";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, DeviceEventEmitter } from "react-native";
import EventMap from "@/src/components/EventMap";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import dayjs from "dayjs";

import { api } from "@/src/lib/api";
import { Badge, Button, EmptyState, ErrorState, Loading, Picker, SegmentedControl } from "@/src/components/ui";
import { useTheme } from "@/src/theme";
import { AppHeader } from "@/src/components/AppHeader";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { canPostEvents } from "@/src/lib/plan";
import { useMarketPref, setMarketPref, marketParam } from "@/src/lib/marketPref";
import { FollowingBanner } from "@/src/components/FollowingBanner";
import { CONTENT_CHANGED } from "@/src/lib/events";

import { ptDayKey, fmtBadge, fmtListDateTime, eventTitleParts } from "@/src/lib/format";

type EventItem = {
  id: string;
  title: string;
  market: string;
  starts_at: string;
  time_not_listed?: boolean | null;
  location?: string;
  category?: string;
  is_race?: boolean;
  is_volunteer?: boolean;
  is_paid?: boolean;
  is_free?: boolean;
  registrations?: { attendee: number; volunteer: number };
};

const CATEGORIES = [
  { id: "", label: "All" },
  { id: "racing", label: "Racing" },
  { id: "cruising", label: "Cruising" },
  { id: "social", label: "Social" },
  { id: "education", label: "Education" },
  { id: "volunteering", label: "Volunteering" },
  { id: "other", label: "Other" },
];

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const CAT_COLORS: Record<string, string> = {
  racing: "#2563EB", cruising: "#0EA5A4", social: "#0EA5A4", education: "#7C3AED", volunteering: "#F2A03B", other: "#94A3B8",
};
const CAT_ORDER = ["racing", "cruising", "social", "education", "volunteering", "other"];

export default function Events() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [markets, setMarkets] = useState<string[]>([]);
  const market = useMarketPref();
  const [category, setCategory] = useState("");
  const [showCal, setShowCal] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [calView, setCalView] = useState<"week" | "month">("week");
  const [calMonth, setCalMonth] = useState(dayjs().startOf("month"));
  const [weekAnchor, setWeekAnchor] = useState(dayjs().startOf("week"));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    api.get<{ markets: string[] }>("/markets").then((d) => setMarkets(d.markets || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const mp = marketParam(market, user);
      const qs = [mp, category ? `category=${category}` : ""].filter(Boolean).join("&");
      const data = await api.get<EventItem[]>(`/events${qs ? `?${qs}` : ""}`);
      setEvents(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load events");
    }
  }, [market, user, category]);

  useEffect(() => {
    setEvents(null);
    load();
  }, [load]);

  // Shared refresh signal: refetch after an event is created (incl. a whole
  // repeating series), edited, cancelled or deleted so the new events appear
  // immediately. The list is date-sorted, so we reload rather than inserting
  // optimistically at the top (a future event does not belong at the top).
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(CONTENT_CHANGED, (p: any) => {
      if (p?.kind === "event") load();
    });
    return () => sub.remove();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Map each day -> set of categories present (drives per-category colored dots).
  const eventDayCats = useMemo(() => {
    const m = new Map<string, Set<string>>();
    (events || []).forEach((e) => {
      const key = ptDayKey(e.starts_at, e.time_not_listed);
      if (!key) return;
      const cat = CAT_COLORS[e.category as string] ? (e.category as string) : "other";
      if (!m.has(key)) m.set(key, new Set());
      m.get(key)!.add(cat);
    });
    return m;
  }, [events]);

  const dotsFor = (iso: string) => {
    const set = eventDayCats.get(iso);
    if (!set) return [] as string[];
    return CAT_ORDER.filter((c) => set.has(c)).slice(0, 4);
  };

  const visible = useMemo(() => {
    if (!events) return events;
    if (!selectedDay) return events;
    return events.filter((e) => ptDayKey(e.starts_at, e.time_not_listed) === selectedDay);
  }, [events, selectedDay]);

  const calendarCells = useMemo(() => {
    const firstWeekday = calMonth.day(); // 0=Sun
    const daysInMonth = calMonth.daysInMonth();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [calMonth]);

  const goToday = () => {
    const t = dayjs();
    setCalMonth(t.startOf("month"));
    setWeekAnchor(t.startOf("week"));
    setSelectedDay(t.format("YYYY-MM-DD"));
  };

  const renderDayCell = (iso: string, dayNum: number) => {
    const isSel = selectedDay === iso;
    const dots = dotsFor(iso);
    return (
      <Pressable key={`d-${iso}`} testID={`cal-day-${dayNum}`} onPress={() => setSelectedDay((p) => (p === iso ? null : iso))} style={styles.calCell}>
        <View style={[styles.calDay, isSel && { backgroundColor: colors.teal }]}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={1.3} style={{ color: isSel ? colors.onBrandPrimary : colors.onSurface, fontWeight: isSel ? "800" : "600", fontSize: 14 }}>{dayNum}</Text>
        </View>
        <View style={styles.calDotRow}>
          {dots.map((c, di) => (<View key={di} style={[styles.calDot, { backgroundColor: CAT_COLORS[c] }]} />))}
        </View>
      </Pressable>
    );
  };

  const ListHeader = (
    <View>
      <FollowingBanner />
      {showCal && (
        <View style={[styles.calCard, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="events-calendar">
          <View style={styles.calTopRow}>
            <SegmentedControl testID="cal-view" value={calView} onChange={(v) => setCalView(v as "week" | "month")}
              style={{ flexShrink: 1 }}
              options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
            <Pressable testID="cal-today-btn" onPress={goToday} style={[styles.todayBtn, { borderColor: colors.teal }]}>
              <Icon name="today-outline" size={14} color={colors.teal}  footprint={14}/>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ color: colors.teal, fontWeight: "700", fontSize: 12.5 }}>Today</Text>
            </Pressable>
          </View>
          <View style={styles.calNav}>
            <Pressable testID="cal-prev" hitSlop={8} onPress={() => (calView === "month" ? setCalMonth((m) => m.subtract(1, "month")) : setWeekAnchor((w) => w.subtract(1, "week")))}>
              <Icon name="chevron-back" size={22} color={colors.onSurface}  footprint={22}/>
            </Pressable>
            <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={[styles.calMonthLbl, { color: colors.onSurface, flex: 1, textAlign: "center" }]}>
              {calView === "month" ? calMonth.format("MMMM YYYY") : `${weekAnchor.format("MMM D")} - ${weekAnchor.add(6, "day").format("MMM D")}`}
            </Text>
            <Pressable testID="cal-next" hitSlop={8} onPress={() => (calView === "month" ? setCalMonth((m) => m.add(1, "month")) : setWeekAnchor((w) => w.add(1, "week")))}>
              <Icon name="chevron-forward" size={22} color={colors.onSurface}  footprint={22}/>
            </Pressable>
          </View>
          <View style={styles.calWeekRow}>
            {WEEKDAYS.map((w, i) => (
              <Text key={i} maxFontSizeMultiplier={1.3} style={[styles.calWeekday, { color: colors.muted }]}>{w}</Text>
            ))}
          </View>
          <View style={styles.calGrid}>
            {calView === "month"
              ? calendarCells.map((day, i) => {
                  if (day === null) return <View key={`b-${i}`} style={styles.calCell} />;
                  return renderDayCell(calMonth.date(day).format("YYYY-MM-DD"), day);
                })
              : Array.from({ length: 7 }).map((_, i) => {
                  const dd = weekAnchor.add(i, "day");
                  return renderDayCell(dd.format("YYYY-MM-DD"), dd.date());
                })}
          </View>
          <View style={styles.legend}>
            {CAT_ORDER.map((c) => (
              <View key={c} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: CAT_COLORS[c] }]} />
                <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.legendLbl, { color: colors.muted }]}>{c[0].toUpperCase() + c.slice(1)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {selectedDay && (
        <View style={[styles.dayBar, { backgroundColor: colors.brandTertiary, borderColor: colors.teal }]} testID="selected-day-bar">
          <Icon name="calendar" size={16} color={colors.onBrandTertiary}  footprint={16}/>
          <Text style={{ flex: 1, color: colors.onBrandTertiary, fontWeight: "700" }}>{dayjs(selectedDay).format("ddd, MMM D")}</Text>
          <Pressable testID="clear-day" onPress={() => setSelectedDay(null)} hitSlop={8}>
            <Text style={{ color: colors.teal, fontWeight: "700" }}>Show all</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <AppHeader title="Events" right={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            {user ? (
              <Pressable testID="my-crew-listings-btn" accessibilityRole="button" accessibilityLabel="My Crew Listings" onPress={() => router.push("/my-crew-listings" as any)} hitSlop={10}>
                <Icon name="people-outline" size={22} color={colors.onBrandPrimary} footprint={22} />
              </Pressable>
            ) : null}
            {user?.account_type === "partner" ? (
              <Pressable testID="my-events-btn" onPress={() => router.push("/my-events")} hitSlop={10}>
                <Icon name="myEvents" size={22} color={colors.onBrandPrimary} footprint={22} />
              </Pressable>
            ) : null}
            <NotificationBell />
            <Pressable testID="toggle-map-btn" onPress={() => setShowMap((s) => !s)} hitSlop={10}>
              <Icon name={showMap ? "list-outline" : "map"} size={22} color={colors.onBrandPrimary} footprint={22} />
            </Pressable>
            <Pressable testID="toggle-calendar-btn" onPress={() => setShowCal((s) => !s)} hitSlop={10}>
              <Icon name={showCal ? "list-outline" : "calendar-outline"} size={23} color={colors.onBrandPrimary}  footprint={23}/>
            </Pressable>
            {canPostEvents(user) ? (
              <Pressable testID="create-event-btn" onPress={() => router.push("/new-event")} hitSlop={10}>
                <Icon name="add-circle-outline" size={24} color={colors.onBrandPrimary}  footprint={24}/>
              </Pressable>
            ) : null}
          </View>
      } />
      <View style={{ backgroundColor: colors.brandPrimary }}>
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingBottom: 12 }}>
          <Picker testID="market-picker" title="Choose market" icon="location" flex
            value={market} onChange={(v) => setMarketPref(v)}
            options={[{ value: "mine", label: "My markets" }, { value: "all", label: "All markets" }, ...markets.map((m) => ({ value: m, label: m }))]} />
          <Picker testID="category-picker" title="Event category" flex
            value={category} onChange={setCategory}
            options={CATEGORIES.map((c) => ({ value: c.id, label: c.id === "" ? "All categories" : c.label }))} />
        </View>
      </View>

      {events == null && !error ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : showMap ? (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}>
          <EventMap events={visible || []} onOpen={(id) => router.push(`/events/events/${id}` as any)} />
        </ScrollView>
      ) : (
        <FlatList
          data={visible || []}
          keyExtractor={(e) => e.id}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
          ListEmptyComponent={
            <View style={{ paddingTop: 40 }}>
              <EmptyState icon="calendar-outline" title={selectedDay ? "No events that day" : "No upcoming events"} subtitle={selectedDay ? "Pick another date or show all." : "Check back soon or post your own."}
                action={category ? <Button title="Clear filters" variant="secondary" icon="close" onPress={() => setCategory("")} testID="events-clear-filters" />
                  : selectedDay ? <Button title="Show all" variant="secondary" onPress={() => setSelectedDay(null)} testID="events-show-all" /> : undefined} />
            </View>
          }
          renderItem={({ item }) => {
            const badge = fmtBadge(item.starts_at, item.time_not_listed);
            const tp = eventTitleParts(item.title);
            return (
              <Pressable
                testID={`event-card-${item.id}`}
                onPress={() => router.push(`/events/events/${item.id}` as any)}
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={[styles.dateBox, { backgroundColor: colors.brandTertiary }]}>
                  <Text style={[styles.dMonth, { color: colors.onBrandTertiary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.1}>{badge.month}</Text>
                  <Text style={[styles.dDay, { color: colors.onBrandTertiary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{badge.day}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: colors.onSurface }]} numberOfLines={2}>
                    {tp.title}
                  </Text>
                  <Text style={[styles.when, { color: colors.onSurfaceSecondary }]} numberOfLines={2} testID={`event-when-${item.id}`}>
                    {fmtListDateTime(item.starts_at, item.time_not_listed)}
                  </Text>
                  <View style={styles.metaRow}>
                    <Icon name="location-outline" size={13} color={colors.muted}  footprint={13}/>
                    <Text style={[styles.meta, { color: colors.muted, flexShrink: 1 }]} numberOfLines={2}>
                      {item.location ? `${item.location} · ` : ""}{item.market}
                    </Text>
                  </View>
                  <View style={styles.badges}>
                    {tp.tentative ? <Badge label="Tentative" tone="accent" /> : null}
                    {item.is_race ? <Badge label="Race" tone="navy" /> : null}
                    {item.is_volunteer ? <Badge label="Volunteer" tone="teal" /> : null}
                    {item.is_free ? <Badge label="Free" tone="teal" /> : null}
                    <Text style={[styles.meta, { color: colors.muted, marginLeft: 4 }]}>
                      {(item.registrations?.attendee || 0)} going
                    </Text>
                  </View>
                </View>
                <Icon name="chevron-forward" size={20} color={colors.borderStrong}  footprint={20}/>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  hTitle: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3, flexShrink: 1 },
  card: { borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  dateBox: { width: 52, height: 56, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  dMonth: { fontSize: 12, fontWeight: "800", letterSpacing: 0.3 },
  dDay: { fontSize: 22, fontWeight: "800" },
  title: { fontSize: 16, fontWeight: "700", letterSpacing: -0.2 },
  when: { fontSize: 12.5, fontWeight: "600", marginTop: 3 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  meta: { fontSize: 12.5 },
  badges: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" },
  calCard: { borderRadius: 18, borderWidth: 1, padding: 12, marginBottom: 12 },
  calNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, marginBottom: 8 },
  calMonthLbl: { fontSize: 16, fontWeight: "800" },
  calWeekRow: { flexDirection: "row" },
  calWeekday: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700" },
  calGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 },
  calCell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 4, minHeight: 48 },
  calDay: { minWidth: 34, minHeight: 34, paddingHorizontal: 4, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  calDotRow: { flexDirection: "row", gap: 2, marginTop: 3, height: 6, alignItems: "center" },
  calDot: { width: 5, height: 5, borderRadius: 3 },
  calViewToggle: { flexDirection: "row", gap: 6 },
  calTopRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, flexWrap: "wrap", rowGap: 8 },
  todayBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, flexShrink: 0, marginLeft: "auto" },
  calViewBtn: { paddingHorizontal: 16, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10, justifyContent: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLbl: { fontSize: 11, fontWeight: "600" },
  dayBar: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 12 },
});
