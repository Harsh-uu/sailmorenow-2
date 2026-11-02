import { useEffect, useState } from "react";
import { Image, PixelRatio, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";

import { useAuth } from "@/src/context/AuthContext";
import { FoundingWall } from "@/src/components/partner";
import { Button, Loading } from "@/src/components/ui";
import { api, HERO_IMG, LOGO_ROUND } from "@/src/lib/api";
import { useTheme } from "@/src/theme";

import { Icon, IconName } from "@/src/components/Icon";

// One switch to hide every live counter on this signed-out home screen (the
// social-proof stat strip is the only place counters are drawn). Flip to true
// to show them again; code is kept intact below.
const SHOW_LIVE_COUNTERS = false;

const FEATURES: { icon: IconName; title: string; desc: string }[] = [
  { icon: "events", title: "Events calendar", desc: "Regattas, rendezvous & volunteer days across all 10 PNW markets." },
  { icon: "community", title: "Community Hub", desc: "Forums, blogs, marketplace & a live feed. React and join the conversation." },
  { icon: "directory", title: "Boat Pros directory", desc: "Riggers, mechanics, sailmakers & more, filtered to your market." },
  { icon: "crew", title: "Crew Bank", desc: "Seasonal and per event crew banks with detailed profiles. Find crew/get listed." },
  { icon: "messages", title: "Direct messaging", desc: "Connect privately with sailors, owners, clubs & Boat Pros." },
  { icon: "reviews", title: "Reviews & ratings", desc: "Two-way review system builds trust and reputation" },
];

type Path = {
  key: string; label: string; icon: any; tagline: string; price: string;
  free: string[]; premiumTitle: string; premiumNote?: string; premium: string[]; partner?: boolean;
};

const UPGRADE_NOTE = "Free accounts can look around - Premium ($6.99/mo) unlocks the good stuff.";

const PATHS: Path[] = [
  {
    key: "sailor", label: "Sailor", icon: "crew",
    tagline: "Crew on boats, join races & cruises, and plug into the community.",
    price: "Free · Premium $6.99/mo",
    free: [
      "Browse Crew and Volunteer opportunities",
      "See what other sailors are talking about",
      "Access directory of local Clubs & Boat Pros",
      "Get involved in your local sailing scene",
    ],
    premiumTitle: "Why go Premium", premiumNote: UPGRADE_NOTE,
    premium: [
      "Get listed in the Crew Bank",
      "Direct messaging with owners, sailors & pros",
      "Interact - post & respond on forums and feeds",
      "Leave & receive reviews",
      "Enhanced profile with an ID-verified badge",
    ],
  },
  {
    key: "boat_owner", label: "Boat Owner", icon: "boatOwner",
    tagline: "Find crew, hire trusted pros, and plan your whole season.",
    price: "Free · Premium $6.99/mo",
    free: [
      "Browse Crew Banks - seasonal and per event",
      "Browse directory of local Boat Pros & Clubs",
      "See what's happening in your local community",
      "Live Events calendar",
    ],
    premiumTitle: "Why go Premium", premiumNote: UPGRADE_NOTE,
    premium: [
      "Post crew opportunities",
      "Direct Messaging with potential crew, clubs & pros",
      "Interact - post & respond on marketplace and hub",
      "Leave & receive reviews",
      "Enhanced profile with an ID-verified badge",
    ],
  },
  {
    key: "boat_pro", label: "Boat Pro", icon: "boatPro",
    tagline: "Get discovered by boat owners in your local market.",
    price: "Basic $12.99/mo\nFeatured $19.99/mo\nPremium $29.99/mo",
    free: [
      "Listed in the Boat Pros directory",
      "Direct messaging with potential customers",
      "Showcase services & get reviews",
      "Target the markets you serve",
      "Enhanced listings on higher tiers",
    ],
    premiumTitle: "Boat Pro plans",
    premium: [
      "Basic $12.99/mo: Email/website, 1+ Categories, Local market, 2-way reviews, direct messaging",
      "Featured $19.99/mo: Basic plus- 2 markets, logo & cover photo, enhanced listing",
      "Premium $29.99/mo: Featured plus- Unlimited markets, 5 gallery photos, trust and credentials, top directory placement",
    ],
  },
  {
    key: "partner", label: "Organization", icon: "org",
    tagline: "Expand your reach and grow your sailing programs.",
    price: "Free to join",
    free: [
      "Get listed in Clubs & Orgs Directory",
      "Build following of potential members",
      "Post 1 volunteer event and 1 update each calendar month",
      "RSVPs & attendee notifications",
      "Get reviews and build reputation",
    ],
    premiumTitle: "Become a Community Partner",
    premiumNote: "Gets your club on every sailor's radar.",
    premium: [
      "Direct messaging with owners, sailors & pros",
      "Enhanced profile",
      "Unlimited calendar event posts",
      "Interact - post & respond on forums and feeds",
      "Founding Partners get home-page recognition and an annual newsletter bio",
    ],
    partner: true,
  },
];

export default function Index() {
  const { user, loading, login, signingIn } = useAuth();
  const { colors, scheme } = useTheme();
  const [pathIdx, setPathIdx] = useState(0);
  const { role: roleParam } = useLocalSearchParams<{ role?: string }>();
  useEffect(() => {
    const i = PATHS.findIndex((p) => p.key === roleParam);
    if (i >= 0) setPathIdx(i);
  }, [roleParam]);
  const [stats, setStats] = useState<any>(null);
  useEffect(() => { api.get("/stats/public").then(setStats).catch(() => {}); }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.navy }}>
        <Loading label="Loading Sail More Now…" />
      </View>
    );
  }
  if (user && !user.onboarding_complete) return <Redirect href="/onboarding" />;
  if (user) return <Redirect href="/(tabs)/feed" />;

  const path = PATHS[pathIdx];
  // At large accessibility text the 2-column "What you get" cards break words
  // mid-word (narrow columns). Above this font scale, switch to a single column
  // so every title wraps at word boundaries with room to spare.
  const singleCol = PixelRatio.getFontScale() >= 1.3;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }} testID="home-scroll">
        {/* Hero */}
        <View style={styles.heroWrap}>
          <Image accessibilityElementsHidden importantForAccessibility="no-hide-descendants" source={{ uri: HERO_IMG }} resizeMode="cover" style={StyleSheet.absoluteFill} />
          <LinearGradient colors={["rgba(31,63,91,0.78)", "rgba(31,63,91,0.98)"]} style={StyleSheet.absoluteFill} />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(31,63,91,0.28)" }]} />
          {/* Round brand logo as a faint watermark (kept within screen width) */}
          <Image accessibilityElementsHidden importantForAccessibility="no-hide-descendants" source={{ uri: LOGO_ROUND }} style={styles.heroWatermark} resizeMode="contain" />
          <SafeAreaView edges={["top"]} style={styles.heroContent}>
            <Text style={styles.h1}>More time on the water <Text style={styles.h1Accent}>starts here.</Text></Text>
            <Text style={styles.sub}>
              All the sailing resources you need for planning, promoting, hiring, and connecting. All in one place.{"\n"}Less searching. More sailing.
            </Text>
            <View style={styles.actions}>
              <Button title="Create account" icon="person-add-outline" onPress={() => router.push("/register")} testID="create-account-btn" />
              <Button title="Sign in" variant="secondary" icon="log-in-outline" onPress={() => router.push("/signin")} testID="signin-btn" />
              <Pressable onPress={login} disabled={signingIn} testID="google-signin-btn" style={styles.googleBtn}>
                <Icon name="logo-google" size={18} color="#fff"  footprint={18}/>
                <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={styles.googleText}>{signingIn ? "Opening…" : "Continue with Google"}</Text>
              </Pressable>
            </View>
            <Text style={styles.legal}>Free for sailors, owners & organizations{"\n"}Boat Pros from $19.99/mo</Text>
          </SafeAreaView>
        </View>

        {/* Social proof */}
        {SHOW_LIVE_COUNTERS && stats && (
          <View style={[styles.statStrip, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="home-stats">
            {[
              { n: stats.members, l: "Members" },
              { n: stats.boat_pros, l: "Boat Pros" },
              { n: stats.upcoming_events, l: "Events" },
              { n: stats.markets, l: "Markets" },
            ].map((s) => (
              <View key={s.l} style={styles.statItem}>
                <Text style={[styles.statNum, { color: colors.accent }]}>{s.n}</Text>
                <Text style={[styles.statLbl, { color: colors.onSurfaceSecondary }]}>{s.l}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Everything in one hub */}
        <View style={styles.section}>
          <Text style={[styles.kicker, { color: colors.teal }]}>WHAT YOU GET</Text>
          <Text style={[styles.h2, { color: colors.onSurface }]}>One hub for every part of PNW sailing life.</Text>
          <View style={styles.featGrid}>
            {FEATURES.map((f) => (
              <View key={f.title} style={[styles.featCard, { width: singleCol ? "100%" : "47.5%", backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.featIcon, { backgroundColor: colors.teal + "22" }]}>
                  <Icon name={f.icon} size={20} tone="brand" footprint={20} />
                </View>
                <Text style={[styles.featTitle, { color: colors.onSurface }]}>{f.title}</Text>
                <Text style={[styles.featDesc, { color: colors.onSurfaceSecondary }]}>{f.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Find your place — account-type pins */}
        <View style={styles.section}>
          <Text style={[styles.kicker, { color: colors.teal }]}>FIND YOUR PLACE</Text>
          <Text style={[styles.h2, { color: colors.onSurface }]}>Pick the account that fits you.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 12 }}>
            {PATHS.map((p, i) => {
              const active = i === pathIdx;
              return (
                <Pressable
                  key={p.key}
                  testID={`path-pin-${p.key}`}
                  onPress={() => setPathIdx(i)}
                  style={[styles.pin, active
                    ? (scheme === "dark"
                        ? { backgroundColor: colors.tealSoft, borderColor: colors.teal, borderWidth: 2 }
                        : { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary })
                    : { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Icon name={p.icon} size={16} color={active ? (scheme === "dark" ? colors.teal : colors.onBrandPrimary) : colors.onSurfaceSecondary}  footprint={16}/>
                  <Text style={{ color: active ? (scheme === "dark" ? colors.teal : colors.onBrandPrimary) : colors.onSurfaceSecondary, fontWeight: "700", fontSize: 13.5 }}>{p.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={[styles.pathCard, { backgroundColor: colors.surface, borderColor: colors.border }]} testID={`path-card-${path.key}`}>
            <View style={styles.pathHead}>
              <View style={[styles.featIcon, { backgroundColor: colors.accent + "22" }]}>
                <Icon name={path.icon} size={22} color={colors.accent}  footprint={22}/>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.pathTitle, { color: colors.onSurface }]}>{path.label}</Text>
                <Text style={[styles.pathPrice, { color: colors.teal }]}>{path.price}</Text>
              </View>
            </View>
            <Text style={[styles.pathTagline, { color: colors.onSurfaceSecondary }]}>{path.tagline}</Text>
            <View style={{ gap: 10, marginTop: 4 }}>
              {path.free.map((perk) => (
                <View key={perk} style={styles.perkRow}>
                  <Icon name="checkmark-circle" size={18} color={colors.teal}  footprint={18}/>
                  <Text style={[styles.perkText, { color: colors.onSurface }]}>{perk}</Text>
                </View>
              ))}
            </View>

            {path.partner ? (
              <Button title="Join for free" icon="arrow-forward" onPress={() => router.push("/register?role=partner")} testID="path-join-partner" style={{ marginTop: 14 }} />
            ) : null}

            <View style={[styles.upgradeBlock, { borderColor: colors.border, backgroundColor: colors.accent + "0F" }]} testID={`path-upgrade-${path.key}`}>
              <View style={styles.upgradeHead}>
                <Icon name={path.partner ? "ribbon-outline" : "rocket-outline"} size={16} color={colors.accent}  footprint={16}/>
                <Text style={[styles.upgradeTitle, { color: colors.accent, flex: 1 }, path.partner && styles.upgradeTitlePartner]}>{path.premiumTitle}</Text>
              </View>
              {path.premiumNote ? <Text style={[styles.upgradeNote, { color: colors.onSurfaceSecondary }]}>{path.premiumNote}</Text> : null}
              <View style={{ gap: 8, marginTop: 10 }}>
                {path.premium.map((perk) => (
                  <View key={perk} style={styles.perkRow}>
                    <Icon name="add-circle" size={17} color={colors.accent}  footprint={17}/>
                    <Text style={[styles.perkText, { color: colors.onSurface }]}>{perk}</Text>
                  </View>
                ))}
              </View>
            </View>

            {path.partner ? (
              <Button title="Let's Chat" icon="chatbubbles-outline" onPress={() => router.push("/become-partner")} testID="partner-lets-chat-btn" style={{ marginTop: 14 }} />
            ) : (
              <Button title={`Join as ${path.label}`} icon="arrow-forward" onPress={() => router.push("/register")} testID={`path-join-${path.key}`} style={{ marginTop: 14 }} />
            )}
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
          <FoundingWall />
        </View>

        {/* Final CTA */}
        <View style={[styles.ctaWrap, { backgroundColor: colors.brandPrimary }]}>
          <Text style={styles.ctaH}>Ready to sail more?</Text>
          <Text style={styles.ctaSub}>Join your local sailing community in under a minute.</Text>
          <Button title="Create your account" icon="person-add-outline" onPress={() => router.push("/register")} testID="cta-create-btn" style={{ marginTop: 16 }} />
          <Pressable onPress={login} disabled={signingIn} testID="cta-google-btn" style={styles.googleBtn}>
            <Icon name="logo-google" size={18} color="#fff"  footprint={18}/>
            <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={styles.googleText}>{signingIn ? "Opening…" : "Continue with Google"}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  heroWrap: { backgroundColor: "#1F3F5B", paddingHorizontal: 24, paddingBottom: 28, overflow: "hidden" },
  heroContent: { paddingTop: 24 },
  heroWatermark: { position: "absolute", top: 36, right: 12, width: 168, height: 168, opacity: 0.16 },
  logo: { width: 286, height: 55, marginTop: 4 },
  eyebrow: { color: "#55B3AD", fontWeight: "800", letterSpacing: 1.6, fontSize: 12, marginTop: 24 },
  h1: { color: "#fff", fontSize: 36, fontWeight: "800", lineHeight: 40, letterSpacing: -1, marginTop: 10 },
  h1Accent: { color: "#F2A03B" },
  sub: { color: "#CBD5E1", fontSize: 15, lineHeight: 22, marginTop: 14 },
  actions: { marginTop: 22, gap: 12 },
  googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.5)", marginTop: 12 },
  googleText: { color: "#fff", fontWeight: "700", fontSize: 16, flexShrink: 1, textAlign: "center" },
  legal: { color: "#94A3B8", fontSize: 12.5, textAlign: "center", marginTop: 14 },

  section: { paddingHorizontal: 20, paddingTop: 28 },
  kicker: { fontWeight: "800", letterSpacing: 1.4, fontSize: 11.5 },
  h2: { fontSize: 23, fontWeight: "800", letterSpacing: -0.5, lineHeight: 29, marginTop: 6 },

  featGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16 },
  featCard: { width: "47.5%", borderRadius: 16, borderWidth: 1, padding: 14 },
  featIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  featTitle: { fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  featDesc: { fontSize: 12.5, lineHeight: 17.5, marginTop: 4 },

  pin: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  pathCard: { borderRadius: 20, borderWidth: 1, padding: 18 },
  pathHead: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  pathTitle: { fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
  pathPrice: { fontSize: 13, fontWeight: "700", marginTop: 2 },
  pathTagline: { fontSize: 14.5, lineHeight: 20, marginBottom: 14 },
  perkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  perkText: { fontSize: 14, fontWeight: "600", flex: 1 },

  upgradeBlock: { borderRadius: 16, borderWidth: 1, padding: 14, marginTop: 16 },
  upgradeHead: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  upgradeTitle: { fontSize: 13, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase" },
  upgradeTitlePartner: { fontSize: 15.5, letterSpacing: -0.2, textTransform: "none" },
  upgradeNote: { fontSize: 12.5, lineHeight: 17, marginTop: 6 },

  statStrip: { flexDirection: "row", justifyContent: "space-around", marginHorizontal: 20, marginTop: -20, borderRadius: 18, borderWidth: 1, paddingVertical: 16, paddingHorizontal: 8, elevation: 3, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  statItem: { alignItems: "center" },
  statNum: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  statLbl: { fontSize: 11, fontWeight: "600", marginTop: 2 },

  ctaWrap: { margin: 20, marginTop: 28, borderRadius: 24, padding: 24 },
  ctaH: { color: "#fff", fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  ctaSub: { color: "#CBD5E1", fontSize: 14.5, lineHeight: 20, marginTop: 6 },
});
