import { Pressable, Text, View, StyleSheet } from "react-native";
import { router } from "expo-router";

import { Icon } from "@/src/components/Icon";
import { useTheme } from "@/src/theme";
import { useNotifications } from "@/src/context/NotificationsContext";

// Shared notification bell for every main tab header. One bell per screen (never
// two). 44px touch target; badge shows the unread count, "9+" above 9, hidden at
// zero. `href` lets the Hub keep its in-stack notifications route.
export function NotificationBell({ href = "/notifications", color }: { href?: string; color?: string }) {
  const { colors } = useTheme();
  const { unread } = useNotifications();
  const tint = color || colors.onBrandPrimary;
  return (
    <Pressable
      testID="notifications-btn"
      onPress={() => router.push(href as any)}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      style={styles.btn}
    >
      <Icon name="notifications-outline" size={22} color={tint} footprint={22} />
      {unread > 0 ? (
        <View testID="notifications-badge" style={[styles.badge, { backgroundColor: colors.accent, borderColor: colors.brandPrimary }]}>
          <Text style={[styles.badgeText, { color: colors.onAccent }]}>{unread > 9 ? "9+" : String(unread)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute", top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderWidth: 1.5,
  },
  badgeText: { fontSize: 10, fontWeight: "800" },
});

export default NotificationBell;
