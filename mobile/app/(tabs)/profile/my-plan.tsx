import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Icon } from "@/src/components/Icon";
import { Screen } from "@/src/components/Screen";
import { Badge, Button, Loading } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";
import { loadMatrix, accountTypeKey, findType, isTruthy, valueLabel, type Matrix, type MatrixType } from "@/src/lib/planMatrix";

const TIER_LABEL: Record<string, string> = { basic: "Basic", featured: "Featured", premium: "Premium" };
const label = (t?: string) => TIER_LABEL[(t || "").toLowerCase()] || (t || "Plan");
const fmt = (iso?: string | null) => {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return "-"; }
};
const intervalLabel = (m?: number | null) => (m === 1 ? "month" : m ? `${m} months` : "term");

// New Stripe subscription payload. Entitlement and all dates are written by the
// backend webhook; mobile only reads and displays them. Plan changes, cancel and
// billing are handled on the website, so mobile shows no purchase controls.
type Sub = {
  is_free?: boolean;
  tier?: string;
  tier_label?: string;
  interval_months?: number | null;
  price?: number | null;
  status?: string;
  provider?: string;
  renews_at?: string | null;
  cancel_at_period_end?: boolean;
  scheduled_change?: { tier: string; label: string; at: string } | null;
  can_manage?: boolean;
};

export default function MyPlan() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const [sub, setSub] = useState<Sub | undefined>(undefined);
  const [matrix, setMatrix] = useState<Matrix | null>(null);

  const load = useCallback(() => {
    api.get<Sub>("/payments/subscription").then(setSub).catch(() => setSub({ is_free: true }));
  }, []);
  useEffect(() => { load(); loadMatrix().then(setMatrix).catch(() => setMatrix(null)); }, [load]);

  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];

  const typeKey = accountTypeKey(user?.account_type ?? undefined);
  const type = findType(matrix, typeKey);
  const userTier = (user?.subscription_tier || "free").toLowerCase();
  const levelKey = typeKey === "member" ? (userTier === "free" ? "free" : "premium")
    : typeKey === "boat_pro" ? (["basic", "featured", "premium"].includes(userTier) ? userTier : null)
    : (["community_partner", "founding_partner"].includes(userTier) ? userTier : "free");
  const isOrg = typeKey === "organization";
  const isFreeMember = typeKey === "member" && levelKey === "free";

  const statusLine = (s: Sub) => {
    if (s.status === "past_due") return `We couldn't take your last payment. Update your card on the website to keep ${label(s.tier)}.`;
    if (s.status === "trialing") return `Free trial - your first payment is on ${fmt(s.renews_at)}`;
    if (s.cancel_at_period_end) return `Cancels on ${fmt(s.renews_at)} - you keep ${label(s.tier)} until then`;
    if (s.scheduled_change) return `Changes to ${s.scheduled_change.label} on ${fmt(s.scheduled_change.at)}`;
    return `Renews automatically on ${fmt(s.renews_at)}`;
  };

  return (
    <Screen title="My plan" showBack scroll>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="my-plan-screen">
        {sub === undefined ? (
          <Loading />
        ) : sub.is_free ? (
          <>
            <View style={card} testID="plan-free">
              <Text style={[styles.h2, { color: colors.onSurface }]}>
                {isOrg ? "Your organization is on the free plan." : "You are on the free plan."}
              </Text>
              <Text style={[styles.body, { color: colors.onSurfaceSecondary }]}>
                {isOrg
                  ? "Community Partner and Founding Partner are arranged with our team. See what you unlock below."
                  : "Free is limited. See what Premium unlocks below."}
              </Text>
              {isOrg ? (
                <Button title="Contact us to become a Community Partner" variant="primary" icon="mail-outline" onPress={() => router.push("/contact")} testID="plan-org-contact" style={{ marginTop: 14 }} />
              ) : (
                <View style={[styles.notice, { backgroundColor: colors.tealSoft }]} testID="plan-web-note-free">
                  <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18 }}>
                    To go Premium, sign in to your account on the website. Plans are purchased and managed there.
                  </Text>
                </View>
              )}
            </View>
            <Comparison type={type} levelKey={levelKey} colors={colors} isFreeMember={isFreeMember} isOrg={isOrg} />
          </>
        ) : (
          <>
            {/* Current plan (read-only) */}
            <View style={card} testID="plan-current">
              <View style={styles.rowBetween}>
                <Text style={[styles.kicker, { color: colors.tealText }]}>YOUR PLAN</Text>
                <Badge label={label(sub.tier)} tone="accent" />
              </View>
              <Text style={[styles.h2, { color: colors.onSurface, marginTop: 2 }]} testID="plan-name">
                {user?.account_type === "boat_pro" ? `Boat Pro ${label(sub.tier)}` : isOrg ? label(sub.tier) : `${label(sub.tier)} membership`}
              </Text>
              <Text style={[styles.body, { color: colors.onSurface, fontWeight: "700" }]} testID="plan-status-line">
                {statusLine(sub)}
              </Text>
              {sub.price != null ? (
                <Text style={[styles.small, { color: colors.onSurfaceSecondary }]} testID="plan-price-line">
                  ${Number(sub.price).toFixed(2)} every {intervalLabel(sub.interval_months)}
                </Text>
              ) : null}
            </View>

            {/* Manage on web note (no purchase / cancel / portal on mobile) */}
            <View style={[styles.card, { backgroundColor: colors.tealSoft, borderColor: colors.border }]} testID="plan-web-note">
              <View style={styles.rowStart}>
                <Icon name="globe-outline" size={16} color={colors.tealText} footprint={16} />
                <Text style={[styles.body, { color: colors.onSurface, fontWeight: "800", marginTop: 0 }]}>Manage on the website</Text>
              </View>
              <Text style={[styles.small, { color: colors.onSurfaceSecondary }]}>
                To change your plan, cancel auto-renewal, or update your payment method, sign in to your account on the website.
              </Text>
            </View>

            {/* What's included - matrix comparison for EVERY account type */}
            <Comparison type={type} levelKey={levelKey} colors={colors} isFreeMember={isFreeMember} isOrg={isOrg} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// Matrix-driven "What's included" for mobile. Compact stacked layout: each
// feature shows its label + short line, then one chip per level with the value;
// the current level chip is highlighted. Reads only from the backend matrix.
function Comparison({ type, levelKey, colors, isFreeMember, isOrg }: {
  type: MatrixType | null; levelKey: string | null; colors: any; isFreeMember: boolean; isOrg: boolean;
}) {
  if (!type) return null;
  const rows = type.features.filter((f) => !f.hold);
  const missing = isFreeMember
    ? type.features.filter((f) => !f.hold && !isTruthy(f.values?.free) && isTruthy(f.values?.premium))
    : [];
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="plan-included">
      <Text style={[styles.kicker, { color: colors.muted, marginBottom: 10 }]}>WHAT&apos;S INCLUDED</Text>

      {missing.length > 0 ? (
        <View style={[styles.notice, { backgroundColor: colors.accentSoft, marginTop: 0, marginBottom: 12 }]} testID="plan-free-reminder">
          <Text style={{ color: colors.onSurface, fontSize: 13, fontWeight: "800", marginBottom: 4 }}>Free is limited. Premium adds:</Text>
          {missing.map((f) => (
            <View key={f.key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 2 }} testID={`plan-missing-${f.key}`}>
              <Icon name="lock-closed-outline" size={13} color={colors.muted} footprint={13} />
              <Text style={{ color: colors.onSurfaceSecondary, fontSize: 12.5, flex: 1 }}>{f.label}{f.short ? ` - ${f.short}` : ""}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {rows.map((f, i) => (
        <View key={f.key} testID={`plan-row-${f.key}`}
              style={{ paddingVertical: 10, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
          <Text style={{ color: colors.onSurface, fontSize: 13.5, fontWeight: "700" }}>{f.label}</Text>
          {f.short ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>{f.short}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {type.levels.map((l) => {
              const cur = l.key === levelKey;
              const v = f.values?.[l.key];
              const txt = `${l.label}: ${valueLabel(v)}`;
              return (
                <View key={l.key} testID={`plan-${f.key}-${l.key}`}
                      style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
                               backgroundColor: cur ? colors.navy || "#1F3F5B" : colors.surfaceSecondary }}>
                  <Text style={{ fontSize: 11.5, fontWeight: cur ? "800" : "600", color: cur ? "#FFFFFF" : (isTruthy(v) ? colors.onSurface : colors.muted) }}>{txt}</Text>
                </View>
              );
            })}
          </View>
        </View>
      ))}

      {isOrg ? (
        <View style={{ marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12 }} testID="plan-org-footer">
          <Text style={{ color: colors.onSurfaceSecondary, fontSize: 12.5, lineHeight: 18 }}>
            Organizations cannot buy in app. Community Partner and Founding Partner are arranged by our team. Founding Partner is limited to the first 5 organizations in Portland/Vancouver and the first 5 in Greater Seattle.
          </Text>
          {levelKey !== "founding_partner" ? (
            <Button title="Contact us to become a Community Partner" variant="primary" icon="mail-outline" onPress={() => router.push("/contact")} testID="plan-org-contact-footer" style={{ marginTop: 10 }} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 14 },
  h2: { fontSize: 18, fontWeight: "800" },
  body: { fontSize: 14, marginTop: 4 },
  small: { fontSize: 12.5, marginTop: 6, lineHeight: 17 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowStart: { flexDirection: "row", alignItems: "center", gap: 8 },
  notice: { borderRadius: 12, padding: 10, marginTop: 10 },
});
