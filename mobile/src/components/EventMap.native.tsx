import { StyleSheet, Text, View } from "react-native";
import MapView from "react-native-map-clustering";
import { Marker, PROVIDER_DEFAULT, UrlTile } from "react-native-maps";

type Ev = { id: string; title?: string; lat?: number | null; lng?: number | null; location?: string; market?: string };

// PNW default region (Puget Sound) when no pinned events are available.
const DEFAULT = { latitude: 47.62, longitude: -122.35, latitudeDelta: 3.2, longitudeDelta: 3.2 };

// Nearby event pins are clustered (supercluster) so busy markets stay readable;
// zooming in splits clusters back into individual venue markers.
export default function EventMap({ events, onOpen }: { events: Ev[]; onOpen?: (id: string) => void }) {
  const pinned = events.filter((e) => typeof e.lat === "number" && typeof e.lng === "number");
  const first = pinned[0];
  const region = first
    ? { latitude: first.lat as number, longitude: first.lng as number, latitudeDelta: 1.2, longitudeDelta: 1.2 }
    : DEFAULT;
  return (
    <View style={styles.wrap} testID="event-map">
      <MapView
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={region}
        clusterColor="#1F3F5B"
        clusterTextColor="#ffffff"
        radius={48}
        spiralEnabled
        renderCluster={(cluster: any) => {
          const { id, geometry, onPress, properties } = cluster;
          const count = properties.point_count;
          return (
            <Marker key={`cluster-${id}`} coordinate={{ longitude: geometry.coordinates[0], latitude: geometry.coordinates[1] }} onPress={onPress}>
              <View style={styles.cluster}>
                <Text allowFontScaling={false} style={styles.clusterText} numberOfLines={1}>{count}</Text>
              </View>
            </Marker>
          );
        }}
      >
        <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} flipY={false} />
        {pinned.map((e) => (
          <Marker
            key={e.id}
            coordinate={{ latitude: e.lat as number, longitude: e.lng as number }}
            title={e.title}
            description={e.location || e.market}
            onCalloutPress={() => onOpen?.(e.id)}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 460, borderRadius: 18, overflow: "hidden", margin: 16, marginTop: 8 },
  cluster: { minWidth: 36, height: 36, paddingHorizontal: 6, borderRadius: 18, backgroundColor: "#1F3F5B", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#ffffff" },
  clusterText: { color: "#ffffff", fontWeight: "800", fontSize: 13 },
});
