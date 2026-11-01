import React from "react";
import { View, StyleProp, ViewStyle } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme, ThemeColors } from "@/src/theme";
import Burgee from "@/src/components/icons/Burgee";

/**
 * Unified mobile icon. Single source of truth for iconography on the mobile
 * surface — mirrors frontend/src/components/Icon.jsx (identical semantic
 * `name`s so web + mobile stay in lockstep). New code should ALWAYS import
 * from here and never from "@expo/vector-icons" directly (ESLint guard).
 *
 * Most glyphs are Ionicons; a few come from MaterialCommunityIcons (same
 * @expo/vector-icons package): boatOwner -> sail-boat, boatPro/directory ->
 * handshake-outline. org/partner use our custom Burgee (react-native-svg).
 *
 * The wrapper owns a square 48pt touch footprint by default (pass
 * footprint={size} for a purely inline/decorative glyph or a tab-bar icon).
 */

type IoniconName = keyof typeof Ionicons.glyphMap;
type MciName = keyof typeof MaterialCommunityIcons.glyphMap;
type Entry =
  | { fam: "ion"; glyph: IoniconName }
  | { fam: "mci"; glyph: MciName }
  | { fam: "custom"; Comp: React.ComponentType<{ size?: number; color?: string }> };

export type IconName =
  | "crew" | "boatOwner" | "boatPro" | "directory" | "hub" | "community"
  | "verified" | "org" | "partner" | "reviews" | "messages" | "events"
  | "edit" | "delete" | "close" | "share" | "send" | "search" | "location"
  | "profile" | "notifications" | "menu" | "logout" | "myListing" | "myEvents"
  | "chevron-right" | "chevron-left" | "chevron-down" | "add"
  | "check" | "checkDouble" | "visibility" | "visibilityOff"
  | "success" | "error" | "info" | "warning";

export const ICONS: Record<IconName, Entry> = {
  crew: { fam: "ion", glyph: "people-outline" },
  boatOwner: { fam: "mci", glyph: "sail-boat" },
  boatPro: { fam: "mci", glyph: "handshake-outline" },
  directory: { fam: "mci", glyph: "handshake-outline" },
  hub: { fam: "ion", glyph: "compass-outline" },
  community: { fam: "ion", glyph: "compass-outline" },
  verified: { fam: "ion", glyph: "shield-checkmark" },
  org: { fam: "custom", Comp: Burgee },
  partner: { fam: "custom", Comp: Burgee },
  reviews: { fam: "ion", glyph: "star" },
  messages: { fam: "ion", glyph: "chatbubble-outline" },
  events: { fam: "ion", glyph: "calendar-outline" },
  edit: { fam: "ion", glyph: "create-outline" },
  delete: { fam: "ion", glyph: "trash-outline" },
  close: { fam: "ion", glyph: "close" },
  share: { fam: "ion", glyph: "share-outline" },
  send: { fam: "ion", glyph: "send" },
  search: { fam: "ion", glyph: "search-outline" },
  location: { fam: "ion", glyph: "location-outline" },
  profile: { fam: "ion", glyph: "person-circle-outline" },
  notifications: { fam: "ion", glyph: "notifications-outline" },
  menu: { fam: "ion", glyph: "menu" },
  logout: { fam: "ion", glyph: "log-out-outline" },
  myListing: { fam: "ion", glyph: "briefcase-outline" },
  myEvents: { fam: "ion", glyph: "megaphone-outline" },
  "chevron-right": { fam: "ion", glyph: "chevron-forward" },
  "chevron-left": { fam: "ion", glyph: "chevron-back" },
  "chevron-down": { fam: "ion", glyph: "chevron-down" },
  add: { fam: "ion", glyph: "add" },
  check: { fam: "ion", glyph: "checkmark" },
  checkDouble: { fam: "ion", glyph: "checkmark-done" },
  visibility: { fam: "ion", glyph: "eye-outline" },
  visibilityOff: { fam: "ion", glyph: "eye-off-outline" },
  success: { fam: "ion", glyph: "checkmark-circle" },
  error: { fam: "ion", glyph: "alert-circle" },
  info: { fam: "ion", glyph: "information-circle" },
  warning: { fam: "ion", glyph: "warning" },
};

export type IconTone = "default" | "muted" | "accent" | "brand" | "onAccent" | "disabled";

function toneColor(colors: ThemeColors, tone: IconTone): string {
  switch (tone) {
    case "muted": return colors.muted;
    case "accent": return colors.accent;
    case "brand": return colors.teal;
    case "onAccent": return colors.onAccent;
    case "disabled": return colors.borderStrong;
    default: return colors.onSurface;
  }
}

export function Icon({
  name,
  size = 22,
  tone = "default",
  color,
  label,
  footprint,
  style,
  testID,
}: {
  name: IconName | (string & {});
  size?: number;
  tone?: IconTone;
  color?: string;
  label?: string;
  footprint?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors } = useTheme();
  const entry = (ICONS as Record<string, Entry>)[name];
  const resolved = color ?? toneColor(colors, tone);
  const box = footprint ?? Math.max(size, 48);
  const a11y = label
    ? { accessible: true, accessibilityRole: "image" as const, accessibilityLabel: label }
    : { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };

  return (
    <View
      testID={testID}
      style={[{ width: box, height: box, alignItems: "center", justifyContent: "center" }, style]}
      {...a11y}
    >
      {!entry ? (
        <Ionicons name={name as IoniconName} size={size} color={resolved} />
      ) : entry.fam === "ion" ? (
        <Ionicons name={entry.glyph} size={size} color={resolved} />
      ) : entry.fam === "mci" ? (
        <MaterialCommunityIcons name={entry.glyph} size={size} color={resolved} />
      ) : (
        <entry.Comp size={size} color={resolved} />
      )}
    </View>
  );
}

export default Icon;
