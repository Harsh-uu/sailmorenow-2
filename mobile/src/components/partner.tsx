import { useEffect, useState } from "react";
import { Image, PixelRatio, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/src/components/Icon";
import { router } from "expo-router";
import { useTheme } from "@/src/theme";
import { useAuth } from "@/src/context/AuthContext";
import { canInteract } from "@/src/lib/plan";
import { storage } from "@/src/utils/storage";
import { api } from "@/src/lib/api";

const DISMISS_KEY = "smn_upgrade_nudge_until";

// Single partner badge - orange "founding" (Founding Partner) or teal "partner"
// (Community Partner). Derived from the account's single status upstream.
// `variant`: "flag" (default) = flag icon ONLY (feed/forum/blog/marketplace cards
// and directory/Clubs cards, so a flag can never crowd/truncate the org name);
// "full" = flag + status text (org public listing page / editor preview).
// FREE orgs have no `kind`, so nothing renders.
export function PartnerBadge({ kind, variant = "flag" }: { kind?: string | null; variant?: "flag" | "full" }) {
  const { colors } = useTheme();
  if (!kind) return null;
  const founding = kind === "founding";
  const label = founding ? "Founding Partner" : "Community Partner";
  const color = founding ? (colors.accent || "#F2A03B") : (colors.teal || "#2A7871");
  const testID = founding ? "founding-partner-badge" : "community-partner-badge";
  if (variant === "full") {
    return (
      <View
        testID={testID}
        accessibilityLabel={label}
        accessibilityRole="image"
        style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "rgba(255,255,255,0.18)" }}
      >
        <Icon name="flag" size={13} color={color} footprint={13} />
        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      </View>
    );
  }
  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole="image"
      style={{ flexShrink: 0, marginLeft: 3 }}
    >
      <Icon name="flag" size={14} color={color} footprint={14} />
    </View>
  );
}

// Dismissible upgrade banner for free Sailors & Boat Owners.
export function UpgradeNudge() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    (async () => {
      const until = await storage.getItem(DISMISS_KEY, 0);
      setHidden(Number(until) > Date.now());
    })();
  }, []);

  if (hidden || !user) return null;
  const eligible = ["sailor", "boat_owner"].includes(user.account_type) && !canInteract(user);
  if (!eligible) return null;

  const dismiss = async () => {
    await storage.setItem(DISMISS_KEY, Date.now() + 30 * 24 * 60 * 60 * 1000);
    setHidden(true);
  };

  return (
    <Pressable testID="upgrade-nudge" onPress={() => router.push("/pricing")} style={[styles.card, { backgroundColor: colors.tealSoft || "#FDF3E7", borderColor: colors.accent }]}>
      <View style={[styles.icon, { backgroundColor: colors.accent + "22" }]}>
        <Icon name="sparkles" size={18} color={colors.accent}  footprint={18}/>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.onSurface }]}>Get the most out of Sail More Now</Text>
        <Text style={[styles.body, { color: colors.onSurfaceSecondary }]}>
          $6.99/mo unlocks messaging, posting & reactions, reviews, and your Crew Bank listing.
        </Text>
      </View>
      <Pressable testID="upgrade-nudge-dismiss" onPress={dismiss} hitSlop={10} style={{ padding: 2 }}>
        <Icon name="close" size={18} color={colors.muted}  footprint={18}/>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800" },
  body: { fontSize: 12.5, lineHeight: 17, marginTop: 2 },
});

// In-app renewal reminder for Community Partners within 30 days of expiry.
export function RenewalReminder() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (hidden || !user || user.subscription_tier !== "community_partner") return null;
  const exp = user.subscription_expires;
  if (!exp) return null;
  const left = Math.ceil((new Date(exp).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (left > 30 || left < 0) return null;

  const contactRenew = async () => {
    setBusy(true);
    try {
      await api.post("/contact", {
        name: user.name || "Community Partner",
        email: user.email,
        subject: "Community Partner renewal",
        message: `Community Partner renewal request from ${user.name || user.email}. Term ends in ${left} day(s) (${exp}).`,
      });
      setSent(true);
    } catch {}
    finally { setBusy(false); }
  };

  return (
    <View testID="renewal-reminder" style={[rstyles.card, { backgroundColor: "#FEF3C7", borderColor: "#FCD34D" }]}>
      <Pressable testID="renewal-dismiss" onPress={() => setHidden(true)} hitSlop={10} style={{ position: "absolute", top: 10, right: 10 }}>
        <Icon name="close" size={16} color="#92400E"  footprint={16}/>
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="time-outline" size={16} color="#92400E"  footprint={16}/>
        <Text style={{ color: "#92400E", fontWeight: "800", fontSize: 14 }}>Term ends in {left} day{left === 1 ? "" : "s"}</Text>
      </View>
      <Text style={{ color: "#92400E", fontSize: 12.5, lineHeight: 17, marginTop: 4 }}>
        Renew to keep your listing, events and messaging active.
      </Text>
      <Pressable testID="renewal-contact-btn" onPress={contactRenew} disabled={busy || sent} style={{ marginTop: 10, alignSelf: "flex-start", backgroundColor: sent ? "#16a34a" : "#F59E0B", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 }}>
        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>{sent ? "Request sent ✓" : busy ? "Sending…" : "Contact us to renew"}</Text>
      </Pressable>
    </View>
  );
}

// "Founding Partners" honor roll for the mobile home - hidden when empty.
export function FoundingWall() {
  const { colors } = useTheme();
  const [founders, setFounders] = useState<any[]>([]);
  // At large accessibility text, give each card more room so names and markets
  // can wrap to 2 lines instead of truncating or clipping at the card edge.
  const cardW = PixelRatio.getFontScale() > 1.3 ? 188 : 120;
  useEffect(() => {
    api.get("/founding-partners").then((d: any) => setFounders(d.founders || [])).catch(() => {});
  }, []);
  if (!founders.length) return null;
  return (
    <View style={{ marginTop: 8, marginBottom: 8 }} testID="founding-wall">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <Icon name="star" size={14} color={colors.accent}  footprint={14}/>
        <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" }}>Founding Partners</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }}>
        {founders.map((f) => (
          <Pressable key={f.handle || f.name} testID={`founder-${f.handle || f.name}`} onPress={() => f.handle && router.push(`/partners/${f.handle}` as any)} style={{ width: cardW, alignItems: "center", backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 12 }}>
            <View>
              {f.avatar || f.picture
                ? <Image accessibilityLabel={`${f.name || "Member"}'s avatar`} source={{ uri: f.avatar || f.picture }} style={{ width: 52, height: 52, borderRadius: 999 }} />
                : <View style={{ width: 52, height: 52, borderRadius: 999, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" }}><Icon name="org" size={24} color={colors.teal}  footprint={24}/></View>}
              <View style={{ position: "absolute", bottom: -2, right: -2, width: 20, height: 20, borderRadius: 999, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.surface }}>
                <Icon name="star" size={10} color="#fff"  footprint={10}/>
              </View>
            </View>
            <Text numberOfLines={2} style={{ color: colors.onSurface, fontSize: 12, fontWeight: "700", textAlign: "center", marginTop: 8 }}>{f.name}</Text>
            {f.primary_market ? <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 10, marginTop: 2, textAlign: "center" }}>{f.primary_market}</Text> : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const rstyles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
});
