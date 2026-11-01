import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { Icon } from "@/src/components/Icon";
import { Screen } from "@/src/components/Screen";
import { Badge, Button, Loading } from "@/src/components/ui";
import TestimonialsStrip from "@/src/components/TestimonialsStrip";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";
import { BOAT_PRO_TIERS, SAILOR_MONTHLY, discountFor } from "@/src/lib/plans";
import { loadMatrix, bulletsFor, upgradeBulletsFor, featureRows, isTruthy, valueLabel, type Matrix } from "@/src/lib/planMatrix";

const NAVY = "#1F3F5B";
const TEAL = "#55B3AD";
const ORANGE = "#F2A03B";

export default function Pricing() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { tier: tierParam, months: monthsParam, signup: signupParam } = useLocalSearchParams<{ tier?: string; months?: string; signup?: string }>();
  const fromSignup = signupParam === "1";
  const [mode, setMode] = useState<string>("");
  const [trialEnabled, setTrialEnabled] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [selectedTier, setSelectedTier] = useState(
    tierParam && ["basic", "featured", "premium"].includes(tierParam) ? tierParam : "featured",
  );
  const [months, setMonths] = useState(
    monthsParam && ["1", "3", "6", "12"].includes(monthsParam) ? parseInt(monthsParam, 10) : 1,
  );

  const audience = user?.account_type === "boat_pro" ? "boat_pro" : "sailor";
  const monthOptions = audience === "boat_pro" ? [1, 6, 12] : [1, 3, 6, 12];

  useEffect(() => {
    api.get<{ mode: string; trial_enabled?: boolean }>("/payments/mode").then((m) => { setMode(m.mode); setTrialEnabled(!!m.trial_enabled); }).catch(() => {}).finally(() => setLoading(false));
    loadMatrix().then(setMatrix).catch(() => setMatrix(null));
  }, []);

  const monthlyBase = audience === "boat_pro" ? (BOAT_PRO_TIERS.find((t) => t.tier === selectedTier)?.price ?? 0) : SAILOR_MONTHLY;
  const discount = discountFor(months, audience);
  const perMonth = +(monthlyBase * (1 - discount)).toFixed(2);
  const total = +(monthlyBase * months * (1 - discount)).toFixed(2);
  const intervalLabel = months === 6 ? "every 6 months" : months === 12 ? "every 12 months" : months === 3 ? "every 3 months" : "per month";
  const continueFree = useCallback(() => {
    router.replace("/(tabs)/feed");
  }, []);

  if (loading) return <Screen title="Membership" showBack padded={false}><Loading /></Screen>;

  return (
    <Screen title="Membership" showBack onBack={fromSignup ? continueFree : undefined} padded={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {mode === "test" ? (
          <View style={[styles.banner, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
            <Text style={{ color: colors.warning, fontWeight: "700" }}>Test mode</Text>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 }}>No real charges. Subscriptions are purchased on the website.</Text>
          </View>
        ) : null}

        <Text style={[styles.lead, { color: colors.onSurface }]}>
          {audience === "boat_pro" ? "Grow your Boat Pro presence" : "Unlock Premium"}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>
          {audience === "boat_pro" ? (fromSignup ? "Proceed with payment." : "Pick a tier below. Longer commitments save more.") : "Unlimited posts, the Crew Bank, and full community access."}
        </Text>

        {audience === "boat_pro" ? (
          (fromSignup ? BOAT_PRO_TIERS.filter((t) => t.tier === selectedTier) : BOAT_PRO_TIERS).map((t) => {
            const isSel = selectedTier === t.tier;
            const isPremium = t.tier === "premium";
            const cardBg = isPremium ? NAVY : colors.surface;
            const cardBorder = isPremium ? NAVY : isSel ? ORANGE : colors.border;
            const titleColor = isPremium ? "#FFFFFF" : colors.onSurface;
            const featColor = isPremium ? "#E2E8F0" : colors.onSurfaceSecondary;
            return (
              <Pressable key={t.tier} testID={`tier-${t.tier}`} onPress={() => setSelectedTier(t.tier)}
                style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder, borderWidth: isSel ? 2 : 1.5 }]}>
                <View style={styles.cardTop}>
                  <Text style={{ color: isPremium ? ORANGE : TEAL, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>{t.label.toUpperCase()}</Text>
                  {isSel ? <Icon name="checkmark-circle" size={20} color={isPremium ? ORANGE : TEAL} footprint={20} /> : null}
                </View>
                <Text style={[styles.price, { color: titleColor }]}>${t.price.toFixed(2)}<Text style={{ fontSize: 15, fontWeight: "600", color: featColor }}>/mo</Text></Text>
                <View style={{ marginTop: 10, gap: 6 }}>
                  {featureRows(matrix, "boat_pro").map((row) => {
                    const v = row.values[t.tier];
                    const on = isTruthy(v);
                    return (
                      <View key={row.key} style={styles.featRow} testID={`tier-row-${t.tier}-${row.key}`}>
                        <Icon name={on ? "checkmark" : "close"} size={15} color={on ? (isPremium ? ORANGE : TEAL) : colors.muted} footprint={15} />
                        <Text style={{ color: on ? featColor : colors.muted, fontSize: 13.5, flex: 1 }}>
                          {on ? (v === true ? row.label : `${row.label}: ${valueLabel(v)}`) : `${row.label} - Not included`}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </Pressable>
            );
          })
        ) : (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: TEAL, borderWidth: 2 }]}>
            <Text style={{ color: TEAL, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>{user?.account_type === "boat_owner" ? "BOAT OWNER PREMIUM" : "SAILOR PREMIUM"}</Text>
            <Text style={[styles.price, { color: colors.onSurface }]}>${SAILOR_MONTHLY.toFixed(2)}<Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted }}>/mo</Text></Text>
            <View style={{ marginTop: 10, gap: 6 }}>
              {upgradeBulletsFor(matrix, "member", "premium", "free").map((f) => (
                <View key={f} style={styles.featRow}>
                  <Icon name="checkmark" size={15} color={TEAL} footprint={15} />
                  <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, flex: 1 }}>{f}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.monthRow}>
          {(fromSignup ? [] : monthOptions).map((m) => {
            const active = months === m;
            const d = discountFor(m, audience);
            return (
              <Pressable key={m} testID={`months-${m}`} onPress={() => setMonths(m)}
                style={[styles.monthPill, { backgroundColor: active ? ORANGE : colors.surface, borderColor: active ? ORANGE : colors.border }]}>
                <Text style={{ color: active ? "#FFFFFF" : colors.onSurfaceSecondary, fontWeight: "700", fontSize: 13 }}>
                  {m} mo{d > 0 ? ` · ${d * 100}%` : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="checkout-summary">
          {months === 1 && trialEnabled ? (
            <View style={{ alignSelf: "center", backgroundColor: colors.tealSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 8 }} testID="trial-badge">
              <Text style={{ color: colors.tealText, fontWeight: "800", fontSize: 12 }}>30 days free</Text>
            </View>
          ) : null}
          {discount > 0 ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>YOUR PRICE</Text>
                <Badge label={`Save ${discount * 100}%`} tone="teal" />
              </View>
              <Text style={[styles.bigPrice, { color: colors.onSurface }]} testID="per-month-price">${perMonth.toFixed(2)}<Text style={{ fontSize: 16, color: colors.muted }}>/mo</Text></Text>
              <Text style={{ color: colors.muted, fontSize: 13 }} testID="billed-note">billed ${total.toFixed(2)} {intervalLabel}</Text>
            </>
          ) : (
            <>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>YOU'LL BE CHARGED</Text>
              <Text style={[styles.bigPrice, { color: colors.onSurface }]} testID="per-month-price">${total.toFixed(2)}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>for {months} month{months > 1 ? "s" : ""}</Text>
            </>
          )}
          <Button title="See full plan details" icon="globe-outline" onPress={() => router.push("/(tabs)/profile/my-plan")} testID="manage-plan-btn" style={{ marginTop: 14 }} />
          {user ? (
            <Text testID="pricing-web-note" style={{ color: colors.muted, fontSize: 12.5, textAlign: "center", marginTop: 10, lineHeight: 18 }}>
              Plans are purchased and managed on the website. Sign in to your account there to subscribe, change, or cancel. Plans auto-renew until cancelled.
            </Text>
          ) : (
            <Text testID="pricing-web-note" style={{ color: colors.muted, fontSize: 12.5, textAlign: "center", marginTop: 10, lineHeight: 18 }}>
              Create a free account to browse. To go Premium, subscribe on the website.
            </Text>
          )}
          <Button title="Continue with free" variant="secondary" onPress={continueFree} testID="continue-free-btn" style={{ marginTop: 10, alignSelf: "stretch" }} />
          <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 8, lineHeight: 17 }}>
            A free account lets you browse the community. Paid features unlock after you subscribe.{fromSignup ? " Go back to change your plan." : ""}
          </Text>
        </View>

        <TestimonialsStrip />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
  lead: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  sub: { fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 8 },
  card: { borderRadius: 18, padding: 18, marginTop: 14 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  price: { fontSize: 30, fontWeight: "800", marginTop: 8, letterSpacing: -1 },
  featRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  monthRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  monthPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  summary: { borderWidth: 1, borderRadius: 18, padding: 18, marginTop: 18, alignItems: "center" },
  bigPrice: { fontSize: 34, fontWeight: "800", marginTop: 8, letterSpacing: -1 },
});
