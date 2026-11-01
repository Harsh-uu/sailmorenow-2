import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { Icon } from "@/src/components/Icon";
import { MotionModal } from "@/src/components/MotionModal";
import { useTheme } from "@/src/theme";
import { initials } from "@/src/lib/format";

// ---- Button ---------------------------------------------------------------
export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  testID,
  style,
  numberOfLines = 1,
}: {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "teal";
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  numberOfLines?: number;
}) {
  const { colors, scheme } = useTheme();
  const dark = scheme === "dark";
  const bg =
    variant === "primary"
      ? colors.accent
      : variant === "teal"
      ? colors.teal
      : variant === "secondary"
      ? (dark ? colors.teal : colors.brandPrimary)
      : variant === "danger"
      ? colors.error
      : "transparent";
  const fg =
    variant === "ghost"
      ? (dark ? colors.teal : colors.brandPrimary)
      : variant === "primary"
      ? colors.onAccent
      : variant === "teal"
      ? colors.onBrandSecondary
      : variant === "secondary"
      ? (dark ? "#10233A" : colors.onBrandPrimary)
      : colors.onBrandPrimary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor: variant === "ghost" ? colors.borderStrong : bg,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.btnRow}>
          {icon ? <Icon name={icon} size={18} color={fg}  footprint={18}/> : null}
          <Text numberOfLines={numberOfLines} style={[styles.btnText, { color: fg, textAlign: "center" }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ---- ButtonRow ------------------------------------------------------------
// Lays out 2+ buttons that would otherwise sit side by side. It measures each
// label's intrinsic width against the real container width (so it adapts to iOS
// Dynamic Type) and decides deterministically BEFORE showing anything:
//   - if they all fit side by side -> row, honoring each button's `weight`.
//   - if they do not fit -> stack full width, primary action on top.
// Nothing is ever rendered side by side and then re-flowed. A label can never
// be clipped: a too-wide row stacks, and a stacked full-width button has room.
// `allowStack={false}` (used by the keyboard-pinned form footers, whose height
// must not grow) keeps one row and lets the label wrap to two lines instead.
export type RowButton = {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "teal";
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  testID?: string;
  weight?: number;
};

export function ButtonRow({
  buttons,
  allowStack = true,
  stackPrimaryIndex,
  gap = 10,
  testID,
  style,
}: {
  buttons: RowButton[];
  allowStack?: boolean;
  stackPrimaryIndex?: number;
  gap?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const n = buttons.length;
  const [containerW, setContainerW] = React.useState(0);
  const [widths, setWidths] = React.useState<Record<number, number>>({});

  // Footer / fixed-height contexts never stack. Keep one row and let long
  // labels wrap to two lines (no ellipsis) so the row height stays stable.
  if (!allowStack) {
    return (
      <View testID={testID} style={[{ flexDirection: "row", gap, flex: 1 }, style]}>
        {buttons.map((b, i) => (
          <Button key={i} {...b} numberOfLines={2} style={{ flex: b.weight ?? 1 }} />
        ))}
      </View>
    );
  }

  // A measurement is only valid once the container has a width AND every label
  // reported a real (> 0) width. Until then (or if anything is 0/invalid) we
  // keep the SAFE side-by-side row below, never a collapsed one.
  const haveAll = Object.keys(widths).length >= n && buttons.every((_, i) => (widths[i] || 0) > 0);
  const measured = containerW > 0 && haveAll;

  // Decide per button: a button "fits" only if its one-line label (plus padding,
  // border, optional icon and a safety margin) is no wider than the flex share
  // it would get in the row. If ANY button would not fit its share on one line,
  // stack the whole row full width. This stacks instead of wrapping, and leaves
  // rows whose labels already fit on one line exactly as they were.
  const PAD = 44, BORDER = 3, ICON = 26, SAFETY = 6;
  const sumWeight = buttons.reduce((s, b) => s + (b.weight ?? 1), 0);
  const content = containerW - gap * (n - 1);
  let anyOverflow = false;
  for (let i = 0; i < n; i++) {
    const share = content * ((buttons[i].weight ?? 1) / sumWeight);
    const req = (widths[i] || 0) + PAD + BORDER + (buttons[i].icon ? ICON : 0) + SAFETY;
    if (req > share) { anyOverflow = true; break; }
  }
  const stacked = measured && anyOverflow;

  const primaryIdx = stackPrimaryIndex ?? n - 1;
  const order = stacked
    ? [primaryIdx, ...buttons.map((_, i) => i).filter((i) => i !== primaryIdx)]
    : buttons.map((_, i) => i);

  return (
    <View
      testID={testID}
      onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
      // The trailing object OWNS flexDirection/gap/minHeight so a caller style
      // (e.g. a `navRow` with flexDirection:"row") can never collapse the row.
      style={[{ alignSelf: "stretch" }, style, { flexDirection: stacked ? "column" : "row", gap, minHeight: 50 }]}
    >
      {/* Invisible measuring layer: natural label widths.
          onLayout (not onTextLayout) so it fires on both web and native. */}
      <View pointerEvents="none" style={{ position: "absolute", opacity: 0, flexDirection: "row" }}>
        {buttons.map((b, i) => (
          <Text key={`m${i}`} style={styles.btnText} onLayout={(e: any) => {
            const w = e?.nativeEvent?.layout?.width ?? 0;
            setWidths((prev) => (Math.round(prev[i] || 0) === Math.round(w) ? prev : { ...prev, [i]: w }));
          }}>{b.title}</Text>
        ))}
      </View>

      {/* Visible buttons are ALWAYS rendered (direct children, no nested row).
          Safe side-by-side row with full labels until a valid measurement shows
          they do not fit, then stacked full width with the primary action on top. */}
      {order.map((i) => (
        <Button
          key={i}
          {...buttons[i]}
          numberOfLines={stacked ? 1 : 2}
          style={stacked ? { width: "100%" } : { flex: buttons[i].weight ?? 1 }}
        />
      ))}
    </View>
  );
}

// ---- Card -----------------------------------------------------------------
export function Card({
  children,
  style,
  onPress,
  testID,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const inner = (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
  if (onPress) {
    return (
      <Pressable testID={testID} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
        {inner}
      </Pressable>
    );
  }
  return inner;
}

// ---- Badge / Chip ---------------------------------------------------------
export function Badge({ label, tone = "teal" }: { label: string; tone?: "teal" | "accent" | "navy" | "muted" }) {
  const { colors } = useTheme();
  const map = {
    // Use the theme's soft-chip pairings so the label stays legible in BOTH
    // modes (raw navy-on-tealSoft was ~1.3:1 in dark — invisible).
    teal: { bg: colors.brandTertiary, fg: colors.onBrandTertiary },
    accent: { bg: colors.accentSoft, fg: colors.onAccentSoft },
    navy: { bg: colors.brandPrimary, fg: colors.onBrandPrimary },
    muted: { bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map.bg }]}>
      <Text style={[styles.badgeText, { color: map.fg }]}>{label}</Text>
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.brandPrimary : colors.surface,
          borderColor: active ? colors.brandPrimary : colors.border,
        },
      ]}
    >
      <Text style={{ color: active ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontWeight: "600", fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---- Avatar ---------------------------------------------------------------
export function Avatar({ uri, name, size = 40 }: { uri?: string | null; name?: string | null; size?: number }) {
  const { colors } = useTheme();
  // Storage avatars are stored as a relative "/api/files/..." path — resolve
  // against the backend URL so it matches what web renders.
  const resolved = uri && uri.startsWith("/api/") ? `${process.env.EXPO_PUBLIC_BACKEND_URL}${uri}` : uri;
  // Only treat `resolved` as a real image when it's a URL, storage path or
  // data URI. A short emoji avatar or any stray string falls back to initials
  // instead of being handed to <Image> (which would show a blank circle).
  const isImage = typeof resolved === "string" && /^(https?:\/\/|data:image\/|\/)/i.test(resolved);
  if (isImage) {
    // An org account's logo lives under the ".../org/..." storage path. Draw it
    // on a FIXED white circle (matching LogoCircle) so a transparent PNG reads
    // cleanly in dark mode. Personal photos keep the neutral surface backing.
    const isOrgLogo = /\/org\//.test(resolved);
    return <Image accessibilityLabel={name ? `${name}'s avatar` : "Avatar"} source={{ uri: resolved }} resizeMode="cover" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: isOrgLogo ? "#fff" : colors.surfaceTertiary }} />;
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.tealSoft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: colors.navy, fontWeight: "700", fontSize: size * 0.4 }}>
        {initials(name).toUpperCase()}
      </Text>
    </View>
  );
}

// ---- States ---------------------------------------------------------------
export function Loading({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.teal} size="large" />
      {label ? <Text style={[styles.dim, { color: colors.muted }]}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({
  icon = "boat-outline",
  title,
  subtitle,
  action,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <Icon name={icon} size={44} color={colors.borderStrong}  footprint={44}/>
      <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>{title}</Text>
      {subtitle ? <Text style={[styles.dim, { color: colors.muted, textAlign: "center" }]}>{subtitle}</Text> : null}
      {action ? <View style={{ marginTop: 16 }}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <Icon name="error" size={44} color={colors.error} footprint={44} label="Error" />
      <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>Something went wrong</Text>
      <Text style={[styles.dim, { color: colors.muted, textAlign: "center" }]}>{message}</Text>
      {onRetry ? (
        <View style={{ marginTop: 16 }}>
          <Button title="Try again" variant="secondary" onPress={onRetry} icon="refresh" testID="error-retry-btn" />
        </View>
      ) : null}
    </View>
  );
}

// ---- Section title label (eyebrow) ----------------------------------------
export function Eyebrow({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.eyebrow, { color: colors.teal }]}>{children.toUpperCase()}</Text>;
}

// ---- SegmentedControl -----------------------------------------------------
// 2 to 4 mutually-exclusive, always-visible options (e.g. Week | Month).
export function SegmentedControl({ options, value, onChange, testID, style }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View testID={testID} accessibilityRole="radiogroup" style={[segStyles.wrap, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }, style]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} testID={`${testID}-${o.value}`} accessibilityRole="radio"
            accessibilityState={{ selected: active }} accessibilityLabel={o.label}
            onPress={() => onChange(o.value)} style={[segStyles.seg, active && { backgroundColor: colors.brandPrimary }]}>
            <Text numberOfLines={1} style={{ color: active ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontWeight: "700", fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---- Picker ---------------------------------------------------------------
// Shows the current value and opens a bottom sheet to change it. Use for 5+
// options, long lists, or rarely-changed choices (market, category, sort).
export function Picker({ value, options, onChange, testID, title, placeholder = "Select", icon, flex }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  testID?: string;
  title?: string;
  placeholder?: string;
  icon?: string;
  flex?: boolean;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${title || "Options"}: ${current?.label || placeholder}`}
        onPress={() => setOpen(true)} style={[pickStyles.trigger, { backgroundColor: colors.surface, borderColor: colors.border }, flex ? { flex: 1 } : null]}>
        {icon ? <Icon name={icon} size={15} color={colors.muted} footprint={15} /> : null}
        <Text numberOfLines={1} style={{ flex: 1, color: current ? colors.onSurface : colors.muted, fontWeight: "700", fontSize: 13.5 }}>{current?.label || placeholder}</Text>
        <Icon name="chevron-down" size={15} color={colors.muted} footprint={15} />
      </Pressable>
      <MotionModal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={pickStyles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[pickStyles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            {title ? <Text style={[pickStyles.sheetTitle, { color: colors.onSurface }]}>{title}</Text> : null}
            <ScrollView style={{ maxHeight: 360 }}>
              {options.map((o) => {
                const sel = o.value === value;
                return (
                  <Pressable key={o.value} testID={`${testID}-opt-${o.value}`} onPress={() => { onChange(o.value); setOpen(false); }}
                    style={[pickStyles.row, { borderBottomColor: colors.divider }]}>
                    <Text style={{ flex: 1, color: sel ? colors.teal : colors.onSurface, fontWeight: sel ? "800" : "500", fontSize: 16 }}>{o.label}</Text>
                    {sel ? <Icon name="checkmark" size={20} color={colors.teal} footprint={20} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </MotionModal>
    </>
  );
}

// ---- FilterButton ---------------------------------------------------------
// One button that opens a filter sheet; shows a count of active filters.
export function FilterButton({ count = 0, onPress, testID = "filters-btn", label = "Filters" }: {
  count?: number;
  onPress?: () => void;
  testID?: string;
  label?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={count ? `${label}, ${count} active` : label} onPress={onPress}
      style={[pickStyles.trigger, { backgroundColor: colors.surface, borderColor: colors.border, flexGrow: 0 }]}>
      <Icon name="options-outline" size={16} color={colors.onSurface} footprint={16} />
      <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 13.5 }}>{label}</Text>
      {count > 0 ? (
        <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}>
          <Text testID={`${testID}-count`} style={{ color: colors.onAccent, fontWeight: "800", fontSize: 11 }}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const segStyles = StyleSheet.create({
  wrap: { flexDirection: "row", borderRadius: 999, borderWidth: 1, padding: 3, alignSelf: "flex-start" },
  seg: { paddingHorizontal: 16, minHeight: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" },
});

const pickStyles = StyleSheet.create({
  trigger: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, minHeight: 44 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingVertical: 20, paddingHorizontal: 16, maxHeight: "70%" },
  sheetTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
});

const styles = StyleSheet.create({
  btn: {
    minHeight: 50,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    borderWidth: 1.5,
  },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  btnText: { fontWeight: "700", fontSize: 16 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, marginRight: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: "700", marginTop: 4 },
  dim: { fontSize: 14 },
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 1.5, marginBottom: 6 },
});
