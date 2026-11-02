import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { NotificationBell } from "@/src/components/NotificationBell";
import { DeviceEventEmitter, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { MotionModal as Modal } from "@/src/components/MotionModal";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { api, ApiError } from "@/src/lib/api";
import { Avatar, Badge, Chip, EmptyState, ErrorState, Loading, Picker, FilterButton } from "@/src/components/ui";
import { useTheme } from "@/src/theme";
import { AppHeader } from "@/src/components/AppHeader";
import { fmtTimeAgo } from "@/src/lib/format";
import { useAuth } from "@/src/context/AuthContext";
import { useMarketPref, setMarketPref, marketParam, marketLabel } from "@/src/lib/marketPref";
import { useAppSocket } from "@/src/context/WebSocketContext";
import { PartnerBadge, UpgradeNudge, RenewalReminder } from "@/src/components/partner";
import { FollowingBanner } from "@/src/components/FollowingBanner";
import { ReportButton } from "@/src/components/ReportButton";
import { InlineComments } from "@/src/components/InlineComments";
import { useProfilePreview } from "@/src/context/ProfilePreviewContext";
import { LinkifiedText } from "@/src/lib/linkify";
import { useSaved } from "@/src/lib/useSaved";
import { useToast } from "@/src/context/ToastContext";
import { canParticipate, canPostEvents } from "@/src/lib/plan";
import { MP_FILTERS_EVT } from "@/app/marketplace-filters";
import { CONTENT_CHANGED } from "@/src/lib/events";

type Item = any & { _kind: string };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "crew", label: "Crew Bank" },
  { key: "feed", label: "Feed" },
  { key: "forum", label: "Forum" },
  { key: "blog", label: "Blog" },
  { key: "sailing", label: "Sailing Opportunities" },
  { key: "for_sale", label: "Marketplace" },
  { key: "volunteer", label: "Volunteer" },
];

const monthKeyOf = (d: any) => { const x = new Date(d || Date.now()); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`; };
const monthLabelOf = (d: any) => new Date(d).toLocaleString(undefined, { month: "long", year: "numeric" });

export default function Hub() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { subscribe } = useAppSocket();
  const toast = useToast();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<string>(() => {
    const f = typeof params.filter === "string" ? params.filter : "";
    return f && FILTERS.some((x) => x.key === f) && f !== "crew" ? f : "all";
  });
  const market = useMarketPref();
  const [markets, setMarkets] = useState<string[]>([]);
  const [marketOpen, setMarketOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [rx, setRx] = useState<Record<string, { up: number; down: number; mine: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsedMonths, setCollapsedMonths] = useState<Record<string, boolean>>({});
  const currentMonthKey = monthKeyOf(new Date());
  const { isSaved, toggle: toggleSaved } = useSaved();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mpApplied, setMpApplied] = useState({ q: "", min: "", max: "", cond: "" });
  const isMonthCollapsed = (k: string) => (k in collapsedMonths ? collapsedMonths[k] : k !== currentMonthKey);

  const mpActiveCount = [mpApplied.q, mpApplied.min, mpApplied.max, mpApplied.cond].filter((v) => v !== "").length;
  const openMpFilters = () => {
    router.push({ pathname: "/marketplace-filters", params: { q: mpApplied.q, min: mpApplied.min, max: mpApplied.max, cond: mpApplied.cond, market: market || "" } });
  };

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(MP_FILTERS_EVT, (p: any) => {
      if (p?.type === "apply") setMpApplied({ q: p.q, min: p.min, max: p.max, cond: p.cond });
      else if (p?.type === "clear") setMpApplied({ q: "", min: "", max: "", cond: "" });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    api.get<{ markets: string[] }>("/markets").then((d) => setMarkets(d.markets || [])).catch(() => {});
  }, []);

  const mp = marketParam(market, user);
  const mq = mp ? `&${mp}` : "";
  const mqFirst = mp ? `?${mp}` : "";

  const load = useCallback(async () => {
    try {
      setError(null);
      let out: Item[] = [];
      if (filter === "all") {
        const [posts, forum, blog] = await Promise.all([
          api.get<any[]>(`/posts${mqFirst}`).catch(() => []),
          api.get<any[]>(`/discussions?kind=forum${mq}`).catch(() => []),
          api.get<any[]>(`/discussions?kind=blog${mq}`).catch(() => []),
        ]);
        out = [
          ...posts.map((p) => ({ ...p, _kind: "post" })),
          ...forum.map((d) => ({ ...d, _kind: "forum" })),
          ...blog.map((d) => ({ ...d, _kind: "blog" })),
        ].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      } else if (filter === "feed") {
        out = (await api.get<any[]>(`/posts${mqFirst}`)).map((p) => ({ ...p, _kind: "post" }));
      } else if (filter === "forum" || filter === "blog") {
        out = (await api.get<any[]>(`/discussions?kind=${filter}${mq}`)).map((d) => ({ ...d, _kind: filter }));
      } else if (filter === "sailing") {
        out = (await api.get<any[]>(`/posts?type=sailing_opportunity${mq}`)).map((p) => ({ ...p, _kind: "post" }));
      } else if (filter === "for_sale") {
        let qs = `type=for_sale${mq}`;
        if (mpApplied.q) qs += `&q=${encodeURIComponent(mpApplied.q)}`;
        if (mpApplied.min !== "") qs += `&min_price=${encodeURIComponent(mpApplied.min)}`;
        if (mpApplied.max !== "") qs += `&max_price=${encodeURIComponent(mpApplied.max)}`;
        if (mpApplied.cond) qs += `&condition=${encodeURIComponent(mpApplied.cond)}`;
        out = (await api.get<any[]>(`/posts?${qs}`)).map((p) => ({ ...p, _kind: "post" }));
      } else if (filter === "volunteer") {
        const [vposts, evs] = await Promise.all([
          api.get<any[]>(`/posts?type=volunteer_opportunity${mq}`).catch(() => []),
          api.get<any[]>(`/events${mqFirst}`).catch(() => []),
        ]);
        out = [
          ...vposts.map((p) => ({ ...p, _kind: "post" })),
          ...evs.filter((e) => e.is_volunteer).map((e) => ({ ...e, _kind: "event" })),
        ];
      }
      // For Sale lives only on the Marketplace (for_sale) view.
      if (filter !== "for_sale") out = out.filter((x) => !(x._kind === "post" && x.type === "for_sale"));
      else out.sort((a: any, b: any) => (a.sold ? 1 : 0) - (b.sold ? 1 : 0));
      setItems(out);
      // Fetch like/dislike counts for reactable cards (posts + forum/blog).
      const targets = out
        .filter((it) => ["post", "forum", "blog", "sailing"].includes(it._kind) && it.id)
        .map((it) => ({ target_type: it._kind === "post" ? "post" : "discussion", target_id: it.id }));
      if (targets.length) {
        api.post<Record<string, any>>("/reactions/batch", { items: targets })
          .then((m) => setRx(m || {}))
          .catch(() => {});
      } else {
        setRx({});
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    }
  }, [filter, market, mq, mqFirst, mpApplied]);

  useEffect(() => { setItems(null); load(); }, [load]);
  // One shared signal: after any create/edit/delete the affected list refetches
  // so new items show immediately (no manual pull-to-refresh). On a create we
  // also prepend the returned item optimistically for an instant flash, but only
  // in the simple recency-sorted post views where it is safe; the refetch that
  // follows replaces the array, so the optimistic item can never duplicate
  // (guarded by id) and ordering stays correct.
  const optimisticPrepend = useCallback((item: any) => {
    if (!item || !item.id) return;
    const t = item.type;
    const belongs =
      filter === "for_sale" ? t === "for_sale" :
      filter === "sailing" ? t === "sailing_opportunity" :
      filter === "volunteer" ? t === "volunteer_opportunity" :
      (filter === "feed" || filter === "all") ? t !== "for_sale" : false;
    const marketOk = market === "all" || market === "mine" || item.market === market;
    if (!belongs || !marketOk) return;
    setItems((prev) => {
      if (!prev) return prev;
      if (prev.some((x) => x.id === item.id)) return prev;
      return [{ ...item, _kind: "post" }, ...prev];
    });
  }, [filter, market]);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(CONTENT_CHANGED, (p: any) => {
      if (p?.action === "create" && p?.kind === "post" && p?.item) optimisticPrepend(p.item);
      load();
    });
    return () => sub.remove();
  }, [load, optimisticPrepend]);
  useFocusEffect(
    useCallback(() => {
      const f = params.filter;
      if (f && FILTERS.some((x) => x.key === f) && f !== "crew") {
        setFilter(f);
        router.setParams({ filter: "" });
      }
    }, [params.filter]),
  );
  useFocusEffect(
    useCallback(() => {
      const off = subscribe("comment.count", (msg) =>
        setItems((prev) => (prev ? prev.map((p) => (p.id === msg.post_id ? { ...p, comment_count: msg.count } : p)) : prev)),
      );
      return off;
    }, [subscribe]),
  );

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const openItem = (it: Item) => {
    if (it._kind === "post") router.push(`/feed/post/${it.id}` as any);
    else if (it._kind === "forum" || it._kind === "blog") router.push(`/feed/hub/${it.id}` as any);
    else if (it._kind === "event") router.push(`/feed/events/${it.id}` as any);
    else if (it._kind === "crew_open" && it.event_id) router.push(`/feed/events/${it.event_id}` as any);
  };
  const composeItem = (it: Item) => {
    if (it._kind === "post") router.push({ pathname: `/feed/post/${it.id}`, params: { compose: "1" } } as any);
    else if (it._kind === "forum" || it._kind === "blog") router.push({ pathname: `/feed/hub/${it.id}`, params: { compose: "1" } } as any);
  };
  const isExpandable = (it: Item) => it._kind === "forum" || it._kind === "blog" || (it._kind === "post" && it.type !== "for_sale");
  const onCardPress = (it: Item) => {
    if (isExpandable(it)) setExpandedId((cur) => (cur === it.id ? null : it.id));
    else openItem(it);
  };

  // Like / dislike straight from a feed card. Must not toggle the card (the
  // thumbs sit in their own Pressable so the tap never reaches the parent).
  // Free accounts get a toast and stay put; a 403 is treated the same way.
  const reactTo = async (targetType: "post" | "discussion", targetId: string, value: number) => {
    if (!canParticipate(user)) { toast.warning("Upgrade to react to posts"); return; }
    try {
      const d = await api.post<{ up: number; down: number; mine: number }>("/reactions", { target_type: targetType, target_id: targetId, value });
      setRx((cur) => ({ ...cur, [`${targetType}:${targetId}`]: d }));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 402 || e.status === 403) && e.code === "upgrade_required") {
        toast.warning("Upgrade to react to posts");
      } else {
        toast.error("Couldn't save your reaction");
      }
    }
  };

  const compose = () => {
    // simple action sheet
    setComposeOpen(true);
  };
  // Shared entry to the create screen with For sale preselected. Free accounts
  // get the standard upgrade prompt (same proactive gate the compose sheet uses).
  const addListing = () => {
    router.push("/new-post?type=for_sale" as any);
  };
  const [composeOpen, setComposeOpen] = useState(false);

  const useGroups = !!items && !["crew", "volunteer"].includes(filter);
  const monthGroups = useMemo(() => {
    if (!items) return [] as [string, Item[]][];
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const k = monthKeyOf(it.created_at || it.event_starts_at || it.starts_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [items]);
  const listData = useMemo(() => {
    // Volunteer filter: two clearly labeled groups, opportunities (posts) first,
    // then volunteer events. Not month-grouped.
    if (items && filter === "volunteer") {
      const rows: any[] = [];
      const vPosts = items.filter((it) => it._kind === "post");
      const vEvents = items.filter((it) => it._kind === "event");
      if (vPosts.length) {
        rows.push({ _row: "header", k: "grp-vol-posts", label: "Volunteer opportunities", count: vPosts.length, static: true });
        for (const it of vPosts) rows.push({ _row: "item", it, k: "grp-vol-posts" });
      }
      if (vEvents.length) {
        rows.push({ _row: "header", k: "grp-vol-events", label: "Volunteer events", count: vEvents.length, static: true });
        for (const it of vEvents) rows.push({ _row: "item", it, k: "grp-vol-events" });
      }
      return rows;
    }
    if (!useGroups) return (items || []).map((it) => ({ _row: "item" as const, it, k: "", label: "", count: 0 }));
    const rows: any[] = [];
    for (const [k, arr] of monthGroups) {
      const anchor = arr[0].created_at || arr[0].event_starts_at || arr[0].starts_at || Date.now();
      rows.push({ _row: "header", k, label: monthLabelOf(anchor), count: arr.length });
      if (!isMonthCollapsed(k)) for (const it of arr) rows.push({ _row: "item", it, k });
    }
    return rows;
  }, [useGroups, items, monthGroups, collapsedMonths, filter]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <AppHeader title="Hub" right={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <Pressable testID="market-selector-btn" onPress={() => setMarketOpen(true)} style={styles.marketBtn}>
              <Icon name="location" size={14} color={colors.onBrandPrimary}  footprint={14}/>
              <Text style={styles.marketText} numberOfLines={1} maxFontSizeMultiplier={1.2}>{marketLabel(market)}</Text>
              <Icon name="chevron-down" size={14} color={colors.onBrandPrimary}  footprint={14}/>
            </Pressable>
            <NotificationBell href="/feed/notifications" />
          </View>
      } />
      <View style={{ backgroundColor: colors.brandPrimary }}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <Picker testID="hub-filter" title="Show" icon="options-outline"
            value={filter} onChange={(v) => { if (v === "crew") { router.push("/feed/crew-bank" as any); return; } setFilter(v); }}
            options={FILTERS.map((f) => ({ value: f.key, label: f.label }))} />
        </View>
      </View>

      {items == null && !error ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(row, i) => row._row === "header" ? `h-${row.k}` : `${row.it._kind}-${row.it.id || row.it.event_id || i}`}
          contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
          ListHeaderComponent={
            <>
              {filter !== "crew" ? <FollowingBanner /> : null}
              <UpgradeNudge />
              <RenewalReminder />
              {null}
              {filter === "for_sale" ? (
                <View testID="marketplace-filters" style={{ marginBottom: 14, gap: 10 }}>
                  <Pressable testID="marketplace-add-listing-btn" onPress={addListing}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, borderRadius: 999, backgroundColor: colors.accent, paddingHorizontal: 18 }}>
                    <Icon name="pricetag-outline" size={18} color={colors.onAccent} footprint={18} />
                    <Text style={{ color: colors.onAccent, fontWeight: "800", fontSize: 15 }}>Add marketplace listing</Text>
                  </Pressable>
                  <FilterButton count={mpActiveCount} onPress={openMpFilters} testID="marketplace-filters-btn" />
                  {mpActiveCount > 0 ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} testID="marketplace-active-filters">
                      {mpApplied.q ? <RemovableChip label={`"${mpApplied.q}"`} onRemove={() => setMpApplied((s) => ({ ...s, q: "" }))} testID="active-q" /> : null}
                      {mpApplied.min !== "" ? <RemovableChip label={`Min $${mpApplied.min}`} onRemove={() => setMpApplied((s) => ({ ...s, min: "" }))} testID="active-min" /> : null}
                      {mpApplied.max !== "" ? <RemovableChip label={`Max $${mpApplied.max}`} onRemove={() => setMpApplied((s) => ({ ...s, max: "" }))} testID="active-max" /> : null}
                      {mpApplied.cond ? <RemovableChip label={mpApplied.cond} onRemove={() => setMpApplied((s) => ({ ...s, cond: "" }))} testID="active-cond" /> : null}
                    </View>
                  ) : null}
                </View>
              ) : null}
              {useGroups && monthGroups.length > 1 ? null : null}
            </>
          }
          ListEmptyComponent={<View style={{ paddingTop: 70 }}><EmptyState icon="compass-outline" title="Nothing here yet" subtitle="Try another filter or market." /></View>}
          renderItem={({ item: row }) =>
            row._row === "header" ? (
              row.static ? (
                <View style={styles.monthHeader} testID={`group-${row.k}`}>
                  <Text style={[styles.monthTitle, { color: colors.onSurface, flex: 1 }]} numberOfLines={2} maxFontSizeMultiplier={1.4}>{row.label}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12.5 }} maxFontSizeMultiplier={1.2}>{row.count}</Text>
                </View>
              ) : (
                <Pressable testID={`month-toggle-${row.k}`} onPress={() => setCollapsedMonths((m) => ({ ...m, [row.k]: !isMonthCollapsed(row.k) }))}
                  style={styles.monthHeader}>
                  <Icon name={isMonthCollapsed(row.k) ? "chevron-forward" : "chevron-down"} size={18} color={colors.onSurface} footprint={18} />
                  <Text style={[styles.monthTitle, { color: colors.onSurface, flex: 1 }]} numberOfLines={2} maxFontSizeMultiplier={1.4}>{row.label}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12.5 }} maxFontSizeMultiplier={1.2}>{row.count}</Text>
                </Pressable>
              )
            ) : (
              <HubCard item={row.it} rx={rx[`${row.it._kind === "post" ? "post" : "discussion"}:${row.it.id}`]} onPress={() => onCardPress(row.it)} onReact={reactTo} expanded={expandedId === row.it.id} onOpenFull={() => openItem(row.it)} onCompose={() => composeItem(row.it)} saved={isSaved(row.it.id)} onToggleSave={toggleSaved} />
            )
          }
        />
      )}

      <Pressable testID="hub-compose-fab" onPress={compose} style={[styles.fab, { backgroundColor: colors.accent }]}>
        <Icon name="add" size={30} color={colors.onAccent}  footprint={30}/>
      </Pressable>

      {/* Market picker */}
      <Modal visible={marketOpen} transparent animationType="fade" onRequestClose={() => setMarketOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMarketOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sheetTitle, { color: colors.onSurface }]}>Choose market</Text>
            <ScrollView>
              {["mine", "all", ...markets].map((m) => (
                <Pressable key={m} testID={`market-opt-${m}`} onPress={() => { setMarketPref(m); setMarketOpen(false); }} style={styles.sheetRow}>
                  <Text style={{ color: m === market ? colors.teal : colors.onSurface, fontWeight: m === market ? "800" : "500", fontSize: 16, flex: 1, flexShrink: 1 }}>
                    {marketLabel(m)}
                  </Text>
                  {m === market ? <Icon name="checkmark" size={20} color={colors.teal}  footprint={20}/> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Compose action sheet */}
      <Modal visible={composeOpen} transparent animationType="fade" onRequestClose={() => setComposeOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setComposeOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sheetTitle, { color: colors.onSurface }]}>Create</Text>
            <ScrollView>
            {[
              { label: "New post", icon: "chatbubble-outline", go: "/new-post" },
              { label: "New marketplace listing", icon: "pricetag-outline", go: "/new-post?type=for_sale" },
              { label: "New forum topic", icon: "people-outline", go: "/hub/new?kind=forum" },
              { label: "New blog post", icon: "newspaper-outline", go: "/hub/new?kind=blog" },
              ...(canPostEvents(user) ? [{ label: "New event", icon: "calendar-outline", go: "/new-event" }] : []),
            ].map((o) => (
              <Pressable key={o.label} testID={`compose-${o.go}`} onPress={() => { setComposeOpen(false); router.push(o.go as any); }} style={styles.sheetRow}>
                <Icon name={o.icon as any} size={20} color={colors.teal}  footprint={20}/>
                <Text style={{ color: colors.onSurface, fontSize: 16, marginLeft: 12, flex: 1, flexShrink: 1 }}>{o.label}</Text>
              </Pressable>
            ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Month jump */}
    </View>
  );
}

function RemovableChip({ label, onRemove, testID }: { label: string; onRemove: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingLeft: 12, paddingRight: 4, paddingVertical: 5 }}>
      <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 12.5, maxWidth: 140 }} numberOfLines={1}>{label}</Text>
      <Pressable testID={`${testID}-remove`} onPress={onRemove} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove ${label}`}
        style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" }}>
        <Icon name="close" size={13} color={colors.muted} footprint={13} />
      </Pressable>
    </View>
  );
}

function HubCard({ item, rx, onPress, onReact, expanded, onOpenFull, onCompose, saved, onToggleSave }: { item: Item; rx?: { up: number; down: number; mine: number }; onPress: () => void; onReact?: (t: "post" | "discussion", id: string, value: number) => void; expanded?: boolean; onOpenFull?: () => void; onCompose?: () => void; saved?: boolean; onToggleSave?: (t: "post" | "discussion", id: string) => void }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const isSailingOpp = item._kind === "post" && item.type === "sailing_opportunity";
  const isAuthor = !!item.author_id && item.author_id === user?.user_id;
  const [found, setFound] = useState(!!item.found_crew);
  const [foundBusy, setFoundBusy] = useState(false);
  useEffect(() => { setFound(!!item.found_crew); }, [item.found_crew]);
  const toggleFound = async () => {
    if (foundBusy) return;
    const next = !found;
    setFoundBusy(true); setFound(next);
    try {
      await api.post(`/posts/${item.id}/${next ? "found-crew" : "still-looking"}`, {});
      toast.success(next ? "Marked as crew found" : "Back to looking for crew");
    } catch { setFound(!next); toast.error("Couldn't update"); }
    finally { setFoundBusy(false); }
  };
  const kindLabel: Record<string, string> = { post: "Post", forum: "Forum", blog: "Blog", event: "Volunteer", crew_open: "Crew", crew_standalone: "Crew" };
  const title = item.title || item.event_title || `${item.user_name || "Sailor"} - crew available`;
  const body = item.body || item.note || (item.positions ? `Positions: ${(item.positions || []).join(", ")}` : "");
  const author = item.author_name || item.user_name || item.organizer_name;
  const when = item.created_at || item.event_starts_at || item.starts_at;
  const reactable = ["post", "forum", "blog"].includes(item._kind);
  const rxType = item._kind === "post" ? "post" : "discussion";
  const { show: showPreview } = useProfilePreview();
  const authorHandle = item.author_handle || item.user_handle;
  const goAuthor = () => { if (authorHandle) showPreview(authorHandle, "/feed"); };
  return (
    <Pressable testID={`hub-card-${item.id || item.event_id}`} onPress={onPress} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, item.type === "for_sale" && item.sold ? { opacity: 0.55 } : null]}>
      {item.type === "for_sale" && item.sold ? (
        <View style={{ alignSelf: "flex-start", backgroundColor: "#334155", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginBottom: 6 }}>
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.6 }}>SOLD</Text>
        </View>
      ) : null}
      {item.type === "for_sale" && !item.sold && item.price_dropped_at && (Date.now() - new Date(item.price_dropped_at).getTime()) < 7 * 86400000 ? (
        <View style={{ alignSelf: "flex-start", backgroundColor: colors.accent, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginBottom: 6 }}>
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.6 }}>PRICE DROP</Text>
        </View>
      ) : null}
      <View style={styles.cardTop}>
        <Pressable onPress={goAuthor} disabled={!authorHandle} testID={authorHandle ? `author-link-${item.id || item.event_id}` : undefined}>
          <Avatar uri={item.author_avatar || item.user_avatar} name={author} size={36} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text onPress={authorHandle ? goAuthor : undefined} style={[styles.author, { color: colors.onSurface, flexShrink: 1 }]} numberOfLines={2}>{author || "Sail More Now"}</Text>
            <PartnerBadge kind={item.author_partner_badge || item.organizer_partner_badge} />
          </View>
          <Text style={[styles.meta, { color: colors.muted }]}>{(item.market ? item.market + " · " : "")}{fmtTimeAgo(when)}</Text>
        </View>
        <Badge label={kindLabel[item._kind] || "Post"} tone={item._kind === "blog" ? "accent" : "teal"} />
      </View>
      {item._kind === "post" && item.type === "for_sale" ? (
        (item.image_url || (Array.isArray(item.image_urls) && item.image_urls[0])) ? (
          <Image
            testID={`card-photo-${item.id}`}
            source={{ uri: item.image_url || item.image_urls[0] }}
            style={{ width: "100%", aspectRatio: 1, borderRadius: 12, marginBottom: 8, backgroundColor: colors.border }}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
          />
        ) : (
          <View testID={`card-photo-placeholder-${item.id}`}
            style={{ width: "100%", aspectRatio: 1, borderRadius: 12, marginBottom: 8, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" }}>
            <Icon name="image-outline" size={40} color={colors.muted} footprint={40} />
          </View>
        )
      ) : null}
      {title ? <Text style={[styles.title, { color: colors.onSurface, flexShrink: 1 }]} numberOfLines={expanded ? undefined : 2}>{title}</Text> : null}
      {item._kind === "post" && item.type === "for_sale" && (typeof item.price === "number" || item.condition) ? (
        <Text style={{ color: colors.accent, fontWeight: "800", fontSize: 14.5, marginBottom: 4 }} testID={`card-price-${item.id}`} numberOfLines={1}>
          {typeof item.price === "number" ? `$${item.price.toLocaleString()}` : ""}{item.condition ? `  ·  ${item.condition}` : ""}
        </Text>
      ) : null}
      {body ? <LinkifiedText text={body} numberOfLines={expanded ? undefined : 2} style={[styles.body, { color: colors.onSurfaceSecondary }]} /> : null}
      {isSailingOpp && (found || isAuthor) ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 }}>
          {found ? (
            <View testID={`crew-found-tag-${item.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.tealSoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 }}>
              <Icon name="success" size={13} color={colors.teal} footprint={13} />
              <Text style={{ color: colors.tealText || colors.teal, fontWeight: "800", fontSize: 11.5, letterSpacing: 0.3 }}>Crew found</Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          {isAuthor ? (
            <Pressable testID={`found-crew-toggle-${item.id}`} disabled={foundBusy} onPress={toggleFound}
              style={{ borderWidth: 1.5, borderColor: found ? colors.borderStrong : colors.teal, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
              <Text style={{ color: found ? colors.onSurface : colors.tealText || colors.teal, fontWeight: "800", fontSize: 12.5 }}>{found ? "Still looking" : "Found crew"}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {expanded && item.image_url ? <Image source={{ uri: item.image_url }} style={{ width: "100%", height: 180, borderRadius: 12, marginTop: 10 }} contentFit="cover" /> : null}
      {reactable ? (
        <View style={styles.cardFoot}>
          <Icon name="chatbubble-outline" size={14} color={colors.muted}  footprint={14}/>
          <Text style={[styles.meta, { color: colors.muted }]}>{item.comment_count || 0}</Text>
          <Pressable testID={`hub-react-up-${item.id}`} onPress={() => onReact?.(rxType, item.id, 1)} hitSlop={8} style={styles.reactBtn}>
            <Icon name={rx?.mine === 1 ? "thumbs-up" : "thumbs-up-outline"} size={14} color={rx?.mine === 1 ? colors.teal : colors.muted}  footprint={14}/>
            <Text testID={`hub-up-${item.id}`} style={[styles.meta, { color: rx?.mine === 1 ? colors.teal : colors.muted }]}>{rx?.up || 0}</Text>
          </Pressable>
          <Pressable testID={`hub-react-down-${item.id}`} onPress={() => onReact?.(rxType, item.id, -1)} hitSlop={8} style={[styles.reactBtn, { marginLeft: 12 }]}>
            <Icon name={rx?.mine === -1 ? "thumbs-down" : "thumbs-down-outline"} size={14} color={rx?.mine === -1 ? colors.accent : colors.muted}  footprint={14}/>
            <Text testID={`hub-down-${item.id}`} style={[styles.meta, { color: rx?.mine === -1 ? colors.accent : colors.muted }]}>{rx?.down || 0}</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          {onToggleSave ? (
            <Pressable testID={`save-${item.id}`} onPress={() => onToggleSave(item._kind === "post" ? "post" : "discussion", item.id)} hitSlop={8} style={{ marginRight: 12 }}>
              <Icon name={saved ? "bookmark" : "bookmark-outline"} size={16} color={saved ? colors.accent : colors.muted} footprint={16} />
            </Pressable>
          ) : null}
          <ReportButton targetType={item._kind === "post" ? "post" : "discussion"} targetId={item.id} ownerId={item.author_id} compact />
        </View>
      ) : null}
      {expanded ? (
        <View>
          <InlineComments targetId={item.id} allowComments={item.allow_comments !== false} onCompose={onCompose} />
          <Pressable testID={`open-full-${item.id}`} onPress={onOpenFull} style={{ marginTop: 10 }}>
            <Text style={{ color: colors.teal, fontWeight: "700", fontSize: 13 }}>Open full post →</Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  hTitle: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  marketBtn: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 160, backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  marketText: { color: "#fff", fontWeight: "700", fontSize: 12.5, maxWidth: 110 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 14 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  author: { fontWeight: "700", fontSize: 14.5 },
  meta: { fontSize: 12.5 },
  title: { fontSize: 16.5, fontWeight: "700", marginBottom: 4, letterSpacing: -0.2 },
  body: { fontSize: 14, lineHeight: 20 },
  cardFoot: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  reactBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 14 },
  monthHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, marginBottom: 2, paddingRight: 64 },
  monthTitle: { flex: 1, fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  fab: { position: "absolute", right: 20, bottom: 24, width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingVertical: 20, paddingHorizontal: 16, maxHeight: "70%" },
  sheetTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
  sheetRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.06)" },
});
