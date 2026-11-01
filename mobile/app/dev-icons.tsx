import { useState } from "react";
import { ScrollView, View, Text, StyleSheet, TextInput } from "react-native";
import { ICONS, Icon, IconName, IconTone } from "@/src/components/Icon";
import { useTheme } from "@/src/theme";

const TONES: IconTone[] = ["default", "muted", "accent", "brand", "onAccent", "disabled"];
const ALL = Object.keys(ICONS) as IconName[];

/**
 * Hidden developer gallery (mobile): every semantic icon across all tones,
 * with a name filter. Unlinked route (/dev-icons). Mirrors the web gallery.
 */
export default function DevIcons() {
  const { colors } = useTheme();
  const [q, setQ] = useState("");
  const names = ALL.filter((n) => n.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, paddingTop: 60, paddingBottom: 60 }}
      testID="dev-icon-gallery"
    >
      <Text style={{ fontSize: 24, fontWeight: "800", color: colors.onSurface }}>Icon Gallery</Text>
      <Text style={{ color: colors.muted, marginTop: 4, marginBottom: 12 }}>
        {ALL.length} semantic icons × {TONES.length} tones · onAccent shown on an orange swatch
      </Text>
      <TextInput
        testID="icon-filter"
        value={q}
        onChangeText={setQ}
        placeholder="Filter icons by name…"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 999,
          paddingHorizontal: 16,
          paddingVertical: 10,
          color: colors.onSurface,
          marginBottom: 16,
        }}
      />
      {names.length === 0 ? (
        <Text style={{ color: colors.muted, paddingVertical: 24 }} testID="icon-empty">
          No icons match “{q}”.
        </Text>
      ) : null}
      {names.map((n) => (
        <View
          key={n}
          style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 12 }}
        >
          <Text style={{ color: colors.onSurface, fontWeight: "700", marginBottom: 8 }}>{n}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {TONES.map((t) => (
              <View key={t} style={{ alignItems: "center", width: 58, marginBottom: 8 }}>
                <View
                  style={{
                    padding: 6,
                    borderRadius: 10,
                    backgroundColor: t === "onAccent" ? colors.accent : colors.surfaceTertiary,
                  }}
                >
                  <Icon name={n} size={24} tone={t} footprint={30} label={`${n} ${t}`} />
                </View>
                <Text style={{ color: colors.muted, fontSize: 9, marginTop: 3 }}>{t}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
