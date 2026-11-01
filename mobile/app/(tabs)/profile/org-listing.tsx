import { useCallback, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { Button, Loading } from "@/src/components/ui";
import { ProfileCardEditor } from "@/src/components/ProfileCardEditor";
import { MultiSelectPicker } from "@/src/components/MultiSelectPicker";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

type Photo = { url: string; original?: string; caption?: string };
type Form = {
  org_name: string; handle: string; website: string; public_email: string;
  public_phone: string; bio: string; logo_url: string;
  logo_original_url: string; cover_url: string; cover_original_url: string;
  org_categories: string[]; primary_market: string; markets: string[]; photos: Photo[];
};

export default function OrgListingEditor() {
  const { colors } = useTheme();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cats, setCats] = useState<string[]>([]);
  const [marketsAll, setMarketsAll] = useState<string[]>([]);
  const [maxPhotos, setMaxPhotos] = useState(1);
  const [isCP, setIsCP] = useState(false);
  const [status, setStatus] = useState("free");
  const [form, setForm] = useState<Form | null>(null);
  const nameKb = useKbField("org-name");
  const handleKb = useKbField("org-handle");
  const websiteKb = useKbField("org-website");
  const emailKb = useKbField("org-email");
  const phoneKb = useKbField("org-phone");
  const bioKb = useKbField("org-bio");

  const load = useCallback(async () => {
    try {
      const d = await api.get<any>("/org-listing/mine");
      const l = d.listing;
      setForm({
        org_name: l.org_name || l.name || "",
        handle: l.handle || "",
        website: l.website || "",
        public_email: l.public_email || "",
        public_phone: l.public_phone || "",
        bio: l.bio || "",
        logo_url: l.logo_url || "",
        logo_original_url: l.logo_original_url || "",
        cover_url: l.cover_url || "",
        cover_original_url: l.cover_original_url || "",
        org_categories: l.org_categories || [],
        primary_market: l.primary_market || "",
        markets: l.markets || [],
        photos: l.photos || [],
      });
      setCats(d.org_categories_all || []);
      setMarketsAll(d.markets_all || []);
      setMaxPhotos(d.max_photos || 1);
      setIsCP(!!d.is_community_partner);
      setStatus(d.status || "free");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't load your listing");
      router.back();
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const set = (k: keyof Form, v: any) => setForm((f) => (f ? { ...f, [k]: v } : f));

  // Community Partner is handled off-platform, so "Contact us" opens the existing
  // contact channel rather than a billing flow.
  const handleContact = () => {
    Linking.openURL("mailto:info@sailmorenow.com?subject=Community%20Partner%20inquiry").catch(() => {});
  };

  // Auto-save a single image action immediately (independent of the Save button).
  const onImageChange = async (partial: any) => {
    const d = await api.patch<any>("/org-listing", partial);
    const l = d.listing;
    setForm((f) => (f ? {
      ...f,
      logo_url: l.logo_url || "",
      logo_original_url: l.logo_original_url || "",
      cover_url: l.cover_url || "",
      cover_original_url: l.cover_original_url || "",
      photos: l.photos || [],
    } : f));
    if (refresh) refresh();
  };

  const save = async () => {
    if (!form) return;
    if (!form.org_name.trim()) { toast.warning("Organization name is required"); return; }
    setSaving(true);
    try {
      const d = await api.patch<any>("/org-listing", form);
      toast.success("Directory listing updated");
      if (refresh) await refresh();
      const h = d?.listing?.handle || form.handle;
      if (h) router.replace(`/profile/u/${h}` as any);
      else router.back();
    } catch (e: any) { toast.error(e?.message || "Couldn't save listing"); }
    finally { setSaving(false); }
  };

  if (user && user.account_type !== "partner") {
    return <Screen title="Directory listing" showBack><Text style={{ color: colors.muted, padding: 16 }}>Only Club/Org accounts have a directory listing.</Text></Screen>;
  }

  const inputStyle = { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: colors.onSurface, backgroundColor: colors.surface, fontSize: 15 };
  const labelStyle = { color: colors.muted, fontSize: 11, fontWeight: "800" as const, letterSpacing: 1, textTransform: "uppercase" as const, marginBottom: 6, marginTop: 16 };

  if (loading || !form) {
    return <Screen title="Edit Directory Listing" showBack><Loading /></Screen>;
  }

  return (
    <KeyboardFormScreen
      title="Edit Directory Listing"
      testID="org-listing-scroll"
      footer={<Button title="Save listing" onPress={save} loading={saving} testID="org-form-save" style={{ flex: 1 }} />}
    >
          <Text style={{ color: colors.muted, fontSize: 13.5, lineHeight: 20 }}>
            Tap the logo, banner, or a gallery slot to edit your photos. Changes save automatically.
          </Text>

          <View style={{ marginTop: 14 }}>
            <ProfileCardEditor
              data={{ ...form, isCP }}
              maxPhotos={maxPhotos}
              accent={isCP ? colors.navy : colors.teal}
              onImageChange={onImageChange}
              coverAspect={3.5}
              galleryLocked={!isCP}
              badgeLabel={status === "founding_partner" ? "FOUNDING PARTNER" : status === "community_partner" ? "COMMUNITY PARTNER" : "CLUB / ORG"}
              onContactUs={handleContact}
            />
          </View>


          <View onLayout={nameKb.onLayout}>
            <Text style={labelStyle}>Organization / club name</Text>
            <TextInput style={inputStyle} value={form.org_name} onFocus={nameKb.onFocus} onChangeText={(v) => set("org_name", v)} maxLength={120} testID="org-form-name" placeholderTextColor={colors.muted} />
          </View>

          <View onLayout={handleKb.onLayout}>
            <Text style={labelStyle}>Username</Text>
            <TextInput style={inputStyle} value={form.handle} onFocus={handleKb.onFocus} onChangeText={(v) => set("handle", v.replace(/[^A-Za-z0-9_]/g, ""))} autoCapitalize="none" maxLength={20} testID="org-form-handle" placeholder="clubusername" placeholderTextColor={colors.muted} />
          </View>

          <View onLayout={websiteKb.onLayout}>
            <Text style={labelStyle}>Website</Text>
            <TextInput style={inputStyle} value={form.website} onFocus={websiteKb.onFocus} onChangeText={(v) => set("website", v)} autoCapitalize="none" keyboardType="url" testID="org-form-website" placeholder="https://…" placeholderTextColor={colors.muted} />
          </View>

          <View onLayout={emailKb.onLayout}>
            <Text style={labelStyle}>Public email</Text>
            <TextInput style={inputStyle} value={form.public_email} onFocus={emailKb.onFocus} onChangeText={(v) => set("public_email", v)} autoCapitalize="none" keyboardType="email-address" testID="org-form-email" placeholder="hello@club.org" placeholderTextColor={colors.muted} />
          </View>

          <View onLayout={phoneKb.onLayout}>
            <Text style={labelStyle}>Public phone</Text>
            <TextInput style={inputStyle} value={form.public_phone} onFocus={phoneKb.onFocus} onChangeText={(v) => set("public_phone", v)} keyboardType="phone-pad" testID="org-form-phone" placeholder="(206) 555-0100" placeholderTextColor={colors.muted} />
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 240 }}>
              <Text style={labelStyle}>Categories</Text>
              <MultiSelectPicker
                label="Categories"
                title="Choose categories"
                testID="org-form-categories"
                placeholder="Select categories"
                options={cats.map((c) => ({ value: c, label: c }))}
                value={form.org_categories}
                onChange={(next) => set("org_categories", next)}
                accessibilityLabel="Organization categories"
              />
            </View>
            <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 240 }}>
              <Text style={labelStyle}>Primary market</Text>
              <MultiSelectPicker
                single
                label="Primary market"
                title="Primary market"
                testID="org-form-primary-market"
                placeholder="Select…"
                options={marketsAll.map((m) => ({ value: m, label: m }))}
                value={form.primary_market ? [form.primary_market] : []}
                onChange={(next) => set("primary_market", next[0] || "")}
                accessibilityLabel="Primary market"
              />
            </View>
            <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 240 }}>
              <Text style={labelStyle}>Markets served</Text>
              <MultiSelectPicker
                label="Markets"
                title="Markets served"
                testID="org-form-markets"
                placeholder="Select markets"
                options={marketsAll.map((m) => ({ value: m, label: m }))}
                value={form.markets}
                onChange={(next) => set("markets", next)}
                accessibilityLabel="Markets served"
              />
            </View>
          </View>

          <View onLayout={bioKb.onLayout}>
            <Text style={labelStyle}>Bio / description</Text>
            <TextInput style={[inputStyle, { minHeight: 110, textAlignVertical: "top" }]} value={form.bio} onFocus={bioKb.onFocus} onChangeText={(v) => set("bio", v)} multiline maxLength={2000} testID="org-form-bio" placeholder="Tell visitors about your club…" placeholderTextColor={colors.muted} />
          </View>

          {form.handle ? (
            <Button title="View public profile" variant="secondary" onPress={() => router.push(`/profile/u/${form.handle}` as any)} testID="org-listing-view-public" style={{ marginTop: 22 }} />
          ) : null}
      </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({});
