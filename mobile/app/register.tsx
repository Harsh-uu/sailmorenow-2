import { useEffect, useRef, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Image } from "expo-image";
import { Keyboard, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { MotionModal as Modal } from "@/src/components/MotionModal";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { TERMS_URL, PRIVACY_URL } from "@/src/constants/legal";

import { Screen } from "@/src/components/Screen";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { Button, ButtonRow } from "@/src/components/ui";
import { GoogleButton } from "@/src/components/GoogleButton";
import { useAuth } from "@/src/context/AuthContext";
import { api, ApiError } from "@/src/lib/api";
import { useTheme } from "@/src/theme";
import { ACCOUNT_TYPE_LABELS } from "@/src/lib/format";
import { SAILOR_MONTHLY, planPricing, monthOptionsFor, intervalLabel } from "@/src/lib/plans";

const LOGO_COLOR = "https://customer-assets-7cd3h4nn.emergentagent.net/job_nw-sailing-community/artifacts/lltelpvx_SMN_Logo_Horizontal.webp";
const LOGO_WHITE = "https://customer-assets-7cd3h4nn.emergentagent.net/job_nw-sailing-community/artifacts/8xa15w4k_SMN_Logo_Horizontal_DarkBG.webp";

const ACCOUNT_TYPES = ["sailor", "boat_owner", "boat_pro", "partner"] as const;
const ROLE_CARD_LABELS: Record<string, string> = { ...ACCOUNT_TYPE_LABELS, partner: "Club/Org" };
const EXTRA_FIELD: Record<string, { key: "boat_name" | "company_name" | "org_name"; label: string; placeholder: string } | null> = {
  sailor: null,
  boat_owner: { key: "boat_name", label: "Boat name (optional)", placeholder: "e.g. Sea Breeze" },
  boat_pro: { key: "company_name", label: "Company name", placeholder: "Your business" },
  partner: { key: "org_name", label: "Organization / club name", placeholder: "Your org or club" },
};

const PRO_PLANS = [
  { key: "basic", label: "Basic", note: "Email/website, 1+ Categories, Local market, 2-way reviews, Direct messaging", price: "12.99" },
  { key: "featured", label: "Featured", note: "Everything in Basic, 2 markets, Logo & cover photo, Enhanced listing", price: "19.99" },
  { key: "premium", label: "Premium", note: "Everything in Featured, Unlimited markets, 5 gallery photos, Trust and credentials, Top directory placement", price: "29.99" },
];

const PW_RULES = [
  { key: "len", label: "8+ characters", test: (p: string) => p.length >= 8 },
  { key: "upper", label: "One uppercase", test: (p: string) => /[A-Z]/.test(p) },
  { key: "num", label: "One number", test: (p: string) => /[0-9]/.test(p) },
  { key: "special", label: "One special character", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];
const pwStrong = (p: string) => PW_RULES.every((r) => r.test(p));

export default function Register() {
  const { register, login, signingIn } = useAuth();
  const { colors, scheme } = useTheme();
  const { role } = useLocalSearchParams<{ role?: string }>();
  const [markets, setMarkets] = useState<string[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [accountType, setAccountType] = useState<string | null>(
    role && (ACCOUNT_TYPES as readonly string[]).includes(role) ? role : null,
  );
  const [plan, setPlan] = useState<string>(role === "partner" ? "free" : "");
  const [billingMonths, setBillingMonths] = useState(1);
  const discountFor = (m: number, aud: string | null) => (aud === "boat_pro"
    ? (({ 6: 0.10, 12: 0.20 } as Record<number, number>)[m] || 0)
    : (({ 3: 0.10, 6: 0.15, 12: 0.20 } as Record<number, number>)[m] || 0));
  const pickType = (t: string) => {
    setAccountType(t);
    setPlan(t === "boat_pro" ? "featured" : (t === "sailor" || t === "boat_owner") ? "premium" : "free");
  };
  const [market, setMarket] = useState<string | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);
  const [orgCategories, setOrgCategories] = useState<string[]>([]);
  const [orgCats, setOrgCats] = useState<string[]>([]);
  const [orgCatOpen, setOrgCatOpen] = useState(false);
  const [extra, setExtra] = useState("");
  const [boatMakeModel, setBoatMakeModel] = useState("");
  const [newsletter, setNewsletter] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const pwRef = useRef<TextInput>(null);
  const [step, setStep] = useState(1);
  const nameRowKb = useKbField("reg-name-row");
  const emailKb = useKbField("reg-email");
  const pwKb = useKbField("reg-pw");
  const extraKb = useKbField("reg-extra");
  const boatKb = useKbField("reg-boat");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const extraRequired = accountType === "boat_pro" || accountType === "partner";
  const step1Ok = !!accountType;
  const step2Ok = !!(firstName.trim() && lastName.trim() && email.trim() && pwStrong(password) && (!extraRequired || extra.trim()));

  const goNext = async () => {
    setError(null);
    if (step === 1) {
      if (!step1Ok) return setError("Choose an account type");
      return setStep(2);
    }
    if (step === 2) {
      if (!firstName.trim() || !lastName.trim()) return setError("Enter your first and last name");
      if (!email.trim()) return setError("Enter your email");
      if (!pwStrong(password)) return setError("Please choose a stronger password (see the checklist)");
      if (extraRequired && !extra.trim()) return setError(`Enter your ${accountType === "partner" ? "organization / club name" : "company name"}`);
      // Check the email is not already registered BEFORE asking for the rest.
      setCheckingEmail(true);
      try {
        const res = await api.get<{ available: boolean }>(`/auth/check-email?email=${encodeURIComponent(email.trim())}`);
        if (!res.available) {
          setEmailError("An account with this email already exists. Sign in or use Forgot password.");
          return;
        }
      } catch {
        // If the availability check fails (offline etc.), let register be the backstop.
      } finally {
        setCheckingEmail(false);
      }
      setEmailError(null);
      return setStep(3);
    }
  };
  const goBack = () => { setError(null); setStep((s) => Math.max(1, s - 1)); };

  useEffect(() => {
    api.get<{ markets: string[]; org_categories?: string[] }>("/markets")
      .then((d) => { setMarkets(d.markets || []); setOrgCategories(d.org_categories || []); })
      .catch(() => {});
  }, []);

  const extraCfg = accountType ? EXTRA_FIELD[accountType] : null;

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim()) return setError("Enter your first and last name");
    if (!email.trim()) return setError("Enter your email");
    if (!pwStrong(password)) return setError("Please choose a stronger password (see the checklist)");
    if (!accountType) return setError("Choose an account type");
    if (!market) return setError("Choose your home market");
    if (!agreed) return setError("Please confirm you are 18+ and agree to the Code of Conduct");
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        password,
        primary_market: market,
        account_type: accountType,
        newsletter_opt_in: newsletter,
        agreed_to_guidelines: agreed,
      };
      if (extraCfg && extra.trim()) payload[extraCfg.key] = extra.trim();
      if (accountType === "partner" && orgCats.length) payload.org_categories = orgCats;
      if (accountType === "boat_owner" && boatMakeModel.trim()) payload.boat_make_model = boatMakeModel.trim();
      await register(payload);
      const paidPro = accountType === "boat_pro" && ["basic", "featured", "premium"].includes(plan);
      const paidSailor = (accountType === "sailor" || accountType === "boat_owner") && plan === "premium";
      if (paidPro) router.replace(`/pricing?tier=${plan}&months=${billingMonths}&signup=1`);
      else if (paidSailor) router.replace(`/pricing?months=${billingMonths}&signup=1`);
      else router.replace("/(tabs)/feed");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setEmailError("An account with this email already exists. Sign in or use Forgot password.");
        setStep(2);
      } else {
        setError(e instanceof ApiError ? e.message : "Registration failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardFormScreen
      title="Create account"
      testID="register-scroll"
      footer={step === 1 ? undefined : (
        <ButtonRow
          style={{ flex: 1 }}
          buttons={step === 2
            ? [
                { title: "Back", variant: "secondary", testID: "reg-back-btn", onPress: goBack },
                { title: checkingEmail ? "Checking" : "Next", loading: checkingEmail, disabled: !step2Ok || checkingEmail, testID: "reg-next-btn", onPress: goNext },
              ]
            : [
                { title: "Back", variant: "secondary", testID: "reg-back-btn", onPress: goBack },
                { title: "Create account", loading: busy, disabled: !market || !agreed, testID: "reg-submit-btn", onPress: submit },
              ]}
        />
      )}
    >
        <Pressable onPress={Keyboard.dismiss} accessible={false}>
        <Image source={{ uri: scheme === "dark" ? LOGO_WHITE : LOGO_COLOR }} style={{ width: 220, height: 64, alignSelf: "center", marginBottom: 10 }} contentFit="contain" testID="reg-logo" />
        <Text style={[styles.lead, { color: colors.onSurface }]}>Join Sail More Now</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>The PNW sailing community - free to join.</Text>

        <View style={styles.steps} testID="reg-progress">
          {[1, 2, 3].map((s) => (
            <View key={s} style={{ flex: 1, alignItems: "center", gap: 4 }}>
              <View style={[styles.stepBar, { backgroundColor: step >= s ? colors.teal : colors.border }]} />
              <Text style={{ fontSize: 10.5, fontWeight: "700", color: step >= s ? colors.teal : colors.muted }}>
                {s === 1 ? "Account type" : s === 2 ? "Your details" : "Finish"}
              </Text>
            </View>
          ))}
        </View>

        {step === 1 ? (
          <>
            <Label>I am a…</Label>
            <View style={styles.grid}>
              {ACCOUNT_TYPES.map((t) => (
                <Pressable
                  key={t}
                  testID={`reg-type-${t}`}
                  onPress={() => pickType(t)}
                  style={[styles.gridItem, { borderColor: accountType === t ? colors.teal : colors.border, backgroundColor: accountType === t ? colors.tealSoft : colors.surface }]}
                >
                  <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 14, textAlign: "center" }}>{ROLE_CARD_LABELS[t]}</Text>
                </Pressable>
              ))}
            </View>

            {accountType === "boat_pro" ? (
              <View testID="reg-plan-pro" style={{ marginTop: 6, gap: 8 }}>
                <Label>Choose your listing plan</Label>
                {PRO_PLANS.map((p) => (
                  <Pressable key={p.key} testID={`reg-plan-${p.key}`} onPress={() => setPlan(p.key)}
                    style={[styles.planRow, { borderColor: plan === p.key ? colors.accent : colors.border, backgroundColor: plan === p.key ? colors.accentSoft : colors.surface }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 14 }}>{p.label}</Text>
                      <Text style={{ color: colors.muted, fontSize: 11.5 }}>{p.note}</Text>
                    </View>
                    <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 14 }}>${p.price}<Text style={{ color: colors.muted, fontSize: 11, fontWeight: "500" }}>/mo</Text></Text>
                  </Pressable>
                ))}
                {plan !== "free" ? (
                  <>
                    <Text style={{ color: colors.muted, fontSize: 11.5 }}>Save with longer plans - pick a billing length:</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {monthOptionsFor("boat_pro").map((m) => {
                        const on = billingMonths === m; const pr = planPricing("boat_pro", plan, m);
                        return (
                          <Pressable key={m} testID={`reg-months-${m}`} onPress={() => setBillingMonths(m)}
                            style={{ borderWidth: 1, borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.accentSoft : colors.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
                            <Text style={{ color: on ? colors.onSurface : colors.onSurfaceSecondary, fontWeight: "700", fontSize: 12 }}>{m} mo · ${pr.perMonth.toFixed(2)}/mo{pr.discount > 0 ? ` · ${pr.discount * 100}% off` : ""}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text testID="reg-plan-total" style={{ color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" }}>Total ${planPricing("boat_pro", plan, billingMonths).total.toFixed(2)} billed {intervalLabel(billingMonths)}</Text>
                  </>
                ) : null}
                <Pressable testID="reg-plan-free" onPress={() => setPlan("free")}>
                  <Text style={{ color: plan === "free" ? colors.teal : colors.muted, fontSize: 12.5, fontWeight: "700", textDecorationLine: plan === "free" ? "underline" : "none" }}>
                    Or continue with a free account (no business listing)
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {accountType === "sailor" || accountType === "boat_owner" ? (
              <View testID="reg-plan-sailor" style={{ marginTop: 6, gap: 8 }}>
                <Label>Choose your plan</Label>
                <Pressable testID="reg-plan-premium" onPress={() => setPlan("premium")}
                  style={[styles.planRow, { borderColor: plan === "premium" ? colors.accent : colors.border, backgroundColor: plan === "premium" ? colors.accentSoft : colors.surface }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 14 }}>Premium</Text>
                    <Text style={{ color: colors.muted, fontSize: 11.5 }}>Direct messaging, Posting & reactions, Writing reviews, Crew Bank listing, ID-verified badge</Text>
                  </View>
                  <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 14 }}>${SAILOR_MONTHLY.toFixed(2)}<Text style={{ color: colors.muted, fontSize: 11, fontWeight: "500" }}>/mo</Text></Text>
                </Pressable>
                {plan !== "free" ? (
                  <>
                    <Text style={{ color: colors.muted, fontSize: 11.5 }}>Save with longer plans - pick a billing length:</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {monthOptionsFor(accountType || "sailor").map((m) => {
                        const on = billingMonths === m; const pr = planPricing("sailor", "premium", m);
                        return (
                          <Pressable key={m} testID={`reg-months-${m}`} onPress={() => setBillingMonths(m)}
                            style={{ borderWidth: 1, borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.accentSoft : colors.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
                            <Text style={{ color: on ? colors.onSurface : colors.onSurfaceSecondary, fontWeight: "700", fontSize: 12 }}>{m} mo · ${pr.perMonth.toFixed(2)}/mo{pr.discount > 0 ? ` · ${pr.discount * 100}% off` : ""}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text testID="reg-plan-total" style={{ color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" }}>Total ${planPricing("sailor", "premium", billingMonths).total.toFixed(2)} billed {intervalLabel(billingMonths)}</Text>
                  </>
                ) : null}
                <Pressable testID="reg-plan-free" onPress={() => setPlan("free")}>
                  <Text style={{ color: plan === "free" ? colors.teal : colors.muted, fontSize: 12.5, fontWeight: "700", textDecorationLine: plan === "free" ? "underline" : "none" }}>
                    Or continue with a free account
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {accountType === "partner" ? (
              <View testID="reg-plan-partner" style={[styles.planRow, { borderColor: colors.teal, backgroundColor: colors.tealSoft, marginTop: 6 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 14 }}>Clubs & Orgs join free</Text>
                  <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2, lineHeight: 16 }}>Become a Community Partner to unlock unlimited postings, direct messaging, priority placement, and more. Upgrade anytime.</Text>
                </View>
              </View>
            ) : null}

            {error ? <Text testID="reg-error" style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
            <Button title="Next" onPress={goNext} disabled={!step1Ok} testID="reg-next-btn" style={{ marginTop: 16 }} />

            <View style={styles.divider}>
              <View style={[styles.line, { backgroundColor: colors.border }]} />
              <Text style={{ color: colors.muted, fontSize: 12 }}>OR</Text>
              <View style={[styles.line, { backgroundColor: colors.border }]} />
            </View>
            <GoogleButton onPress={login} loading={signingIn} testID="reg-google-btn" />

            <Pressable onPress={() => router.replace("/signin")} style={{ marginTop: 20 }}>
              <Text style={{ color: colors.muted, textAlign: "center", fontSize: 14 }}>
                Already have an account? <Text style={{ color: colors.teal, fontWeight: "700" }}>Sign in</Text>
              </Text>
            </Pressable>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <View onLayout={nameRowKb.onLayout} style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Label>First name</Label>
                <TextInput testID="reg-first-input" value={firstName} onFocus={nameRowKb.onFocus} onChangeText={setFirstName} placeholder="First" placeholderTextColor={colors.muted} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => lastRef.current?.focus()} style={inp(colors)} />
              </View>
              <View style={{ flex: 1 }}>
                <Label>Last name</Label>
                <TextInput ref={lastRef} testID="reg-last-input" value={lastName} onFocus={nameRowKb.onFocus} onChangeText={setLastName} placeholder="Last" placeholderTextColor={colors.muted} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => emailRef.current?.focus()} style={inp(colors)} />
              </View>
            </View>

            <View onLayout={emailKb.onLayout}>
              <Label>Email</Label>
              <TextInput ref={emailRef} testID="reg-email-input" value={email} onFocus={emailKb.onFocus} onChangeText={(v) => { setEmail(v); if (emailError) setEmailError(null); }} placeholder="you@example.com" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="email-address" returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => pwRef.current?.focus()} style={[inp(colors), emailError ? { borderColor: colors.error } : null]} />
              {emailError ? <Text testID="reg-email-error" style={[styles.error, { color: colors.error, marginTop: 6 }]}>{emailError}</Text> : null}
            </View>

            <View onLayout={pwKb.onLayout}>
              <Label>Password</Label>
              <View style={[styles.pwWrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <TextInput ref={pwRef} testID="reg-password-input" value={password} onFocus={pwKb.onFocus} onChangeText={setPassword} placeholder="Create a strong password" placeholderTextColor={colors.muted} secureTextEntry={!show} autoCapitalize="none" returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} style={{ flex: 1, fontSize: 15, color: colors.onSurface }} />
                <Pressable onPress={() => setShow((s) => !s)} hitSlop={8}>
                  <Icon name={show ? "eye-off-outline" : "eye-outline"} size={20} color={colors.muted}  footprint={20}/>
                </Pressable>
              </View>
            </View>
            <View style={styles.pwChecklist} testID="pw-checklist">
              {PW_RULES.map((r) => {
                const ok = r.test(password);
                return (
                  <View key={r.key} testID={`pw-rule-${r.key}`} style={styles.pwRule}>
                    <Icon name={ok ? "checkmark-circle" : "ellipse-outline"} size={15} color={ok ? colors.teal : colors.muted} footprint={15} />
                    <Text style={{ color: ok ? colors.teal : colors.muted, fontSize: 12.5 }}>{r.label}</Text>
                  </View>
                );
              })}
            </View>

            {extraCfg ? (
              <View onLayout={extraKb.onLayout}>
                <Label>{extraCfg.label}</Label>
                <TextInput testID="reg-extra-input" value={extra} onFocus={extraKb.onFocus} onChangeText={setExtra} placeholder={extraCfg.placeholder} placeholderTextColor={colors.muted} style={inp(colors)} />
              </View>
            ) : null}

            {accountType === "boat_owner" ? (
              <View onLayout={boatKb.onLayout}>
                <Label>Boat make/model (optional)</Label>
                <TextInput testID="reg-boat-make-model-input" value={boatMakeModel} onFocus={boatKb.onFocus} onChangeText={setBoatMakeModel} maxLength={80} placeholder="e.g. Catalina 30" placeholderTextColor={colors.muted} style={inp(colors)} />
              </View>
            ) : null}

            {accountType === "partner" ? (
              <>
                <Label>Category (select all that apply)</Label>
                <Pressable testID="reg-orgcat-select" onPress={() => setOrgCatOpen(true)}
                  style={[styles.select, { borderColor: orgCats.length ? colors.teal : colors.border, backgroundColor: colors.surface }]}>
                  <Text numberOfLines={2} style={{ color: orgCats.length ? colors.onSurface : colors.muted, fontSize: 15, flex: 1, flexShrink: 1, marginRight: 8 }}>
                    {orgCats.length ? orgCats.join(", ") : "Select your category"}
                  </Text>
                  <Icon name="chevron-down" size={18} color={colors.muted} footprint={18} />
                </Pressable>
                <Modal visible={orgCatOpen} transparent animationType="slide" onRequestClose={() => setOrgCatOpen(false)}>
                  <Pressable style={styles.marketBackdrop} onPress={() => setOrgCatOpen(false)}>
                    <Pressable style={[styles.marketSheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
                      <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 16, padding: 16, paddingBottom: 8 }}>Club / Org category</Text>
                      <ScrollView style={{ maxHeight: 360 }}>
                        {orgCategories.map((c) => {
                          const on = orgCats.includes(c);
                          return (
                            <Pressable key={c} testID={`reg-orgcat-${c}`}
                              onPress={() => setOrgCats((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])}
                              style={[styles.marketItem, { borderBottomColor: colors.border }]}>
                              <Text style={{ color: on ? colors.teal : colors.onSurface, fontSize: 15, fontWeight: on ? "800" : "500" }}>{c}</Text>
                              {on ? <Icon name="checkmark" size={18} color={colors.teal} footprint={18} /> : null}
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                      <View style={{ padding: 16 }}>
                        <Button title="Done" onPress={() => setOrgCatOpen(false)} testID="reg-orgcat-done" />
                      </View>
                    </Pressable>
                  </Pressable>
                </Modal>
              </>
            ) : null}

            {error ? <Text testID="reg-error" style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Label>Home market</Label>
            <Pressable testID="reg-market-select" onPress={() => setMarketOpen(true)}
              style={[styles.select, { borderColor: market ? colors.teal : colors.border, backgroundColor: colors.surface }]}>
              <Text style={{ color: market ? colors.onSurface : colors.muted, fontSize: 15, flex: 1, flexShrink: 1, marginRight: 8 }}>{market || "Select your home market"}</Text>
              <Icon name="chevron-down" size={18} color={colors.muted} footprint={18} />
            </Pressable>
            <Modal visible={marketOpen} transparent animationType="slide" onRequestClose={() => setMarketOpen(false)}>
              <Pressable style={styles.marketBackdrop} onPress={() => setMarketOpen(false)}>
                <Pressable style={[styles.marketSheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
                  <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 16, padding: 16, paddingBottom: 8 }}>Home market</Text>
                  <ScrollView style={{ maxHeight: 360 }}>
                    {markets.map((m) => {
                      const on = market === m;
                      return (
                        <Pressable key={m} testID={`reg-market-${m}`} onPress={() => { setMarket(m); setMarketOpen(false); }}
                          style={[styles.marketItem, { borderBottomColor: colors.border }]}>
                          <Text style={{ color: on ? colors.teal : colors.onSurface, fontSize: 15, fontWeight: on ? "800" : "500" }}>{m}</Text>
                          {on ? <Icon name="checkmark" size={18} color={colors.teal} footprint={18} /> : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </Pressable>
              </Pressable>
            </Modal>

            <View style={styles.newsRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={{ color: colors.onSurface, fontSize: 14, fontWeight: "700" }}>Sail More Now - the quarterly digest</Text>
                <Text style={{ color: colors.onSurfaceSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 2 }}>Sailing and community events, educational information, and featured Boat Pros. One email a quarter, unsubscribe any time.</Text>
              </View>
              <Switch value={newsletter} onValueChange={setNewsletter} trackColor={{ true: colors.teal }} testID="reg-newsletter-switch" />
            </View>

            <Pressable testID="reg-guidelines" onPress={() => setAgreed((a) => !a)} style={styles.agreeRow}>
              <Icon name={agreed ? "checkbox" : "square-outline"} size={22} color={agreed ? colors.teal : colors.muted} footprint={22} />
              <Text style={{ color: colors.onSurfaceSecondary, flex: 1, fontSize: 13.5, lineHeight: 19 }}>
                I am 18 or older and agree to the{" "}
                <Text style={{ color: colors.teal, fontWeight: "700" }} onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}>Terms and Conditions</Text>,{" "}
                <Text style={{ color: colors.teal, fontWeight: "700" }} onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}>Privacy Policy</Text> and{" "}
                <Text style={{ color: colors.teal, fontWeight: "700" }} onPress={() => router.push("/community-guidelines")}>Code of Conduct</Text>.
              </Text>
            </Pressable>

            {error ? <Text testID="reg-error" style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
          </>
        ) : null}
        </Pressable>
      </KeyboardFormScreen>
  );
}

function Label({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.label, { color: colors.onSurface }]}>{children}</Text>;
}
const inp = (colors: any) => [styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }];

const styles = StyleSheet.create({
  lead: { fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  sub: { fontSize: 14, marginTop: 4 },
  label: { fontSize: 14, fontWeight: "800", marginTop: 18, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 15 },
  pwWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 50 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  gridItem: { width: "47%", borderWidth: 1.5, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  select: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, minHeight: 50, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  marketBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  marketSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "70%", paddingBottom: 20 },
  marketItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1 },
  newsRow: { flexDirection: "row", alignItems: "center", marginTop: 20 },
  agreeRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 16 },
  pwChecklist: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  planRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  pwRule: { flexDirection: "row", alignItems: "center", gap: 5, width: "45%" },
  error: { fontSize: 13.5, marginTop: 12, fontWeight: "600" },
  steps: { flexDirection: "row", gap: 8, marginTop: 18, marginBottom: 4 },
  stepBar: { height: 4, borderRadius: 999, alignSelf: "stretch", width: "100%" },
  navRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 20 },
  line: { flex: 1, height: 1 },
});
