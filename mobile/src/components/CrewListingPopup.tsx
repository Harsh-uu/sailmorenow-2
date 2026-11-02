import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { Avatar, Button } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { displayPosition } from "@/src/lib/crewPositions";
import { useAuth } from "@/src/context/AuthContext";
import { canInteract } from "@/src/lib/plan";
import { useGo } from "@/src/lib/stackBase";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";
import { fmtDate } from "@/src/lib/format";

type Entry = Record<string, any> | null;
type EventContext = { id?: string; title?: string; starts_at?: string | null };

// Shared Crew Bank listing detail popup. Takes either a standalone Crew Bank
// entry or an event crew-pool entry and shows every field the sailor provided.
// Avatar/name link to the profile; Message (others) or Edit (your own listing).
let cachedAxes: any[] | null = null;

export function CrewListingPopup({
  visible,
  entry,
  eventContext,
  onClose,
}: {
  visible: boolean;
  entry: Entry;
  eventContext?: EventContext;
  onClose: () => void;
}) {
  const { colors, scheme } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const go = useGo();
  const isPaid = canInteract(user);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetMaxHeight = height * 0.88 - insets.top;
  const [headerH, setHeaderH] = useState(0);
  const [footerH, setFooterH] = useState(0);
  // Explicit, numeric body height so the ScrollView is reliably bounded on iOS
  // (do not rely on flex-shrink alone). 2px deadband prevents a layout loop.
  const onHeaderLayout = (e: any) => { const h = e.nativeEvent.layout.height; setHeaderH((p) => (Math.abs(p - h) > 2 ? h : p)); };
  const onFooterLayout = (e: any) => { const h = e.nativeEvent.layout.height; setFooterH((p) => (Math.abs(p - h) > 2 ? h : p)); };
  const bodyMaxHeight = Math.max(120, sheetMaxHeight - headerH - footerH);
  const [styleAxes, setStyleAxes] = useState<any[]>(cachedAxes || []);
  const pendingNav = useRef<null | (() => void)>(null);

  useEffect(() => {
    if (!visible || cachedAxes) return;
    api.get<{ sailing_style_axes?: any[] }>("/markets")
      .then((d) => { cachedAxes = d.sailing_style_axes || []; setStyleAxes(cachedAxes); })
      .catch(() => {});
  }, [visible]);

  if (!entry) {
    return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View /></Modal>;
  }

  const name: string = entry.user_name || "Sailor";
  const handle: string | undefined = entry.user_handle || undefined;
  const isMine = !!entry.user_id && entry.user_id === user?.user_id;
  // Event crew entries never show a Markets line (standalone listings keep
  // theirs). Event entries carry event_id.
  const isEvent = !!entry.event_id;
  const markets: string[] = Array.isArray(entry.markets) ? entry.markets : [];
  const marketLine = isEvent ? "" : (markets.length ? markets.join(" · ") : (entry.user_market || entry.user_primary_market || ""));
  const positions: string[] = entry.positions && entry.positions.length ? entry.positions : [];
  const expTypes: string[] = entry.experience_types || [];
  const style = entry.sailing_style || null;
  const contactVia: string = entry.contact_via || "in-app";
  const contactLabel = contactVia === "email" ? "Email" : "In-app message";

  // Defer navigation until the Modal has fully dismissed (iOS presentation bug).
  const runPending = () => { const fn = pendingNav.current; pendingNav.current = null; if (fn) fn(); };
  const closeThen = (fn: () => void) => { pendingNav.current = fn; onClose(); setTimeout(() => { if (pendingNav.current) runPending(); }, 400); };

  const openProfile = () => { if (handle) closeThen(() => go(`/u/${handle}`)); };

  const onMessage = () => {
    if (!isPaid) { toast.error("Upgrade to message"); closeThen(() => router.push("/pricing")); return; }
    closeThen(() => router.push({ pathname: "/messages/[id]", params: { id: entry.user_id, name } }));
  };

  const onEdit = () => {
    closeThen(() => {
      if (eventContext) {
        router.push({ pathname: "/crew-signup", params: { id: String(eventContext.id), title: eventContext.title || "" } });
      } else {
        router.push("/crew-listing");
      }
    });
  };

  const pill = (label: string, key: string) => (
    <View key={key} style={[styles.pill, { borderColor: scheme === "dark" ? colors.teal : colors.border, backgroundColor: scheme === "dark" ? colors.tealSoft : colors.surfaceTertiary }]}>
      <Text style={{ color: scheme === "dark" ? colors.onSurface : colors.onSurfaceSecondary, fontWeight: "600", fontSize: 12.5 }}>{label}</Text>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={runPending}>
      <View style={styles.root}>
        {/* Backdrop: SIBLING behind the sheet (absolute fill), not a wrapper */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} testID="crew-detail-backdrop" />
        {/* Sheet: plain View (no Pressable ancestor over the ScrollView) */}
        <View style={[styles.sheet, { backgroundColor: colors.surface, maxHeight: sheetMaxHeight }]}>
          {/* HEADER (fixed): avatar + name (tappable to profile) + Close X */}
          <View onLayout={onHeaderLayout} style={[styles.header, { borderBottomColor: colors.border }]}>
            <Pressable
              disabled={!handle}
              onPress={openProfile}
              testID={handle ? `crew-detail-profile-${entry.user_id}` : undefined}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}
            >
              <Avatar uri={entry.user_avatar} name={name} size={56} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ color: colors.onSurface, fontWeight: "800", fontSize: 18, flexShrink: 1 }}>{name}</Text>
                  {entry.user_verified ? <Icon name="verified" size={16} color={colors.teal} footprint={16} /> : null}
                </View>
                {marketLine ? <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>{marketLine}</Text> : null}
              </View>
              {handle ? <Icon name="chevron-right" size={20} color={colors.borderStrong} footprint={20} /> : null}
            </Pressable>
            <Pressable onPress={onClose} testID="crew-detail-close-x" accessibilityLabel="Close" accessibilityRole="button" hitSlop={10} style={styles.closeX}>
              <Icon name="close" size={22} color={colors.onSurfaceSecondary} footprint={44} />
            </Pressable>
          </View>

          {/* BODY (scrolling, explicitly bounded) */}
          <ScrollView
            style={{ maxHeight: bodyMaxHeight, flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 16 }}
            scrollEnabled
            nestedScrollEnabled
            bounces
            alwaysBounceVertical
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            testID={`crew-detail-${entry.user_id}`}
          >
            {eventContext?.title ? (
              <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, marginTop: 6 }}>
                Crew for: {eventContext.title}{eventContext.starts_at ? `, ${fmtDate(eventContext.starts_at)}` : ""}
              </Text>
            ) : null}

            {entry.user_bio ? <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, marginTop: 10 }}>{entry.user_bio}</Text> : null}

            <Text style={styles.label}>POSITIONS</Text>
            <View style={styles.pillRow}>{positions.length ? positions.map((p) => pill(displayPosition(p), `pos-${p}`)) : (
              <Text style={{ color: colors.muted, fontSize: 12.5 }}>Not specified</Text>
            )}</View>

            {expTypes.length ? (
              <>
                <Text style={styles.label}>SAILING EXPERIENCE</Text>
                <View style={styles.pillRow}>{expTypes.map((t: string) => pill(t, `exp-${t}`))}</View>
              </>
            ) : null}

            {style && styleAxes.length ? (
              <>
                <Text style={styles.label}>SAILING STYLE</Text>
                {styleAxes.filter((ax: any) => style[ax.key]).map((ax: any) => (
                  <View key={ax.key} style={{ marginBottom: 10 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: colors.muted, fontSize: 10.5, flex: 1 }}>{ax.low}</Text>
                      <Text style={{ color: colors.muted, fontSize: 10.5, flex: 1, textAlign: "right" }}>{ax.high}</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 5, marginTop: 4 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <View key={n} style={{ flex: 1, height: 7, borderRadius: 4, backgroundColor: style[ax.key] === n ? colors.teal : colors.surfaceTertiary }} />
                      ))}
                    </View>
                  </View>
                ))}
              </>
            ) : null}

            {entry.experience ? (<><Text style={styles.label}>EXPERIENCE</Text><Text style={{ color: colors.onSurfaceSecondary, fontSize: 14 }}>{entry.experience}</Text></>) : null}
            {entry.availability ? (<><Text style={styles.label}>AVAILABILITY</Text><Text style={{ color: colors.onSurfaceSecondary, fontSize: 14 }}>{entry.availability}</Text></>) : null}
            {entry.notes ? (<><Text style={styles.label}>NOTES FOR THE SKIPPER</Text><Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, fontStyle: "italic" }}>&ldquo;{entry.notes}&rdquo;</Text></>) : null}

            <Text style={styles.label}>CONTACT</Text>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14 }}>Prefers contact via: {contactLabel}</Text>
            {entry.user_email ? <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, marginTop: 2 }}>{entry.user_email}</Text> : null}
          </ScrollView>

          {/* FOOTER (fixed) */}
          <View onLayout={onFooterLayout} style={[styles.footer, { paddingBottom: insets.bottom + 12, borderTopColor: colors.border }]}>
            {isMine ? (
              <Button title="Edit listing" variant="primary" icon="create-outline" testID={`crew-detail-edit-${entry.user_id}`} onPress={onEdit} />
            ) : (
              <Button title={`Message ${name.split(" ")[0] || "sailor"}`} variant="primary" icon="mail-outline" testID={`crew-detail-msg-${entry.user_id}`} onPress={onMessage} />
            )}
            <View style={{ height: 10 }} />
            <Pressable onPress={onClose} testID="crew-detail-close"
              style={{ borderWidth: 1.5, borderColor: colors.borderStrong, borderRadius: 999, paddingVertical: 12, alignItems: "center" }}>
              <Text maxFontSizeMultiplier={1.2} style={{ color: colors.onSurface, fontWeight: "800", fontSize: 15 }}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 20, paddingRight: 12, paddingTop: 18, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  closeX: { alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: "#94a3b8", marginTop: 16, marginBottom: 6 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
});
