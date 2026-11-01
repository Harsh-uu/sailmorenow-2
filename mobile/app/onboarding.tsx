import { useEffect, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { TERMS_URL, PRIVACY_URL } from "@/src/constants/legal";

import { Screen } from "@/src/components/Screen";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { Button, Loading } from "@/src/components/ui";
import { useAuth } from "@/src/context/AuthContext";
import { api, ApiError } from "@/src/lib/api";
import { useTheme } from "@/src/theme";
import { ACCOUNT_TYPE_LABELS } from "@/src/lib/format";

const ACCOUNT_TYPES = ["sailor", "boat_owner", "boat_pro", "partner"] as const;

const roleHome = (at?: string | null) =>
  at === "boat_pro" ? "/(tabs)/my-listing"
    : at === "partner" ? "/(tabs)/my-events"
      : at === "sailor" ? "/(tabs)/crew"
        : "/(tabs)/feed";

export default function Onboarding() {
  const { user, refresh } = useAuth();
  const { colors } = useTheme();
  const [markets, setMarkets] = useState<string[]>([]);
  const [reasonsList, setReasonsList] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [accountType, setAccountType] = useState<string | null>(null);
  const [primaryMarket, setPrimaryMarket] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [agreed, setAgreed] = useState(false);
  const handleKb = useKbField("onb-handle");
  const bioKb = useKbField("onb-bio");

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<{ markets: string[]; reasons: string[] }>("/markets");
        setMarkets(data.markets || []);
        setReasonsList(data.reasons || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (user?.handle) setHandle(user.handle);
  }, [user?.handle]);

  if (!user) return <Redirect href="/" />;
  if (user.onboarding_complete) return <Redirect href={roleHome(user.account_type) as any} />;

  const toggleReason = (r: string) =>
    setReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const submit = async () => {
    if (!accountType) return Alert.alert("Pick an account type");
    if (!primaryMarket) return Alert.alert("Pick your home market");
    if (!agreed) return Alert.alert("Please agree to the community policies");
    setSubmitting(true);
    try {
      await api.patch("/auth/onboarding", {
        account_type: accountType,
        primary_market: primaryMarket,
        markets: [primaryMarket],
        reasons,
        handle: handle.trim() ? handle.trim() : undefined,
        bio: bio.trim() || undefined,
        newsletter_opt_in: true,
        policies_agreed: true,
      });
      await refresh();
      router.replace(roleHome(accountType) as any);
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof ApiError ? e.message : "Try again");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Screen title="Welcome aboard">
        <Loading />
      </Screen>
    );
  }

  return (
    <KeyboardFormScreen
      title="Welcome aboard"
      testID="onboarding-scroll"
      footer={<Button title="Finish setup" onPress={submit} loading={submitting} testID="onboarding-submit-btn" style={{ flex: 1 }} />}
    >
        <Text style={[styles.lead, { color: colors.muted }]}>
          Tell us a little about you so we can tailor Sail More Now to your market.
        </Text>

        <Label>I am a…</Label>
        <View style={styles.grid}>
          {ACCOUNT_TYPES.map((t) => (
            <Pressable
              key={t}
              testID={`account-type-${t}`}
              onPress={() => setAccountType(t)}
              style={[
                styles.gridItem,
                {
                  borderColor: accountType === t ? colors.teal : colors.border,
                  backgroundColor: accountType === t ? colors.tealSoft : colors.surface,
                },
              ]}
            >
              <Text style={[styles.gridText, { color: colors.onSurface }]}>{ACCOUNT_TYPE_LABELS[t]}</Text>
            </Pressable>
          ))}
        </View>

        <Label>Home market</Label>
        <View style={styles.chipsWrap}>
          {markets.map((m) => (
            <Pressable
              key={m}
              testID={`market-${m}`}
              onPress={() => setPrimaryMarket(m)}
              style={[
                styles.pill,
                {
                  borderColor: primaryMarket === m ? colors.brandPrimary : colors.border,
                  backgroundColor: primaryMarket === m ? colors.brandPrimary : colors.surface,
                },
              ]}
            >
              <Text style={{ color: primaryMarket === m ? colors.onBrandPrimary : colors.onSurfaceSecondary, fontWeight: "600", fontSize: 13 }}>
                {m}
              </Text>
            </Pressable>
          ))}
        </View>

        {accountType === "sailor" || accountType === "boat_owner" ? (
          <>
            <Label>What brings you here? (optional)</Label>
            <View style={styles.chipsWrap}>
              {reasonsList.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => toggleReason(r)}
                  style={[
                    styles.pill,
                    {
                      borderColor: reasons.includes(r) ? colors.teal : colors.border,
                      backgroundColor: reasons.includes(r) ? colors.tealSoft : colors.surface,
                    },
                  ]}
                >
                  <Text style={{ color: colors.onSurfaceSecondary, fontWeight: "600", fontSize: 13 }}>{r}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <View onLayout={handleKb.onLayout}>
          <Label>Choose a username (optional)</Label>
          <View style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={{ color: colors.muted, fontSize: 15 }}>@</Text>
            <TextInput
              testID="handle-input"
              value={handle}
              onFocus={handleKb.onFocus}
              onChangeText={setHandle}
              placeholder="yourusername"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={{ flex: 1, fontSize: 15, color: colors.onSurface, marginLeft: 4 }}
            />
          </View>
        </View>

        <View onLayout={bioKb.onLayout}>
          <Label>Short bio (optional)</Label>
          <TextInput
            testID="bio-input"
            value={bio}
            onFocus={bioKb.onFocus}
            onChangeText={setBio}
            placeholder="A sentence about you…"
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.textarea, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }]}
          />
        </View>

        <Pressable testID="policies-checkbox" onPress={() => setAgreed((v) => !v)} style={styles.checkRow}>
          <Icon
            name={agreed ? "checkbox" : "square-outline"}
            size={24}
            color={agreed ? colors.teal : colors.muted}
           footprint={24}/>
          <Text style={{ color: colors.onSurfaceSecondary, flex: 1, fontSize: 14 }}>
            I agree to the{" "}
            <Text style={{ color: colors.teal, fontWeight: "700" }} onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}>Terms and Conditions</Text>,{" "}
            <Text style={{ color: colors.teal, fontWeight: "700" }} onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}>Privacy Policy</Text> and{" "}
            <Text style={{ color: colors.teal, fontWeight: "700" }} onPress={() => router.push("/community-guidelines")}>Code of Conduct</Text>.
          </Text>
        </Pressable>
      </KeyboardFormScreen>
  );
}

function Label({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.label, { color: colors.onSurface }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  lead: { fontSize: 15, lineHeight: 21, marginBottom: 8 },
  label: { fontSize: 15, fontWeight: "800", marginTop: 22, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  gridItem: { width: "47%", borderWidth: 1.5, borderRadius: 14, paddingVertical: 18, alignItems: "center" },
  gridText: { fontWeight: "700", fontSize: 15 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  input: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 50 },
  textarea: { borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 80, textAlignVertical: "top", fontSize: 15 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 24, marginBottom: 8 },
});
