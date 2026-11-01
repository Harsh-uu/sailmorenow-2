import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { Badge, Button, EmptyState, Loading } from "@/src/components/ui";
import { api, ApiError } from "@/src/lib/api";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";
import { displayPosition } from "@/src/lib/crewPositions";
import { fmtDate } from "@/src/lib/format";

type Listing = {
  kind: "standalone" | "event";
  positions?: string[];
  status?: string;
  markets?: string[];
  updated_at?: string;
  created_at?: string;
  expires_at?: string | null;
  is_expired?: boolean;
  event_id?: string;
  event_name?: string;
  event_starts_at?: string;
};

function daysLeft(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

export default function MyCrewListings() {
  const { colors } = useTheme();
  const toast = useToast();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ listings: Listing[] }>("/crew-bank/mine");
      setListings(d.listings || []);
    } catch {
      setListings([]);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (fn: () => Promise<any>, okMsg?: string) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  };

  const confirmRemove = (title: string, fn: () => Promise<any>) => {
    Alert.alert(title, "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => run(fn, "Removed.") },
    ]);
  };

  return (
    <Screen title="My Crew Listings" showBack padded={false}>
      {listings === null ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text style={[styles.lead, { color: colors.onSurfaceSecondary }]}>
            Your standalone Crew Bank listing and every event crew sign-up, in one place.
          </Text>

          {listings.length === 0 ? (
            <View style={{ paddingTop: 40 }}>
              <EmptyState icon="people-outline" title="You have no crew listings yet." subtitle="List yourself in the Crew Bank to get discovered." />
              <Button title="Go to Crew Bank" variant="primary" onPress={() => router.push("/crew-bank")} testID="my-crew-empty-cta" style={{ marginTop: 16, alignSelf: "center" }} />
            </View>
          ) : (
            listings.map((l) => {
              const key = l.kind === "event" ? `event-${l.event_id}` : "standalone";
              const isFound = l.status === "found";
              const positions = (l.positions || []).map(displayPosition).join(", ") || "Any position";
              return (
                <View key={key} testID={`crew-row-${key}`} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <Badge label={l.kind === "event" ? "Event" : "Standalone"} tone="muted" />
                    <Badge label={isFound ? "Found" : "Seeking"} tone={isFound ? "teal" : "accent"} />
                  </View>
                  <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 15 }}>
                    {l.kind === "event" ? (l.event_name || "Event crew") : "Standalone crew listing"}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: 3 }}>{positions}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 4 }}>
                    {(l.markets || []).slice(0, 3).join(" · ")}
                    {l.kind === "event" && l.event_starts_at ? ` · ${fmtDate(l.event_starts_at)}` : ""}
                    {l.kind === "standalone" && l.expires_at ? ` · ${l.is_expired ? "Expired" : `Expires in ${daysLeft(l.expires_at)} days`}` : ""}
                  </Text>

                  <View style={styles.actions}>
                    {l.kind === "standalone" ? (
                      <>
                        <Button title="Edit" variant="secondary" icon="create-outline" onPress={() => router.push("/crew-listing")} disabled={busy} style={styles.btn} testID="crew-standalone-edit" />
                        {isFound
                          ? <Button title="Seeking" variant="secondary" onPress={() => run(() => api.patch("/crew-bank/standalone/status", { status: "seeking" }), "Back to seeking.")} disabled={busy} style={styles.btn} testID="crew-standalone-seeking" />
                          : <Button title="Found" variant="secondary" icon="checkmark" onPress={() => run(() => api.patch("/crew-bank/standalone/status", { status: "found" }), "Marked as found.")} disabled={busy} style={styles.btn} testID="crew-standalone-found" />}
                        <Button title="Renew" variant="secondary" icon="refresh" onPress={() => run(() => api.post("/crew-bank/standalone/renew", {}), "Refreshed for 90 days.")} disabled={busy} style={styles.btn} testID="crew-standalone-renew" />
                        <Button title="Remove" variant="danger" icon="trash-outline" onPress={() => confirmRemove("Remove your crew listing?", () => api.del("/crew-bank/standalone"))} disabled={busy} style={styles.btn} testID="crew-standalone-remove" />
                      </>
                    ) : (
                      <>
                        <Button title="Open" variant="secondary" icon="open-outline" onPress={() => router.push(`/events/${l.event_id}` as any)} disabled={busy} style={styles.btn} testID={`crew-event-open-${l.event_id}`} />
                        {isFound
                          ? <Button title="Seeking" variant="secondary" onPress={() => run(() => api.patch(`/events/${l.event_id}/crew/status`, { status: "seeking" }), "Back to seeking.")} disabled={busy} style={styles.btn} testID={`crew-event-seeking-${l.event_id}`} />
                          : <Button title="Found" variant="secondary" icon="checkmark" onPress={() => run(() => api.patch(`/events/${l.event_id}/crew/status`, { status: "found" }), "Marked as found.")} disabled={busy} style={styles.btn} testID={`crew-event-found-${l.event_id}`} />}
                        <Button title="Remove" variant="danger" icon="trash-outline" onPress={() => confirmRemove("Remove your crew sign-up?", () => api.del(`/events/${l.event_id}/crew`))} disabled={busy} style={styles.btn} testID={`crew-event-remove-${l.event_id}`} />
                      </>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 14, marginBottom: 16, lineHeight: 20 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  btn: { width: "47%", height: 44 },
});
