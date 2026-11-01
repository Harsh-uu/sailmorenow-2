import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/src/components/Icon";
import { useTheme } from "@/src/theme";

type Ev = { id: string; title?: string; lat?: number | null; lng?: number | null; location?: string; market?: string };

// react-native-maps has no web implementation; on the web preview we show the
// pinned events as a list with links to OpenStreetMap. Native builds get the map.
export default function EventMap({ events, onOpen }: { events: Ev[]; onOpen?: (id: string) => void }) {
  const { colors } = useTheme();
  const pinned = events.filter((e) => typeof e.lat === "number" && typeof e.lng === "number");
  return (
    <View style={{ padding: 16, paddingTop: 8 }} testID="event-map">
      <View style={[styles.note, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Icon name="map" size={18} color={colors.teal} footprint={18} />
        <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, flex: 1 }}>The interactive map opens in the mobile app. Here are the pinned venues:</Text>
      </View>
      {pinned.map((e) => (
        <Pressable
          key={e.id}
          testID={`map-pin-${e.id}`}
          onPress={() => onOpen?.(e.id)}
          style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Icon name="location" size={18} color={colors.teal} footprint={18} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.onSurface, fontWeight: "700" }} numberOfLines={1}>{e.title}</Text>
            <Text style={{ color: colors.muted, fontSize: 12.5 }} numberOfLines={1}>{e.location || e.market}</Text>
          </View>
          <Pressable onPress={() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=15/${e.lat}/${e.lng}`)} hitSlop={8}>
            <Icon name="external-link" size={16} color={colors.muted} footprint={16} />
          </Pressable>
        </Pressable>
      ))}
      {pinned.length === 0 && <Text style={{ color: colors.muted, textAlign: "center", paddingVertical: 20 }}>No mapped venues yet.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  note: { flexDirection: "row", gap: 10, alignItems: "center", borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 },
  row: { flexDirection: "row", gap: 10, alignItems: "center", borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 8 },
});
