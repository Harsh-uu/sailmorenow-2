import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { Icon } from "@/src/components/Icon";
import { Screen } from "@/src/components/Screen";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { Button, Loading } from "@/src/components/ui";
import { ProfileCardEditor } from "@/src/components/ProfileCardEditor";
import { MultiSelectPicker } from "@/src/components/MultiSelectPicker";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

const TIER_MAX_MARKETS: Record<string, number> = { basic: 1, featured: 2, premium: 999 };
const CRED_FIELDS = [
  { key: "certifications", label: "Certifications", ph: "e.g. USCG OUPV Six-Pack" },
  { key: "licenses", label: "Licenses", ph: "e.g. WA Marine Contractor #ABC123" },
  { key: "insurance", label: "Insurance", ph: "e.g. General Liability $1M - Progressive" },
] as const;
const fmtPhone = (v: string) => {
  const d = (v || "").replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
};

type Photo = { url: string; original?: string };
type Form = {
  company_name: string; business_handle: string; business_email: string; contact_email: string;
  contact_phone: string; website: string; short_bio: string; categories: string[]; markets: string[];
  certifications: string[]; licenses: string[]; insurance: string[];
  logo_url: string; logo_original_url: string; cover_url: string; cover_original_url: string; photos: Photo[];
};

export default function BoatProListingEditor() {
  const { colors } = useTheme();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cats, setCats] = useState<string[]>([]);
  const [marketsAll, setMarketsAll] = useState<string[]>([]);
  const [caps, setCaps] = useState({ can_logo: false, can_cover: false, max_photos: 0 });
  const [tier, setTier] = useState("basic");
  const [otherText, setOtherText] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({ certifications: "", licenses: "", insurance: "" });
  const [emailFallback, setEmailFallback] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [noListing, setNoListing] = useState(false);
  const nameKb = useKbField("pro-name");
  const handleKb = useKbField("pro-handle");
  const contactEmailKb = useKbField("pro-contact-email");
  const bizEmailKb = useKbField("pro-biz-email");
  const websiteKb = useKbField("pro-website");
  const phoneKb = useKbField("pro-phone");
  const otherKb = useKbField("pro-other");
  const bioKb = useKbField("pro-bio");
  const credsKb = useKbField("pro-creds");

  const load = useCallback(async () => {
    try {
      const d = await api.get<any>("/boat-pros/mine");
      setForm({
        company_name: d.company_name || "", business_handle: d.business_handle || "",
        business_email: d.business_email || "", contact_email: d.contact_email || "",
        contact_phone: d.contact_phone || "", website: d.website || "", short_bio: d.short_bio || "",
        categories: d.categories || [], markets: d.markets || [],
        certifications: d.certifications || [], licenses: d.licenses || [], insurance: d.insurance || [],
        logo_url: d.logo_url || "", logo_original_url: d.logo_original_url || "",
        cover_url: d.cover_url || "", cover_original_url: d.cover_original_url || "", photos: d.photos || [],
      });
      setCats(d.categories_all || []);
      setMarketsAll(d.markets_all || []);
      setCaps({ can_logo: !!d.can_logo, can_cover: !!d.can_cover, max_photos: d.max_photos || 0 });
      setTier(d.tier || "basic");
      setEmailFallback(d.business_email_effective || "");
    } catch (e: any) {
      // No listing yet = plan not active. Show a clear "choose a plan" state
      // instead of bouncing back with an error toast.
      if (e?.status === 404) { setNoListing(true); }
      else { toast.error(e?.message || "Couldn't load your listing"); router.back(); }
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const set = (k: keyof Form, v: any) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const isPremium = tier === "premium";
  const maxM = TIER_MAX_MARKETS[tier] || 1;

  const onImageChange = async (partial: any) => {
    const d = await api.patch<any>("/boat-pros/listing", partial);
    setForm((f) => (f ? {
      ...f, logo_url: d.logo_url || "", logo_original_url: d.logo_original_url || "",
      cover_url: d.cover_url || "", cover_original_url: d.cover_original_url || "", photos: d.photos || [],
    } : f));
    if (refresh) refresh();
  };

  const addCred = (key: string) => {
    const v = (drafts[key] || "").trim();
    if (!v) return;
    setForm((f) => (f ? { ...f, [key]: [...(f as any)[key], v] } : f));
    setDrafts((d) => ({ ...d, [key]: "" }));
  };
  const removeCred = (key: string, i: number) =>
    setForm((f) => (f ? { ...f, [key]: ((f as any)[key] as string[]).filter((_, idx) => idx !== i) } : f));

  const backToDirectory = () => {
    if (from === "directory" && router.canGoBack()) router.back();
    else router.push("/directory");
  };

  const save = async () => {
    if (!form) return;
    if (!form.company_name.trim()) { toast.warning("Business name is required"); return; }
    const hasOther = form.categories.includes("Other");
    if (hasOther && !otherText.trim()) { toast.warning("Describe your specialty"); return; }
    const categoriesOut = hasOther
      ? form.categories.map((c) => (c === "Other" ? otherText.trim().slice(0, 60) : c))
      : form.categories;
    setSaving(true);
    try {
      const payload: any = {
        company_name: form.company_name, business_handle: form.business_handle,
        business_email: form.business_email, contact_email: form.contact_email,
        contact_phone: form.contact_phone, website: form.website, short_bio: form.short_bio,
        categories: categoriesOut, markets: form.markets,
      };
      if (isPremium) {
        payload.certifications = form.certifications;
        payload.licenses = form.licenses;
        payload.insurance = form.insurance;
      }
      await api.patch<any>("/boat-pros/listing", payload);
      toast.success("Saved");
      if (refresh) await refresh();
    } catch (e: any) { toast.error(e?.response?.data?.detail?.message || e?.message || "Couldn't save listing"); }
    finally { setSaving(false); }
  };

  if (user && user.account_type !== "boat_pro") {
    return <Screen title="Boat Pro listing" showBack><Text style={{ color: colors.muted, padding: 16 }}>Only Boat Pro accounts have a directory listing.</Text></Screen>;
  }
  if (noListing) {
    return (
      <Screen title="Boat Pro listing" showBack>
        <View style={{ flex: 1, padding: 24, alignItems: "center", justifyContent: "center" }} testID="pro-no-listing-state">
          <Text style={{ color: colors.onSurface, fontSize: 20, fontWeight: "800", textAlign: "center" }}>Your listing is created after your plan is active</Text>
          <Text style={{ color: colors.muted, fontSize: 14, textAlign: "center", marginTop: 10, lineHeight: 20 }}>Choose a Boat Pro plan to publish your directory listing. Your business name carries over, and you can fill in the rest here once your plan is active.</Text>
          <View style={{ marginTop: 20, alignSelf: "stretch" }}>
            <Button title="Choose a plan" onPress={() => router.push("/pricing")} testID="pro-choose-plan-btn" />
          </View>
        </View>
      </Screen>
    );
  }

  const inputStyle = { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: colors.onSurface, backgroundColor: colors.surface, fontSize: 15 };
  const labelStyle = { color: colors.muted, fontSize: 11, fontWeight: "800" as const, letterSpacing: 1, textTransform: "uppercase" as const, marginBottom: 6, marginTop: 16 };
  const hintStyle = { color: colors.muted, fontSize: 11.5, marginTop: 5 };

  if (loading || !form) {
    return <Screen title="Edit Boat Pro Listing" showBack><Loading /></Screen>;
  }

  return (
    <KeyboardFormScreen
      title="Edit Boat Pro Listing"
      testID="pro-listing-scroll"
      footer={<Button title="Save listing" onPress={save} loading={saving} testID="pro-form-save" style={{ flex: 1 }} />}
    >
          <Pressable onPress={backToDirectory} testID="pro-back-directory" accessibilityRole="button" accessibilityLabel="Back to directory"
            style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 }}>
            <Icon name="chevron-back" size={16} color={colors.teal} footprint={16} />
            <Text style={{ color: colors.teal, fontWeight: "800", fontSize: 13 }}>Back to directory</Text>
          </Pressable>

          <Text style={{ color: colors.muted, fontSize: 13.5, lineHeight: 20 }}>
            {caps.can_logo
              ? "Tap the logo, cover, or a gallery slot to edit your photos. Photo changes save automatically."
              : "Upgrade to Featured or Premium to add a logo and cover photo to your card."}
          </Text>

          <View style={{ marginTop: 14 }}>
            <ProfileCardEditor
              data={{
                org_name: form.company_name, handle: form.business_handle || user?.handle || undefined,
                logo_url: form.logo_url, logo_original_url: form.logo_original_url,
                cover_url: form.cover_url, cover_original_url: form.cover_original_url,
                photos: form.photos, isCP: false,
              }}
              badgeLabel="BOAT PRO"
              showLogo={caps.can_logo}
              showCover={caps.can_cover}
              maxPhotos={caps.max_photos}
              accent={colors.navy}
              onImageChange={onImageChange}
              entityKind="boat_pro"
            />
            {!isPremium ? (
              <Text style={hintStyle} testID="gallery-upgrade-hint">
                {caps.can_cover ? "Upgrade to Premium to add a work photo gallery." : "Upgrade to Featured for a logo and cover, or Premium for the full photo gallery."}
              </Text>
            ) : null}
          </View>

          <View onLayout={nameKb.onLayout}>
            <Text style={labelStyle}>Business name</Text>
            <TextInput style={inputStyle} value={form.company_name} onFocus={nameKb.onFocus} onChangeText={(v) => set("company_name", v)} maxLength={120} testID="pro-form-name" placeholderTextColor={colors.muted} />
          </View>

          <View onLayout={handleKb.onLayout}>
            <Text style={labelStyle}>Business username</Text>
            <TextInput style={inputStyle} value={form.business_handle} onFocus={handleKb.onFocus} onChangeText={(v) => set("business_handle", v.replace(/[^A-Za-z0-9_]/g, ""))} autoCapitalize="none" maxLength={30} testID="pro-form-handle" placeholder="your-business" placeholderTextColor={colors.muted} />
          </View>

          <View onLayout={contactEmailKb.onLayout}>
            <Text style={labelStyle}>Public contact email</Text>
            <TextInput style={inputStyle} value={form.contact_email} onFocus={contactEmailKb.onFocus} onChangeText={(v) => set("contact_email", v)} autoCapitalize="none" keyboardType="email-address" testID="pro-form-contact-email" placeholder="you@business.com" placeholderTextColor={colors.muted} />
            <Text style={hintStyle} testID="pro-form-contact-email-hint">Shown on your public listing. Leave blank to show no email.</Text>
          </View>

          <View onLayout={bizEmailKb.onLayout}>
            <Text style={labelStyle}>Business email</Text>
            <TextInput style={inputStyle} value={form.business_email} onFocus={bizEmailKb.onFocus} onChangeText={(v) => set("business_email", v)} autoCapitalize="none" keyboardType="email-address" testID="pro-form-email" placeholder={emailFallback || "you@business.com"} placeholderTextColor={colors.muted} />
            <Text style={hintStyle} testID="pro-form-email-hint">Private. Reserved for your business identity and not shown on your public listing.</Text>
          </View>

          <View onLayout={websiteKb.onLayout}>
            <Text style={labelStyle}>Website</Text>
            <TextInput style={inputStyle} value={form.website} onFocus={websiteKb.onFocus} onChangeText={(v) => set("website", v)} autoCapitalize="none" keyboardType="url" testID="pro-form-website" placeholder="https://..." placeholderTextColor={colors.muted} />
          </View>

          <View onLayout={phoneKb.onLayout}>
            <Text style={labelStyle}>Contact phone</Text>
            <TextInput style={inputStyle} value={form.contact_phone} onFocus={phoneKb.onFocus} onChangeText={(v) => set("contact_phone", fmtPhone(v))} keyboardType="phone-pad" testID="pro-form-phone" placeholder="000-000-0000" placeholderTextColor={colors.muted} />
          </View>

          <Text style={labelStyle}>Specialties</Text>
          <MultiSelectPicker
            label="Specialties" title="Select specialties"
            options={cats.map((c) => ({ value: c, label: c }))}
            value={form.categories} onChange={(next) => set("categories", next)}
            placeholder="Choose specialties" testID="pro-form-categories"
          />
          {form.categories.includes("Other") ? (
            <View onLayout={otherKb.onLayout}>
              <TextInput style={[inputStyle, { marginTop: 8 }]} value={otherText} onFocus={otherKb.onFocus} onChangeText={setOtherText} maxLength={60} testID="pro-form-other" placeholder="Describe your specialty..." placeholderTextColor={colors.muted} />
            </View>
          ) : null}

          <Text style={labelStyle}>{`Markets served · ${form.markets.length}/${maxM === 999 ? "∞" : maxM}`}</Text>
          <MultiSelectPicker
            label="Markets" title="Select markets served"
            options={marketsAll.map((m) => ({ value: m, label: m }))}
            value={form.markets} onChange={(next) => set("markets", next)}
            max={isPremium ? undefined : maxM}
            limitMessage={`Your plan includes ${maxM} market${maxM !== 1 ? "s" : ""}. Upgrade to add more.`}
            onUpgrade={() => router.push("/pricing")}
            placeholder="Choose markets" testID="pro-form-markets"
          />

          <View onLayout={bioKb.onLayout}>
            <Text style={labelStyle}>Short bio</Text>
            <TextInput style={[inputStyle, { minHeight: 110, textAlignVertical: "top" }]} value={form.short_bio} onFocus={bioKb.onFocus} onChangeText={(v) => set("short_bio", v)} multiline maxLength={2000} testID="pro-form-bio" placeholder="What you do and where..." placeholderTextColor={colors.muted} />
          </View>

          {/* Trust & credentials — Premium only */}
          <Text style={labelStyle}>Trust and credentials</Text>
          {isPremium ? (
            <View testID="pro-form-credentials" onLayout={credsKb.onLayout} style={{ gap: 14 }}>
              {CRED_FIELDS.map(({ key, label, ph }) => (
                <View key={key} testID={`creds-${key}`}>
                  <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700", marginBottom: 6 }}>{label}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: (form as any)[key].length ? 8 : 0 }}>
                    {((form as any)[key] as string[]).map((v, i) => (
                      <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceSecondary, borderRadius: 999, paddingLeft: 12, paddingRight: 6, paddingVertical: 6 }}>
                        <Text style={{ color: colors.onSurface, fontSize: 13 }}>{v}</Text>
                        <Pressable testID={`remove-${key}-${i}`} onPress={() => removeCred(key, i)} hitSlop={6}>
                          <Icon name="close-circle" size={18} color={colors.muted} footprint={18} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TextInput style={[inputStyle, { flex: 1 }]} value={drafts[key]} onFocus={credsKb.onFocus} onChangeText={(v) => setDrafts((d) => ({ ...d, [key]: v }))}
                      onSubmitEditing={() => addCred(key)} testID={`input-${key}`} placeholder={ph} placeholderTextColor={colors.muted} />
                    <Button title="Add" variant="secondary" onPress={() => addCred(key)} testID={`add-${key}`} />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View testID="credentials-locked" style={{ flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, padding: 14 }}>
              <Icon name="lock-closed" size={20} color={colors.muted} footprint={20} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.onSurface, fontSize: 13.5, fontWeight: "700", lineHeight: 19 }}>Trust and credentials is part of Premium. Upgrade to show yours on your listing.</Text>
                <Pressable testID="credentials-upgrade" onPress={() => router.push("/pricing")} style={{ marginTop: 8 }}>
                  <Text style={{ color: colors.teal, fontWeight: "800", fontSize: 13 }}>Upgrade</Text>
                </Pressable>
              </View>
            </View>
          )}

          {user?.user_id ? (
            <Button title="View listing" variant="secondary" icon="open-outline" onPress={() => router.push(`/directory/pro/${user.user_id}` as any)} testID="pro-form-view-listing" style={{ marginTop: 22 }} />
          ) : null}
      </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({});
