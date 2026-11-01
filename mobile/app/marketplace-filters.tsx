import { useState } from "react";
import { DeviceEventEmitter, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { Chip } from "@/src/components/ui";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

const CONDITIONS = ["New", "Like New", "Good", "Fair", "For parts"];
export const MP_FILTERS_EVT = "marketplace-filters";

// Full-screen Marketplace filters (was a trapping Modal in the feed). Same
// fields, the numeric keyboard for prices, and the Clear / Save / Apply
// behavior. Apply and Clear report back to the feed via DeviceEventEmitter.
export default function MarketplaceFiltersScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const params = useLocalSearchParams<{ q?: string; min?: string; max?: string; cond?: string; market?: string }>();
  const market = typeof params.market === "string" ? params.market : "";
  const [q, setQ] = useState(typeof params.q === "string" ? params.q : "");
  const [min, setMin] = useState(typeof params.min === "string" ? params.min : "");
  const [max, setMax] = useState(typeof params.max === "string" ? params.max : "");
  const [cond, setCond] = useState(typeof params.cond === "string" ? params.cond : "");
  const searchKb = useKbField("mp-search");
  const priceKb = useKbField("mp-price");

  const apply = () => {
    DeviceEventEmitter.emit(MP_FILTERS_EVT, { type: "apply", q: q.trim(), min, max, cond });
    router.back();
  };

  const clear = () => {
    setQ(""); setMin(""); setMax(""); setCond("");
    DeviceEventEmitter.emit(MP_FILTERS_EVT, { type: "clear" });
  };

  const saveSearch = async () => {
    try {
      await api.post("/marketplace/searches", {
        q: q.trim() || null, condition: cond || null,
        min_price: min !== "" ? Number(min) : null,
        max_price: max !== "" ? Number(max) : null,
        market: market && !["all", "mine"].includes(market) ? market : null,
      });
      toast.success("Search saved, we'll notify you when matching gear is listed");
    } catch (e: any) {
      toast.error(e?.message || "Add a filter first");
    }
  };

  return (
    <KeyboardFormScreen
      title="Filters"
      testID="marketplace-filters-form"
      footer={
        <View style={styles.footerRow}>
          <Pressable testID="marketplace-clear" onPress={clear} hitSlop={8} style={styles.clearBtn}>
            <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 14 }}>Clear</Text>
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            {user ? (
              <Pressable testID="save-search-btn" onPress={saveSearch} hitSlop={8}>
                <Text style={{ color: colors.teal, fontWeight: "700", fontSize: 14 }}>Save</Text>
              </Pressable>
            ) : null}
            <Pressable testID="marketplace-apply" onPress={apply}
              style={{ backgroundColor: colors.brandPrimary, borderRadius: 999, paddingHorizontal: 24, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: colors.onBrandPrimary, fontWeight: "800", fontSize: 14 }}>Apply</Text>
            </Pressable>
          </View>
        </View>
      }
    >
      <View onLayout={searchKb.onLayout}>
        <View style={[styles.mpSearch, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
          <Icon name="search" size={16} color={colors.muted} footprint={16} />
          <TextInput testID="marketplace-search" value={q} onFocus={searchKb.onFocus} onChangeText={setQ}
            placeholder="Search gear..." placeholderTextColor={colors.muted}
            style={{ flex: 1, color: colors.onSurface, fontSize: 14.5 }} />
          {q ? (
            <Pressable testID="marketplace-search-clear" onPress={() => setQ("")} hitSlop={8}>
              <Icon name="close" size={16} color={colors.muted} footprint={16} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View onLayout={priceKb.onLayout} style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <TextInput testID="marketplace-min-price" value={min} onFocus={priceKb.onFocus} onChangeText={setMin}
          placeholder="Min $" keyboardType="numeric" placeholderTextColor={colors.muted}
          style={[styles.mpPrice, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface }]} />
        <TextInput testID="marketplace-max-price" value={max} onFocus={priceKb.onFocus} onChangeText={setMax}
          placeholder="Max $" keyboardType="numeric" placeholderTextColor={colors.muted}
          style={[styles.mpPrice, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface }]} />
      </View>

      <Text style={[styles.label, { color: colors.onSurface }]}>Condition</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
        <Chip label="Any condition" active={!cond} onPress={() => setCond("")} testID="mp-cond-any" />
        {CONDITIONS.map((c) => (
          <Chip key={c} label={c} active={cond === c} onPress={() => setCond(cond === c ? "" : c)} testID={`mp-cond-${c}`} />
        ))}
      </ScrollView>
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "800", marginTop: 20, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.7 },
  mpSearch: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 46 },
  mpPrice: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14.5 },
  footerRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  clearBtn: { paddingVertical: 8, paddingRight: 8 },
});
