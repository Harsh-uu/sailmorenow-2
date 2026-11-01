import { Text, View } from "react-native";
import { Icon } from "@/src/components/Icon";
import { useTheme } from "@/src/theme";

export const FACTORS = [
  { key: "personality", label: "Personality" },
  { key: "skill", label: "Skill" },
  { key: "promptness", label: "Promptness" },
  { key: "communication", label: "Communication" },
] as const;

export function fmtReviewDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Row of 5 stars with a real accessible label ("4.5 out of 5"). */
export function Stars({ value, size = 15 }: { value?: number | null; size?: number }) {
  const { colors } = useTheme();
  const v = Number(value || 0);
  return (
    <View
      style={{ flexDirection: "row" }}
      accessibilityLabel={`${v ? v.toFixed(1) : "0"} out of 5`}
      accessibilityRole="image"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const name = v >= n ? "star" : v >= n - 0.5 ? "star-half" : "star-outline";
        return <Icon key={n} name={name} size={size} color={colors.accent} footprint={size} />;
      })}
    </View>
  );
}

/**
 * Compact factor list (no tiles). Each row: label + value (one decimal) on one
 * line, stars on the line directly below. Used for the per-review optional
 * factors and the summary breakdown.
 */
export function FactorList({
  rows,
  starSize = 13,
}: {
  rows: { key: string; label: string; value: number; suffix?: string }[];
  starSize?: number;
}) {
  const { colors } = useTheme();
  if (!rows.length) return null;
  return (
    <View style={{ gap: 6 }} testID="review-optional-ratings">
      {rows.map((r) => (
        <View key={r.key}>
          <Text numberOfLines={1} style={{ color: colors.onSurfaceSecondary, fontSize: 12.5, fontWeight: "700" }}>
            {r.label} {Number(r.value).toFixed(1)}
            {r.suffix ? <Text style={{ color: colors.muted, fontWeight: "500" }}> {r.suffix}</Text> : null}
          </Text>
          <View style={{ marginTop: 1, alignSelf: "flex-start" }}>
            <Stars value={r.value} size={starSize} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Overall stars + numeric value on one line (review header / inbox card). */
export function OverallLine({ value, size = 15 }: { value?: number | null; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Stars value={value} size={size} />
      <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700" }}>
        {value ? Number(value).toFixed(1) : ""}
      </Text>
    </View>
  );
}
