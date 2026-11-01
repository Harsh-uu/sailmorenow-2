import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { Icon } from "@/src/components/Icon";
import { EmptyState, Loading } from "@/src/components/ui";
import { RosterRow } from "@/src/components/RosterRow";
import { api } from "@/src/lib/api";
import { useTheme } from "@/src/theme";

// Full-screen host roster opened from an "event_rsvp" notification (and from the
// My Events roster). `kind` picks the volunteer list vs the RSVP (attendee) list.
export default function EventRoster() {
  const { colors } = useTheme();
  const { id, kind } = useLocalSearchParams<{ id?: string; kind?: string }>();
  const isVol = kind === "volunteer";
  const [regs, setRegs] = useState<any[] | null>(null);

  const load = useCallback(() => {
    if (!id) { setRegs([]); return; }
    api.get<any>(`/events/${id}/registrations`).then((d) => setRegs(d.registrations || [])).catch(() => setRegs([]));
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const people = (regs || []).filter((r) => (isVol ? r.kind === "volunteer" : r.kind !== "volunteer"));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.brandPrimary }}>
        <View style={styles.header}>
          <Pressable testID="roster-back" onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
            <Icon name="chevron-back" size={24} color={colors.onBrandPrimary} footprint={24} />
          </Pressable>
          <Text style={[styles.hTitle, { color: colors.onBrandPrimary }]}>{isVol ? "Volunteers" : "RSVPs"}</Text>
          <View style={{ width: 28 }} />
        </View>
      </SafeAreaView>

      {regs === null ? (
        <Loading />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(r) => r.id || r.user_id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}
          ListEmptyComponent={
            <View style={{ paddingTop: 60 }}>
              <EmptyState icon="people-outline" title={isVol ? "No volunteers yet" : "No RSVPs yet"} subtitle="People appear here as they sign up." />
            </View>
          }
          renderItem={({ item }) => <RosterRow person={item} />}
          testID="event-roster-list"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 12 },
  hTitle: { fontSize: 18, fontWeight: "800" },
});
