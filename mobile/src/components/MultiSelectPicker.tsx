import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "@/src/components/Icon";
import { Button, ButtonRow } from "@/src/components/ui";
import { MotionModal } from "@/src/components/MotionModal";
import { useTheme } from "@/src/theme";

export type PickerOption = { value: string; label: string; count?: number };

type Props = {
  label: string;
  options: PickerOption[];
  value: string[];
  onChange: (next: string[]) => void;
  // single = radio behaviour (tap selects + closes); otherwise multi-select with Apply/Clear.
  single?: boolean;
  max?: number;
  limitMessage?: string;
  onUpgrade?: () => void;
  placeholder?: string;
  // Custom label shown on the trigger when there is a selection (e.g. "Rigging (4)").
  valueLabel?: string;
  searchable?: boolean;
  title?: string;
  testID: string;
  accessibilityLabel?: string;
};

// Shared searchable picker. Single-select for the Directory (market / specialty);
// multi-select with an optional max + upgrade message for the listing editors,
// Crew Bank and Profile. The limit message and upgrade action are passed in so
// the component stays generic. Theme-token styled; light + dark legible.
export function MultiSelectPicker({
  label, options, value, onChange, single = false, max, limitMessage, onUpgrade,
  placeholder = "All", valueLabel, searchable = true, title, testID, accessibilityLabel,
}: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>(value);
  const [limitHit, setLimitHit] = useState(false);

  const current = single ? value : draft;
  const triggerText = single
    ? (value.length ? (valueLabel ?? options.find((o) => o.value === value[0])?.label ?? value[0]) : placeholder)
    : (value.length ? (valueLabel ?? `${label} (${value.length})`) : placeholder);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const openSheet = () => { setDraft(value); setLimitHit(false); setQuery(""); setOpen(true); };

  const pick = (v: string) => {
    if (single) { onChange(value[0] === v ? [] : [v]); setOpen(false); return; }
    const has = draft.includes(v);
    if (!has && typeof max === "number" && draft.length >= max) { setLimitHit(true); return; }
    setLimitHit(false);
    setDraft(has ? draft.filter((x) => x !== v) : [...draft, v]);
  };

  return (
    <View style={{ flex: 1 }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `${label}: ${triggerText}`}
        onPress={openSheet}
        style={[styles.trigger, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={{ flex: 1, fontSize: 14, color: (single ? value.length : draft.length) ? colors.onSurface : colors.muted }} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>
          {triggerText}
        </Text>
        <Icon name="chevron-down" size={18} color={colors.muted} footprint={18} />
      </Pressable>

      <MotionModal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={[styles.title, { color: colors.onSurface }]}>{title ?? `Select ${label.toLowerCase()}`}</Text>

            {searchable ? (
              <View style={[styles.searchBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <Icon name="search-outline" size={16} color={colors.muted} footprint={16} />
                <TextInput
                  testID={`${testID}-search`}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={`Search ${label.toLowerCase()}`}
                  placeholderTextColor={colors.muted}
                  style={{ flex: 1, fontSize: 15, color: colors.onSurface, paddingVertical: 0 }}
                  accessibilityLabel={`Search ${label.toLowerCase()}`}
                />
              </View>
            ) : null}

            {limitHit && limitMessage ? (
              <View style={[styles.limit, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]} testID={`${testID}-limit`}>
                <Text style={{ color: colors.onSurface, fontSize: 13, fontWeight: "600" }}>{limitMessage}</Text>
                {onUpgrade ? (
                  <Button title="Upgrade" onPress={() => { setOpen(false); onUpgrade(); }} testID={`${testID}-upgrade`} style={{ marginTop: 10 }} />
                ) : null}
              </View>
            ) : null}

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {filtered.map((o) => {
                const on = current.includes(o.value);
                return (
                  <Pressable
                    key={o.value}
                    testID={`${testID}-option-${o.value}`}
                    accessibilityRole={single ? "radio" : "checkbox"}
                    accessibilityState={single ? { selected: on } : { checked: on }}
                    accessibilityLabel={o.label}
                    onPress={() => pick(o.value)}
                    style={[styles.row, { borderColor: colors.border }]}
                  >
                    {!single ? (
                      <View style={[styles.check, { borderColor: on ? colors.teal : colors.border, backgroundColor: on ? colors.teal : "transparent" }]}>
                        {on ? <Icon name="checkmark" size={14} color={colors.onBrandSecondary ?? "#10233A"} footprint={14} /> : null}
                      </View>
                    ) : null}
                    <Text style={{ flex: 1, fontSize: 15, color: colors.onSurface, fontWeight: on ? "800" : "500" }}>{o.label}</Text>
                    {typeof o.count === "number" ? (
                      <Text style={{ fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: "700", marginRight: single ? 0 : 8 }}>{o.count}</Text>
                    ) : null}
                    {single && on ? <Icon name="checkmark" size={18} color={colors.teal} footprint={18} /> : null}
                  </Pressable>
                );
              })}
              {filtered.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 14, paddingVertical: 18, textAlign: "center" }}>No matches</Text>
              ) : null}
            </ScrollView>

            {!single ? (
              <ButtonRow
                style={styles.footer}
                buttons={[
                  { title: "Clear", variant: "secondary", testID: `${testID}-clear`, onPress: () => { setDraft([]); setLimitHit(false); } },
                  { title: "Apply", testID: `${testID}-apply`, onPress: () => { onChange(draft); setOpen(false); } },
                ]}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </MotionModal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, minHeight: 44 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingBottom: 28, paddingTop: 10 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", marginBottom: 10 },
  title: { fontSize: 17, fontWeight: "800", marginBottom: 10 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, height: 44, marginBottom: 6 },
  limit: { marginVertical: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, borderBottomWidth: 1 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  footer: { flexDirection: "row", gap: 10, marginTop: 14 },
});
