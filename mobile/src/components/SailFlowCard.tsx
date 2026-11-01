import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { Icon } from "@/src/components/Icon";
import { api } from "@/src/lib/api";
import { useTheme } from "@/src/theme";

type Station = { market: string; station?: string | null; url?: string | null; embed_url?: string | null; is_default?: boolean };

// Home-screen SailFlow weather card. Opens the nearest station's live wind page
// in the device browser. Mapping is editable in backend/sailflow_stations.py.
export function SailFlowCard({ market }: { market?: string | null }) {
  const { colors } = useTheme();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<Station | null>(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    api.get<Station>(`/sailflow/station${market ? `?market=${encodeURIComponent(market)}` : ""}`)
      .then((d) => { if (alive) { setData(d); setState(d?.url ? "ready" : "error"); } })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [market]);

  const open = () => { if (data?.url) Linking.openURL(data.url).catch(() => {}); };
  const [embedFailed, setEmbedFailed] = useState(false);
  const showEmbed = state === "ready" && !!data?.embed_url && !embedFailed && Platform.OS !== "web";

  return (
    <View style={{ marginBottom: 14 }}>
      <View testID="sailflow-card" style={[styles.card, { backgroundColor: colors.brandPrimary, marginBottom: showEmbed ? 0 : 14 }]}>
        <View style={[styles.iconWrap, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
          <Icon name="speedometer-outline" size={22} color="#fff" footprint={22} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow}>LIVE WIND · SAILFLOW</Text>
          {state === "loading" ? (
            <ActivityIndicator testID="sailflow-loading" color="#7fcac4" style={{ alignSelf: "flex-start", marginTop: 6 }} />
          ) : state === "error" ? (
            <Text testID="sailflow-error" style={styles.station}>Wind conditions unavailable</Text>
          ) : (
            <>
              <Text testID="sailflow-station" style={styles.station} numberOfLines={1}>{data?.station}</Text>
              <Text style={styles.market} numberOfLines={1}>{data?.market}{data?.is_default ? " (nearest station)" : ""}</Text>
            </>
          )}
        </View>
        <Pressable testID="sailflow-open-btn" onPress={state === "ready" ? open : () => Linking.openURL("https://sailflow.com").catch(() => {})}
                   style={[styles.btn, { backgroundColor: colors.accent }]}>
          <Icon name="open-outline" size={16} color={colors.onAccent} footprint={16} />
        </Pressable>
      </View>
      {showEmbed ? (
        <View testID="sailflow-embed" style={{ height: 260, borderBottomLeftRadius: 18, borderBottomRightRadius: 18, overflow: "hidden" }}>
          <WebView source={{ uri: data!.embed_url! }} onError={() => setEmbedFailed(true)} onHttpError={() => setEmbedFailed(true)}
                   startInLoadingState renderLoading={() => <View style={{ flex: 1, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color="#7fcac4" /></View>} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, padding: 14, marginBottom: 14 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: "#7fcac4", fontWeight: "800", fontSize: 10.5, letterSpacing: 1.2 },
  station: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: -0.2, marginTop: 3 },
  market: { color: "#CBD5E1", fontSize: 12.5, marginTop: 1 },
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
