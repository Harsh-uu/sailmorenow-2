import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Icon } from "@/src/components/Icon";
import { useTheme } from "@/src/theme";
import { useAuth } from "@/src/context/AuthContext";
import { canInteract } from "@/src/lib/plan";

export type RosterPerson = {
  id?: string;
  user_id: string;
  user_name?: string | null;
  user_handle?: string | null;
  user_email?: string | null;
  user_phone?: string | null;
};

// One person in an event roster (volunteer or RSVP). Name links to the profile
// (when the account has a handle); email and phone are shown to the host only
// (the server returns them in the "full" scope). Message opens the one-to-one
// thread for paid hosts; for free hosts it reveals an inline upgrade line with a
// "See plans" link to Pricing (no automatic redirect, no popup).
export function RosterRow({ person }: { person: RosterPerson }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const paid = canInteract(user);
  const name = person.user_name || "Sailor";

  const openProfile = () => {
    if (person.user_handle) router.push({ pathname: "/u/[handle]", params: { handle: person.user_handle } } as any);
  };
  const onMessage = () => {
    if (paid) {
      router.push({ pathname: "/messages/[id]", params: { id: person.user_id, name } } as any);
      return;
    }
    setShowUpgrade(true);
  };

  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]} testID={`roster-person-${person.user_id}`}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {person.user_handle ? (
          <Pressable testID={`roster-profile-${person.user_id}`} onPress={openProfile} hitSlop={6}>
            <Text style={{ color: colors.teal, fontWeight: "800", fontSize: 14 }}>{name}</Text>
          </Pressable>
        ) : (
          <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 14 }}>{name}</Text>
        )}
        {person.user_email ? (
          <Pressable testID={`roster-email-${person.user_id}`} onPress={() => Linking.openURL(`mailto:${person.user_email}`)} hitSlop={6}>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 12.5, marginTop: 3 }}>{person.user_email}</Text>
          </Pressable>
        ) : null}
        {person.user_phone ? (
          <Pressable testID={`roster-phone-${person.user_id}`} onPress={() => Linking.openURL(`tel:${person.user_phone}`)} hitSlop={6}>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 12.5, marginTop: 2 }}>{person.user_phone}</Text>
          </Pressable>
        ) : null}
        {showUpgrade ? (
          <Text testID={`roster-upgrade-${person.user_id}`} style={{ color: colors.muted, fontSize: 12.5, marginTop: 8, lineHeight: 18 }}>
            Upgrade to message volunteers and attendees directly.{" "}
            <Text testID={`roster-see-plans-${person.user_id}`} onPress={() => router.push("/pricing" as any)} style={{ color: colors.teal, fontWeight: "800" }}>See plans</Text>
          </Text>
        ) : null}
      </View>
      <Pressable testID={`roster-message-${person.user_id}`} onPress={onMessage} style={[styles.msgBtn, { borderColor: colors.brandPrimary }]} hitSlop={6}>
        <Icon name="mail-outline" size={14} color={colors.brandPrimary} footprint={14} />
        <Text style={{ color: colors.brandPrimary, fontWeight: "800", fontSize: 12 }}>Message</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  msgBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
});
