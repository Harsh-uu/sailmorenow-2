import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { MotionModal as Modal } from "@/src/components/MotionModal";
import { router, useFocusEffect } from "expo-router";
import { DeviceEventEmitter } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { File as ExpoFile } from "expo-file-system";
import * as WebBrowser from "expo-web-browser";
import { TERMS_URL, PRIVACY_URL } from "@/src/constants/legal";

import { Screen } from "@/src/components/Screen";
import { KeyboardFormBody, useKbField } from "@/src/components/KeyboardFormScreen";
import { BUILD_STAMP } from "@/src/lib/buildStamp";
import { Avatar, Badge, Button, ButtonRow } from "@/src/components/ui";
import { LogoCircle } from "@/src/components/LogoCircle";
import { CropModal } from "@/src/components/CropModal";
import { useAuth } from "@/src/context/AuthContext";
import { useNotifications } from "@/src/context/NotificationsContext";
import { NotificationBell } from "@/src/components/NotificationBell";
import { DeleteAccountSheet } from "@/src/components/DeleteAccountSheet";
import { api, ApiError, API, getToken } from "@/src/lib/api";
import { handleUpgrade } from "@/src/lib/upgrade";
import { shareLink } from "@/src/lib/share";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";
import { ACCOUNT_TYPE_LABELS } from "@/src/lib/format";
import { MARKETPLACE_CHANGED } from "@/src/lib/events";

const SAILING_ICONS = ["⛵", "🧭", "🌊", "🛥️", "⚓", "🐋", "🦭", "🏝️", "☀️", "🌤️", "🪢", "🐚"];
const HANDLE_RE = /^[A-Za-z0-9_]{3,20}$/;

export default function Profile() {
  const { user, logout, refresh } = useAuth();
  const { pendingReviews } = useNotifications();
  const { colors, pref, setPref } = useTheme();
  const toast = useToast();
  const [handle, setHandle] = useState(user?.handle || "");
  const [uploading, setUploading] = useState(false);
  const [newsletter, setNewsletter] = useState(!!user?.newsletter_opt_in);
  const [mktOpen, setMktOpen] = useState(false);
  const [allMarkets, setAllMarkets] = useState<string[]>([]);
  const [followed, setFollowed] = useState<string[]>(user?.markets || []);
  const [savingMkts, setSavingMkts] = useState(false);
  const [idBusy, setIdBusy] = useState(false);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [logoCrop, setLogoCrop] = useState<{ uri: string; original: string } | null>(null);
  const [iconSheet, setIconSheet] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportSent, setSupportSent] = useState(false);
  const [tQuote, setTQuote] = useState("");
  const [tRole, setTRole] = useState((user?.account_type || "").replace(/_/g, " "));
  const [tMarket, setTMarket] = useState(user?.primary_market || "");
  const [tShowName, setTShowName] = useState(true);
  const [tBusy, setTBusy] = useState(false);
  const [tSent, setTSent] = useState(false);
  const [boatName, setBoatName] = useState(user?.boat_name || "");
  const [boatMakeModel, setBoatMakeModel] = useState(user?.boat_make_model || "");
  const [pFirst, setPFirst] = useState(user?.first_name || "");
  const [pLast, setPLast] = useState(user?.last_name || "");
  const [pEmail, setPEmail] = useState(user?.email || "");
  const [pOrgName, setPOrgName] = useState((user as any)?.org_name || "");
  const [pWebsite, setPWebsite] = useState((user as any)?.website || "");
  const [pBio, setPBio] = useState((user as any)?.bio || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [proCompany, setProCompany] = useState("");
  const [proCompanyOrig, setProCompanyOrig] = useState("");
  const [proHasListing, setProHasListing] = useState(false);
  const [listings, setListings] = useState<any[] | null>(null);
  const [sub, setSub] = useState<any>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [homeMktOpen, setHomeMktOpen] = useState(false);
  const [savingHome, setSavingHome] = useState(false);
  const [orgCatOpen, setOrgCatOpen] = useState(false);
  const [orgCatOptions, setOrgCatOptions] = useState<string[]>([]);
  const [orgCats, setOrgCats] = useState<string[]>(
    (user as any)?.org_categories || ((user as any)?.org_category ? [(user as any).org_category] : []),
  );
  const [savingOrgCat, setSavingOrgCat] = useState(false);

  // MOBILE-KB-4: inline Profile forms sit deep in the tree, so onFocus-only
  // (the measure fallback in KeyboardFormBody computes content-space y at any depth).
  const kbOrgName = useKbField("prof-orgname");
  const kbWebsite = useKbField("prof-website");
  const kbBusiness = useKbField("prof-business");
  const kbName = useKbField("prof-name");
  const kbHandle = useKbField("prof-handle");
  const kbEmail = useKbField("prof-email");
  const kbBio = useKbField("prof-bio");
  const kbBoatName = useKbField("prof-boatname");
  const kbBoatModel = useKbField("prof-boatmodel");
  const kbTQuote = useKbField("prof-tquote");
  const kbTRole = useKbField("prof-trole");
  const kbTMarket = useKbField("prof-tmarket");
  const kbSubject = useKbField("prof-subject");
  const kbMessage = useKbField("prof-message");

  useEffect(() => { api.get("/payments/subscription").then(setSub).catch(() => setSub({ is_free: true })); }, []);

  useEffect(() => {
    if (!user) return;
    setPFirst(user.first_name || ""); setPLast(user.last_name || ""); setPEmail(user.email || "");
    setHandle(user.handle || ""); setPOrgName((user as any).org_name || ""); setPWebsite((user as any).website || "");
    setPBio((user as any).bio || "");
    setBoatName(user.boat_name || ""); setBoatMakeModel(user.boat_make_model || "");
  }, [user]);

  const cancelPlan = async () => {
    setCancelBusy(true);
    try {
      const r = await api.post<{ renews_at?: string }>("/payments/subscription/cancel");
      setSub((s: any) => ({ ...s, cancel_at_period_end: true, renews_at: r.renews_at }));
      toast.success("Plan will not renew");
    } catch (e: any) {
      toast.error(e?.message || "Could not cancel");
    } finally {
      setCancelBusy(false);
    }
  };

  // One Save for everything in Account Details (name, handle, email, role-specific).
  useEffect(() => {
    if (user?.account_type !== "boat_pro") return;
    api.get<any>("/boat-pros/mine").then((d) => {
      const cn = d.company_name || "";
      setProCompany(cn); setProCompanyOrig(cn); setProHasListing(true);
    }).catch(() => {
      const cn = (user as any)?.company_name || "";
      setProCompany(cn); setProCompanyOrig(cn); setProHasListing(false);
    });
  }, [user?.account_type]);

  const saveAll = async () => {
    if (handle && !HANDLE_RE.test(handle.trim())) { toast.warning("Username must be 3-20 letters, numbers or _"); return; }
    if (!pFirst.trim() || !pLast.trim()) { toast.warning("First and last name are required"); return; }
    if (!pEmail.trim()) { toast.warning("Email is required"); return; }
    if (user?.account_type === "boat_pro" && proHasListing && !proCompany.trim()) { toast.warning("Business name is required"); return; }
    if (user?.account_type !== "partner" && pBio.trim().length > 300) { toast.warning("Bio must be 300 characters or less"); return; }
    setSavingProfile(true);
    try {
      const payload: any = { first_name: pFirst.trim(), last_name: pLast.trim(), email: pEmail.trim() };
      if (user?.account_type !== "partner") payload.bio = pBio;
      if (user?.account_type === "partner") { payload.org_name = pOrgName.trim(); payload.website = pWebsite.trim(); }
      await api.patch("/auth/profile", payload);
      if (handle && handle.trim() !== (user?.handle || "")) await api.patch("/auth/handle", { handle: handle.trim() });
      if (user?.account_type === "boat_owner") await api.patch("/auth/boat-details", { boat_name: boatName.trim(), boat_make_model: boatMakeModel.trim() });
      // Business name shares the listing's company_name — write ONLY that field (partial PATCH).
      if (user?.account_type === "boat_pro" && proHasListing && proCompany.trim() !== proCompanyOrig.trim()) {
        await api.patch("/boat-pros/listing", { company_name: proCompany.trim() });
        setProCompanyOrig(proCompany.trim());
      }
      await refresh();
      toast.success("Profile saved");
    } catch (e: any) {
      toast.error(e instanceof ApiError ? e.message : (e?.message || "Couldn't save"));
    } finally {
      setSavingProfile(false);
    }
  };

  const loadListings = useCallback(() => {
    api.get<any[]>("/posts/mine/for-sale").then(setListings).catch(() => setListings([]));
  }, []);
  useEffect(() => { loadListings(); }, [loadListings]);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(MARKETPLACE_CHANGED, () => loadListings());
    return () => sub.remove();
  }, [loadListings]);
  const relist = async (id: string) => {
    try { await api.post(`/posts/${id}/sold`, {}); toast.success("Relisted - live for 30 more days"); loadListings(); }
    catch { toast.error("Couldn't relist"); }
  };

  const submitSupport = async () => {
    if (supportBusy) return;
    if (!supportSubject.trim()) { toast.warning("Please add a subject"); return; }
    if (supportMessage.trim().length < 10) { toast.warning("Please add a message of at least 10 characters"); return; }
    setSupportBusy(true);
    try {
      await api.post("/support/contact", { subject: supportSubject.trim(), message: supportMessage.trim() });
      setSupportSent(true);
      setSupportSubject("");
      setSupportMessage("");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't send your message. Please try again.");
    } finally {
      setSupportBusy(false);
    }
  };

  const submitTestimonial = async () => {
    if (tBusy) return;
    const q = tQuote.trim();
    if (q.length < 10) { toast.warning("Please share at least 10 characters"); return; }
    if (q.length > 280) { toast.warning("Please keep it to 280 characters or less"); return; }
    setTBusy(true);
    try {
      await api.post("/testimonials", { quote: q, role: tRole.trim(), market: tMarket.trim(), show_name: tShowName });
      setTSent(true);
      setTQuote("");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't submit. Please try again.");
    } finally {
      setTBusy(false);
    }
  };

  const startIdentity = async () => {
    if (idBusy) return;
    setIdBusy(true);
    try {
      const res = await api.post<{ url?: string; already_verified?: boolean }>("/identity/session", {
        origin_url: (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, ""),
      });
      if (res.already_verified) { await refresh(); toast.success("You're already verified"); return; }
      if (res.url) {
        await WebBrowser.openBrowserAsync(res.url);
        const s = await api.get<{ verified: boolean; status: string }>("/identity/status");
        await refresh();
        router.push({ pathname: "/verify/return", params: { verified: s.verified ? "1" : "0" } });
      }
    } catch (e: any) {
      if (!handleUpgrade(e, toast)) toast.error(e?.message || "Couldn't start verification");
    } finally {
      setIdBusy(false);
    }
  };

  useEffect(() => {
    api.get<{ markets: string[]; org_categories?: string[] }>("/markets")
      .then((d) => { setAllMarkets(d.markets || []); setOrgCatOptions(d.org_categories || []); })
      .catch(() => {});
  }, []);
  useEffect(() => { setFollowed(user?.markets || []); }, [user?.markets]);
  useEffect(() => {
    setOrgCats((user as any)?.org_categories || ((user as any)?.org_category ? [(user as any).org_category] : []));
  }, [(user as any)?.org_categories, (user as any)?.org_category]);

  const saveHomeMarket = async (m: string) => {
    setSavingHome(true);
    try {
      await api.patch("/auth/profile", { primary_market: m });
      await refresh();
      setHomeMktOpen(false);
      toast.success("Home market updated");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't update home market");
    } finally {
      setSavingHome(false);
    }
  };

  const saveOrgCats = async () => {
    setSavingOrgCat(true);
    try {
      await api.patch("/auth/profile", { org_categories: orgCats });
      await refresh();
      setOrgCatOpen(false);
      toast.success("Category updated");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't update category");
    } finally {
      setSavingOrgCat(false);
    }
  };

  const toggleMkt = (m: string) =>
    setFollowed((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));

  const saveMarkets = async () => {
    if (!followed.length) { toast.warning("Pick at least one market"); return; }
    setSavingMkts(true);
    try {
      await api.patch("/auth/markets", { markets: followed });
      await refresh();
      setMktOpen(false);
      toast.success("Markets updated");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't save");
    } finally {
      setSavingMkts(false);
    }
  };

  useFocusEffect(useCallback(() => { refresh(); loadListings(); }, [loadListings]));

  if (!user) return null;

  const tierBadge = ({ free: "Free", basic: "Basic", featured: "Featured", premium: "Premium", community_partner: "Community Partner", founding_partner: "Founding Partner" } as Record<string, string>)[user.subscription_tier || "free"] || "Free";
  const isPaid = (user.subscription_tier || "free") !== "free";
  const isPartner = user.account_type === "partner";
  const isOwner = user.account_type === "boat_owner";
  const isPro = user.account_type === "boat_pro";
  const isSailorish = user.account_type === "sailor" || user.account_type === "boat_owner";

  // Org/club accounts edit ONE image: the camera opens the same square logo crop
  // the listing editor uses, uploads to object storage, and saves logo_url (which
  // the backend mirrors to `picture`, so the profile and directory stay in sync).
  const uploadOrgImage = async (uri: string): Promise<string> => {
    const fd = new FormData();
    if (Platform.OS === "web") {
      const blob = await (await fetch(uri)).blob();
      const ok = ["image/jpeg", "image/png", "image/webp"];
      fd.append("file", new File([blob], "logo.jpg", { type: ok.includes(blob.type) ? blob.type : "image/jpeg" }));
    } else {
      fd.append("file", new ExpoFile(uri) as any);
    }
    const token = await getToken();
    const res = await fetch(`${API}/org-listing/upload`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    if (!res.ok) { const d = await res.text().catch(() => ""); throw new Error(`(${res.status}) ${d.slice(0, 120)}`); }
    return (await res.json()).url as string;
  };

  const pickOrgLogo = async () => {
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    let status = perm.status;
    if (status !== "granted") {
      if (!perm.canAskAgain) {
        Alert.alert("Photos access needed", "Enable photo access in Settings to change your logo.", [
          { text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]);
        return;
      }
      status = (await ImagePicker.requestMediaLibraryPermissionsAsync()).status;
      if (status !== "granted") return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 0.9 });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    const uri = r.assets[0].uri;
    try {
      const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1000 } }], { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG });
      setLogoCrop({ uri, original: small.uri });
    } catch { setLogoCrop({ uri, original: uri }); }
  };

  const applyOrgLogo = async (cropped: string) => {
    const orig = logoCrop?.original || cropped;
    setLogoCrop(null);
    setUploading(true);
    try {
      const logo_url = await uploadOrgImage(cropped);
      const logo_original_url = orig.startsWith("/api/") || orig.startsWith("http") ? orig : await uploadOrgImage(orig);
      await api.patch("/org-listing", { logo_url, logo_original_url });
      await refresh();
      toast.success("Logo updated");
    } catch (e: any) {
      toast.error(`Could not save. ${e?.message || "Try again."}`.trim());
    } finally { setUploading(false); }
  };

  const changeAvatar = async () => {
    setPhotoSheet(false);
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    let status = perm.status;
    if (status !== "granted") {
      if (!perm.canAskAgain) {
        Alert.alert("Photos access needed", "Enable photo access in Settings to change your avatar.", [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      status = req.status;
      if (status !== "granted") return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setUploading(true);
    try {
      const asset = result.assets[0];
      const fd = new FormData();
      if (Platform.OS === "web") {
        const blob = await (await fetch(asset.uri)).blob();
        const okTypes = ["image/jpeg", "image/png", "image/webp"];
        const type = okTypes.includes(blob.type) ? blob.type : "image/jpeg";
        fd.append("file", new File([blob], "avatar.jpg", { type }));
      } else {
        let uri = asset.uri;
        try {
          const shrunk = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1024 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
          uri = shrunk.uri;
        } catch (mErr) { console.warn("manipulate failed, uploading original", mErr); }
        // Expo SDK 57's fetch rejects the legacy {uri,name,type} FormData part;
        // expo-file-system's File implements Blob (exposes bytes()), which its
        // multipart conversion accepts.
        fd.append("file", new ExpoFile(uri) as any);
      }
      const token = await getToken();
      const res = await fetch(`${API}/auth/avatar`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
      if (!res.ok) { const detail = await res.text().catch(() => ""); throw new Error(`(${res.status}) ${detail.slice(0, 120)}`); }
      await refresh();
      toast.success("Photo updated");
    } catch (e) {
      console.warn("avatar upload error", e);
      toast.error(`Couldn't update photo ${e instanceof Error ? "- " + e.message : ""}`.trim());
    } finally {
      setUploading(false);
    }
  };

  const pickIcon = async (a: string) => {
    try {
      await api.patch("/profile/photo", { picture: null, avatar: a });
      await refresh();
      setIconSheet(false);
      toast.success("Avatar updated");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't update avatar");
    }
  };

  const toggleNewsletter = async (v: boolean) => {
    setNewsletter(v);
    try { await api.patch("/auth/newsletter", { newsletter_opt_in: v }); }
    catch { setNewsletter(!v); }
  };

  const switchAccount = async () => {
    try { await logout(); } catch { /* ignore */ }
    router.replace("/signin");
  };

  const swapAccountType = () => {
    const next = user.account_type === "sailor" ? "boat_owner" : "sailor";
    Alert.alert("Switch account type", `Change to ${ACCOUNT_TYPE_LABELS[next]}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Switch",
        onPress: async () => {
          try { await api.patch("/auth/account-type", { account_type: next }); await refresh(); toast.success(`Switched to ${ACCOUNT_TYPE_LABELS[next]}`); }
          catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't switch"); }
        },
      },
    ]);
  };

  const inputStyle = { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 48, paddingVertical: 10, fontSize: 15, color: colors.onSurface } as const;

  return (
    <Screen title="Profile" scroll padded={false} right={<NotificationBell />}>
      <KeyboardFormBody padded={false} contentBottom={40}>
        {/* Header */}
        <View style={[styles.hero, { backgroundColor: colors.brandPrimary }]}>
          <Pressable onPress={() => isPartner ? pickOrgLogo() : setPhotoSheet(true)} testID="edit-photo-avatar">
            {isPartner
              ? <LogoCircle uri={user.logo_url || user.picture} size={84} accessibilityLabel={`${user.name} logo`}
                  fallback={<View style={{ width: "100%", height: "100%", backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}><Icon name="flag" size={32} color="#fff" footprint={32} /></View>} />
              : <Avatar uri={user.picture || user.avatar} name={user.name} size={84} />}
            <View style={[styles.camBadge, { backgroundColor: colors.accent }]}>
              <Icon name={uploading ? "hourglass-outline" : "camera"} size={14} color={colors.onAccent} footprint={14} />
            </View>
          </Pressable>
          <Text style={styles.name} numberOfLines={2}>{user.name}</Text>
          {user.handle ? <Text style={styles.handle}>@{user.handle}</Text> : null}
          <View style={styles.heroBadges}>
            {user.account_type !== "partner" && (ACCOUNT_TYPE_LABELS[user.account_type || ""] || "Member") !== tierBadge ? (
              <Badge label={ACCOUNT_TYPE_LABELS[user.account_type || ""] || "Member"} tone="teal" />
            ) : null}
            <Badge label={tierBadge} tone={isPaid ? "accent" : "muted"} />
            {user.identity_verified ? <Badge label="Verified" tone="navy" /> : null}
          </View>
          <ButtonRow
            style={{ marginTop: 12 }}
            buttons={[
              { title: "Switch account", variant: "secondary", icon: "swap-horizontal-outline", onPress: switchAccount, testID: "switch-account-btn" },
              { title: "Log out", variant: "danger", icon: "log-out-outline", onPress: logout, testID: "logout-button" },
            ]}
          />
        </View>

        <View style={{ padding: 16, gap: 12 }}>
          {/* Account details - single Save */}
          <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 0 }]}>ACCOUNT DETAILS</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border, padding: 14, gap: 10 }]} testID="account-section">
            {isPartner ? (
              <Pressable testID="edit-directory-listing-btn" onPress={() => router.push("/profile/org-listing" as any)}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.teal, backgroundColor: colors.tealSoft, paddingHorizontal: 12, paddingVertical: 12 }}>
                <Icon name="megaphone-outline" size={20} color={colors.teal} footprint={20} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 14 }}>Edit Directory Listing</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Logo, categories, bio & public contact</Text>
                </View>
                <Icon name="chevron-forward" size={18} color={colors.teal} footprint={18} />
              </Pressable>
            ) : null}
            {isPartner ? (
              <>
                <TextInput testID="account-org-name-input" value={pOrgName} onChangeText={setPOrgName} onFocus={kbOrgName.onFocus} maxLength={120} placeholder="Club / Organization name" placeholderTextColor={colors.muted} style={inputStyle} />
                <TextInput testID="account-website-input" value={pWebsite} onChangeText={setPWebsite} onFocus={kbWebsite.onFocus} autoCapitalize="none" placeholder="Website (https://…)" placeholderTextColor={colors.muted} style={inputStyle} />
              </>
            ) : null}
            {isPro ? (
              <View>
                <TextInput testID="account-business-input" value={proCompany} onChangeText={setProCompany} onFocus={kbBusiness.onFocus} maxLength={120} placeholder="Business name" placeholderTextColor={colors.muted} style={inputStyle} />
                <Pressable testID="view-listing-card-link" onPress={() => router.push(`/directory/pro/${user.user_id}` as any)} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }} accessibilityRole="button" accessibilityLabel="View listing card">
                  <Icon name="open-outline" size={14} color={colors.teal} footprint={14} />
                  <Text style={{ color: colors.teal, fontWeight: "700", fontSize: 12.5 }}>View listing card</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TextInput testID="account-first-name-input" value={pFirst} onChangeText={setPFirst} onFocus={kbName.onFocus} maxLength={60} placeholder="First name" placeholderTextColor={colors.muted} style={[inputStyle, { flex: 1 }]} />
              <TextInput testID="account-last-name-input" value={pLast} onChangeText={setPLast} onFocus={kbName.onFocus} maxLength={60} placeholder="Last name" placeholderTextColor={colors.muted} style={[inputStyle, { flex: 1 }]} />
            </View>
            <View style={[styles.handleRow, { borderColor: colors.border }]}>
              <Text style={{ color: colors.muted }}>@</Text>
              <TextInput testID="handle-input" value={handle} onChangeText={setHandle} onFocus={kbHandle.onFocus} autoCapitalize="none" placeholder="username" placeholderTextColor={colors.muted}
                style={{ flex: 1, color: colors.onSurface, fontSize: 15, marginLeft: 4 }} />
            </View>
            <TextInput testID="account-email-input" value={pEmail} onChangeText={setPEmail} onFocus={kbEmail.onFocus} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor={colors.muted} style={inputStyle} />
            <Text testID="email-change-warning" style={{ color: colors.warning, fontSize: 12, lineHeight: 17 }}>Changing it may affect Google sign-in.</Text>
            {!isPartner && !isOwner ? (
              <View>
                <TextInput testID="account-bio-input" value={pBio} onChangeText={setPBio} onFocus={kbBio.onFocus} multiline placeholder="Bio (optional)" placeholderTextColor={colors.muted}
                  style={[inputStyle, { height: 96, paddingTop: 10, textAlignVertical: "top" }]} />
                <Text testID="account-bio-count" style={{ color: pBio.trim().length > 300 ? colors.error : colors.muted, fontSize: 11, textAlign: "right", marginTop: 4 }}>{pBio.trim().length}/300</Text>
              </View>
            ) : null}
            {isOwner ? (
              <>
                <TextInput testID="boat-name-input" value={boatName} onChangeText={setBoatName} onFocus={kbBoatName.onFocus} maxLength={80} placeholder="Boat name (optional)" placeholderTextColor={colors.muted} style={inputStyle} />
                <TextInput testID="boat-make-model-input" value={boatMakeModel} onChangeText={setBoatMakeModel} onFocus={kbBoatModel.onFocus} maxLength={80} placeholder="Boat make/model (optional)" placeholderTextColor={colors.muted} style={inputStyle} />
                <View>
                  <TextInput testID="account-bio-input" value={pBio} onChangeText={setPBio} onFocus={kbBio.onFocus} multiline placeholder="Bio (optional)" placeholderTextColor={colors.muted}
                    style={[inputStyle, { height: 96, paddingTop: 10, textAlignVertical: "top" }]} />
                  <Text testID="account-bio-count" style={{ color: pBio.trim().length > 300 ? colors.error : colors.muted, fontSize: 11, textAlign: "right", marginTop: 4 }}>{pBio.trim().length}/300</Text>
                </View>
              </>
            ) : null}
            {isPro ? (
              <>
                <Pressable testID="view-public-profile-link" onPress={() => router.push(`/profile/u/${user.handle!}` as any)} style={[styles.row, { paddingHorizontal: 0 }]}>
                  <Icon name="person-outline" size={20} color={colors.onSurfaceSecondary} footprint={20} />
                  <Text style={[styles.rowLabel, { color: colors.onSurface }]}>View public profile</Text>
                  <Icon name="chevron-forward" size={18} color={colors.borderStrong} footprint={18} />
                </Pressable>
                <Pressable testID="your-boat-pro-listing-link" onPress={() => router.push("/profile/boat-pro-listing")} style={[styles.row, { paddingHorizontal: 0 }]}>
                  <Icon name="briefcase-outline" size={20} color={colors.onSurfaceSecondary} footprint={20} />
                  <Text style={[styles.rowLabel, { color: colors.onSurface }]}>Your Boat Pro Listing</Text>
                  <Icon name="chevron-forward" size={18} color={colors.borderStrong} footprint={18} />
                </Pressable>
              </>
            ) : null}
            {isSailorish ? (
              <Pressable testID="swap-type-btn" onPress={swapAccountType} style={[styles.row, { paddingHorizontal: 0 }]}>
                <Icon name="swap-horizontal-outline" size={20} color={colors.onSurfaceSecondary} footprint={20} />
                <Text style={[styles.rowLabel, { color: colors.onSurface }]}>{`Account type: ${ACCOUNT_TYPE_LABELS[user.account_type || ""]}`}</Text>
                <Icon name="chevron-forward" size={18} color={colors.borderStrong} footprint={18} />
              </Pressable>
            ) : null}
            <Button title="Save" onPress={saveAll} loading={savingProfile} testID="save-account-btn" />
          </View>

          {/* View public profile + Admin dashboard - directly below Account details */}
          {(user.handle && !isPro) || user.platform_role === "admin" ? (
            <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {user.handle && !isPro ? (
                <Row icon="person-outline" label="View public profile" onPress={() => router.push(`/profile/u/${user.handle!}` as any)} testID="view-public-btn" />
              ) : null}
              {user.platform_role === "admin" ? (
                <Row icon="shield-checkmark-outline" label="Admin dashboard" onPress={() => router.push("/profile/admin" as any)} testID="admin-dashboard-row" />
              ) : null}
            </View>
          ) : null}

          {/* Subscription - directly under Account details */}
          <Text style={[styles.sectionLabel, { color: colors.muted }]}>PLAN</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Row icon="rocket-outline" label="My plan" onPress={() => router.push("/profile/my-plan" as any)} testID="my-plan-row" />
          </View>
          <Text style={[styles.sectionLabel, { color: colors.muted }]}>SUBSCRIPTION</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border, padding: 16 }]} testID="subscription-section">
            {!sub ? (
              <Text style={{ color: colors.muted }}>Loading…</Text>
            ) : sub.is_free ? (
              <>
                <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 16 }}>You're on the free plan</Text>
                <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, marginTop: 4 }}>Upgrade to unlock posting, messaging, reviews and more.</Text>
                <Button title="Upgrade" variant="primary" icon="rocket-outline" onPress={() => router.push("/pricing")} testID="subscription-upgrade-btn" style={{ marginTop: 12 }} />
              </>
            ) : (
              <>
                <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 16, textTransform: "capitalize" }} testID="subscription-plan">{sub.tier} plan</Text>
                <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, marginTop: 4 }} testID="subscription-interval">Billing interval: {sub.interval || "Recurring"}</Text>
                {sub.renews_at ? (
                  <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, marginTop: 2 }} testID="subscription-renewal">
                    {sub.cancel_at_period_end ? "Access until" : "Renews"}: {new Date(sub.renews_at).toLocaleDateString()}
                  </Text>
                ) : null}
                {sub.cancel_at_period_end ? (
                  <Text style={{ color: colors.warning, fontSize: 13, fontWeight: "700", marginTop: 4 }} testID="subscription-canceled-note">Set to cancel at period end</Text>
                ) : null}
                <View style={{ gap: 10, marginTop: 12 }}>
                  <Button title="Change plan" variant="secondary" numberOfLines={2} onPress={() => router.push("/pricing")} testID="subscription-change-btn" />
                  {!sub.cancel_at_period_end ? (
                    <Button title="Cancel subscription" variant="ghost" numberOfLines={2} loading={cancelBusy} onPress={cancelPlan} testID="subscription-cancel-btn" />
                  ) : null}
                </View>
              </>
            )}
          </View>

          {/* Verification - ID verification; individuals only (disabled during trial); removed for Club/Org */}
          {!isPartner ? (
            <>
              <Text style={[styles.sectionLabel, { color: colors.muted }]}>IDENTITY</Text>
              <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {user.identity_verified ? (
                  <View style={styles.row}>
                    <Icon name="verified" size={20} color={colors.teal} footprint={20} />
                    <Text style={[styles.rowLabel, { color: colors.onSurface }]}>ID Verified</Text>
                    <Icon name="checkmark-circle" size={20} color={colors.teal} footprint={20} />
                  </View>
                ) : (
                  <View style={[styles.row, { opacity: 0.6 }]} testID="identity-disabled">
                    <Icon name="lock-closed-outline" size={20} color={colors.muted} footprint={20} />
                    <Text style={[styles.rowLabel, { color: colors.muted }]}>Not available during free trial period</Text>
                  </View>
                )}
              </View>
            </>
          ) : null}

          {/* Home market */}
          <Text style={[styles.sectionLabel, { color: colors.muted }]}>HOME MARKET</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Row icon="navigate-outline" label={user.primary_market || "Set your home market"} onPress={() => setHomeMktOpen(true)} testID="edit-home-market-row" />
          </View>

          {isPartner ? (
            <>
              <Text style={[styles.sectionLabel, { color: colors.muted }]}>CLUB / ORG CATEGORY</Text>
              <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Row icon="pricetags-outline" label={orgCats.length ? orgCats.join(", ") : "Choose your categories"} onPress={() => setOrgCatOpen(true)} testID="edit-org-category-row" />
              </View>
            </>
          ) : null}

          <Text style={[styles.sectionLabel, { color: colors.muted }]}>MARKETS YOU FOLLOW</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Row icon="location-outline" label={followed.length ? `${followed.length} market${followed.length > 1 ? "s" : ""} followed` : "Choose your markets"} onPress={() => setMktOpen(true)} testID="edit-markets-row" />
          </View>

          <Text style={[styles.sectionLabel, { color: colors.muted }]}>REVIEWS</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable testID="reviews-row" onPress={() => router.push("/profile/reviews" as any)} style={styles.row}>
              <Icon name="reviews" size={20} color={colors.onSurfaceSecondary} footprint={20} />
              <Text style={[styles.rowLabel, { color: colors.onSurface }]}>Reviews</Text>
              {pendingReviews > 0 ? (
                <View testID="reviews-row-badge" style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: colors.onAccent, fontSize: 11, fontWeight: "800" }}>{pendingReviews > 9 ? "9+" : String(pendingReviews)}</Text>
                </View>
              ) : null}
              <Icon name="chevron-forward" size={18} color={colors.borderStrong} footprint={18} />
            </Pressable>
          </View>

          {/* Your activity - my listings, following, saved, crew listings, events */}
          <Text style={[styles.sectionLabel, { color: colors.muted }]}>MY LISTINGS</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border, padding: 14, gap: 8 }]} testID="my-listings-section">
            {listings === null ? (
              <Text style={{ color: colors.muted, fontSize: 13 }}>Loading…</Text>
            ) : !listings.length ? (
              <Text testID="my-listings-empty" style={{ color: colors.muted, fontSize: 13 }}>No marketplace listings yet.</Text>
            ) : (
              listings.map((p) => (
                <View key={p.id} testID={`my-listing-${p.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.onSurface, fontWeight: "700", fontSize: 14 }}>{p.title}{typeof p.price === "number" ? `  $${p.price.toLocaleString()}` : ""}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{p.sold ? "Sold" : "Active"}{p.condition ? ` · ${p.condition}` : ""}</Text>
                  </View>
                  <Pressable testID={`listing-edit-${p.id}`} onPress={() => router.push({ pathname: "/edit-post", params: { id: p.id } } as any)} hitSlop={8} style={{ padding: 6 }}>
                    <Icon name="create-outline" size={18} color={colors.onSurfaceSecondary} footprint={18} />
                  </Pressable>
                  <Pressable testID={`listing-delete-${p.id}`} onPress={() => router.push({ pathname: "/delete-post", params: { id: p.id, title: p.title } } as any)} hitSlop={8} style={{ padding: 6 }}>
                    <Icon name="trash-outline" size={18} color={colors.error} footprint={18} />
                  </Pressable>
                  {p.sold ? (
                    <Pressable testID={`relist-${p.id}`} onPress={() => relist(p.id)} style={{ backgroundColor: colors.teal, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>Relist</Text>
                    </Pressable>
                  ) : (
                    <View style={{ backgroundColor: colors.tealSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                      <Text style={{ color: colors.teal, fontWeight: "800", fontSize: 10, letterSpacing: 0.5 }}>LIVE</Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>

          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Row icon="people-outline" label="My Crew Listings" onPress={() => router.push("/my-crew-listings" as any)} testID="my-crew-listings-row" />
            {user.account_type === "partner" ? (
              <Row icon="calendar-outline" label="My Events" onPress={() => router.push("/my-events")} testID="my-events-row" />
            ) : null}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.muted }]}>FOLLOWING</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable testID="profile-following-link" onPress={() => router.push("/profile/following-list" as any)} style={styles.row}>
              <Icon name="people" size={20} color={colors.onSurfaceSecondary} footprint={20} />
              <Text style={[styles.rowLabel, { color: colors.onSurface }]}>Manage who you follow</Text>
              <Icon name="chevron-forward" size={18} color={colors.borderStrong} footprint={18} />
            </Pressable>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.muted }]}>SAVED</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable testID="profile-saved-link" onPress={() => router.push("/profile/saved" as any)} style={styles.row}>
              <Icon name="bookmark-outline" size={20} color={colors.onSurfaceSecondary} footprint={20} />
              <Text style={[styles.rowLabel, { color: colors.onSurface }]}>Your saved posts</Text>
              <Icon name="chevron-forward" size={18} color={colors.borderStrong} footprint={18} />
            </Pressable>
          </View>

          {/* Help and feedback - testimonial, contact, help & faq, invite */}
          <Text style={[styles.sectionLabel, { color: colors.muted }]}>SHARE YOUR STORY</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border, padding: 14 }]} testID="testimonial-section">
            {tSent ? (
              <View testID="testimonial-sent" style={{ alignItems: "center", paddingVertical: 10 }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                  <Icon name="checkmark-circle" size={26} color={colors.teal} footprint={26} />
                </View>
                <Text style={{ color: colors.onSurface, fontSize: 14.5, textAlign: "center", lineHeight: 21, fontWeight: "600" }}>
                  Thanks for sharing! Your testimonial is pending review and will appear once approved.
                </Text>
                <Pressable testID="testimonial-send-another" onPress={() => setTSent(false)} style={{ marginTop: 12 }}>
                  <Text style={{ color: colors.teal, fontWeight: "700", fontSize: 13.5 }}>Write another</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                <Text style={{ color: colors.muted, fontSize: 12.5 }}>Tell other sailors what you love about Sail More Now.</Text>
                <TextInput testID="testimonial-quote" value={tQuote} onChangeText={(t) => setTQuote(t.slice(0, 280))} onFocus={kbTQuote.onFocus} placeholder="Share a short quote (up to 280 characters)…" placeholderTextColor={colors.muted} multiline maxLength={280}
                  style={[styles.supportInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface, minHeight: 80, textAlignVertical: "top" }]} />
                <Text style={{ color: colors.muted, fontSize: 11, textAlign: "right" }} testID="testimonial-count">{tQuote.trim().length}/280</Text>
                <TextInput testID="testimonial-role" value={tRole} onChangeText={setTRole} onFocus={kbTRole.onFocus} placeholder="Your role (e.g. Sailor)" placeholderTextColor={colors.muted} maxLength={60}
                  style={[styles.supportInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface }]} />
                <TextInput testID="testimonial-market" value={tMarket} onChangeText={setTMarket} onFocus={kbTMarket.onFocus} placeholder="Your market (e.g. Greater Seattle)" placeholderTextColor={colors.muted} maxLength={80}
                  style={[styles.supportInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface }]} />
                <Pressable testID="testimonial-showname" onPress={() => setTShowName((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Icon name={tShowName ? "checkbox" : "square-outline"} size={22} color={tShowName ? colors.teal : colors.muted} footprint={22} />
                  <Text style={{ color: colors.onSurface, fontSize: 13.5, flex: 1 }}>Okay to show my first name and last initial</Text>
                </Pressable>
                <Button title="Submit testimonial" icon="star" onPress={submitTestimonial} loading={tBusy} testID="testimonial-submit" />
              </View>
            )}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.muted }]}>CONTACT US</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border, padding: 14 }]}>
            {supportSent ? (
              <View testID="support-contact-sent" style={{ alignItems: "center", paddingVertical: 10 }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                  <Icon name="checkmark-circle" size={26} color={colors.teal} footprint={26} />
                </View>
                <Text style={{ color: colors.onSurface, fontSize: 14.5, textAlign: "center", lineHeight: 21, fontWeight: "600" }}>
                  Thank you for contacting us. We will respond to your inquiry within 48 hours.
                </Text>
                <Pressable testID="support-send-another" onPress={() => setSupportSent(false)} style={{ marginTop: 12 }}>
                  <Text style={{ color: colors.teal, fontWeight: "700", fontSize: 13.5 }}>Send another message</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                <Text style={{ color: colors.muted, fontSize: 12.5 }}>
                  Sending as <Text style={{ fontWeight: "800", color: colors.onSurface }}>{user.name}</Text> ({user.email})
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {["Billing", "Bug", "Feedback", "Other"].map((p) => (
                    <Pressable key={p} testID={`support-preset-${p.toLowerCase()}`} onPress={() => setSupportSubject(p)}
                      style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1,
                               backgroundColor: supportSubject === p ? colors.brandPrimary : colors.surfaceSecondary,
                               borderColor: supportSubject === p ? colors.brandPrimary : colors.border }}>
                      <Text style={{ fontSize: 12.5, fontWeight: "700", color: supportSubject === p ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{p}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput testID="support-subject" value={supportSubject} onChangeText={setSupportSubject} onFocus={kbSubject.onFocus} placeholder="Subject" placeholderTextColor={colors.muted} maxLength={120}
                  style={[styles.supportInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface }]} />
                <TextInput testID="support-message" value={supportMessage} onChangeText={setSupportMessage} onFocus={kbMessage.onFocus} placeholder="How can we help? Share as much detail as you can…" placeholderTextColor={colors.muted} multiline maxLength={4000}
                  style={[styles.supportInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface, minHeight: 96, textAlignVertical: "top" }]} />
                <Button title="Send message" icon="send" onPress={submitSupport} loading={supportBusy} testID="support-submit" />
              </View>
            )}
          </View>

          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Row icon="help-circle-outline" label="Help & FAQ" onPress={() => router.push("/profile/faq" as any)} testID="help-faq-row" />
            <Row icon="gift-outline" label="Invite a friend"
              onPress={() => shareLink(`${user.name?.split(" ")[0] || "A friend"} thinks you'd love Sail More Now, the PNW sailing community hub.`, "/", user.handle || user.name)}
              testID="refer-friend-row" />
          </View>

          {/* Notifications and email - newsletter, then appearance */}
          <Text style={[styles.sectionLabel, { color: colors.muted }]}>NOTIFICATIONS & EMAIL</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.row}>
              <Icon name="mail-outline" size={20} color={colors.onSurfaceSecondary} footprint={20} />
              <Text style={[styles.rowLabel, { color: colors.onSurface }]}>Newsletter</Text>
              <Switch value={newsletter} onValueChange={toggleNewsletter} trackColor={{ true: colors.teal }} testID="newsletter-switch" />
            </View>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.muted }]}>APPEARANCE</Text>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.segmentRow}>
              {([
                { key: "light", label: "Light", icon: "sunny-outline" },
                { key: "system", label: "System", icon: "phone-portrait-outline" },
                { key: "dark", label: "Dark", icon: "moon-outline" },
              ] as const).map((opt) => {
                const active = pref === opt.key;
                return (
                  <Pressable key={opt.key} testID={`theme-${opt.key}`} onPress={() => setPref(opt.key)} style={[styles.segment, active && { backgroundColor: colors.teal }]}>
                    <Icon name={opt.icon} size={18} color={active ? colors.onBrandSecondary : colors.onSurfaceSecondary} footprint={18} />
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.2} style={[styles.segmentText, { color: active ? colors.onBrandSecondary : colors.onSurface }]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View testID="about-legal" style={{ marginBottom: 18, marginTop: 8 }}>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.4, marginBottom: 10 }}>LEGAL</Text>
            <Pressable testID="legal-terms" onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)} style={[styles.row, { paddingHorizontal: 0 }]}>
              <Text style={{ color: colors.teal, fontWeight: "600", fontSize: 15 }}>Terms and Conditions</Text>
            </Pressable>
            <Pressable testID="legal-privacy" onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)} style={[styles.row, { paddingHorizontal: 0 }]}>
              <Text style={{ color: colors.teal, fontWeight: "600", fontSize: 15 }}>Privacy Policy</Text>
            </Pressable>
            <Pressable testID="legal-coc" onPress={() => router.push("/community-guidelines")} style={[styles.row, { paddingHorizontal: 0 }]}>
              <Text style={{ color: colors.teal, fontWeight: "600", fontSize: 15 }}>Code of Conduct</Text>
            </Pressable>
          </View>

          <View testID="about-socials" style={{ marginBottom: 18, marginTop: 8 }}>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.4, marginBottom: 10 }}>FOLLOW SAIL MORE NOW</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              {[
                { key: "instagram", glyph: "logo-instagram", label: "Instagram", href: "https://www.instagram.com/sailmorenow" },
                { key: "facebook", glyph: "logo-facebook", label: "Facebook", href: "https://www.facebook.com/sailmorenow" },
                { key: "linkedin", glyph: "logo-linkedin", label: "LinkedIn", href: "https://www.linkedin.com/company/sail-more-now" },
              ].map((s) => (
                <Pressable key={s.key} testID={`social-${s.key}`} accessibilityRole="link" accessibilityLabel={s.label}
                           onPress={() => Linking.openURL(s.href).catch(() => {})}
                           style={{ width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border }}>
                  <Icon name={s.glyph} size={22} color={colors.teal} footprint={22} />
                </Pressable>
              ))}
            </View>
          </View>

          {/* MOBILE-KB-4 build stamp - REMOVE BEFORE LAUNCH (app/(tabs)/profile/index.tsx) */}
          <DeleteAccountSheet />

          <View testID="profile-build-stamp" style={{ marginTop: 4, marginBottom: 8 }}>
            <Text style={{ color: colors.muted, fontSize: 10, textAlign: "center" }}>{BUILD_STAMP}</Text>
          </View>
        </View>
      </KeyboardFormBody>

      {/* Photo chooser */}
      <CropModal visible={!!logoCrop} uri={logoCrop?.uri || null} aspect={1} round title="Crop logo"
        onCancel={() => setLogoCrop(null)} onSave={applyOrgLogo} />
      <Modal visible={photoSheet} animationType="slide" transparent onRequestClose={() => setPhotoSheet(false)}>
        <Pressable style={styles.mktBackdrop} onPress={() => setPhotoSheet(false)}>
          <Pressable style={[styles.mktSheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <Text style={[styles.mktTitle, { color: colors.onSurface }]}>Update your photo</Text>
            <View style={{ gap: 10, marginTop: 10 }}>
              <Button title="Change photo" icon="camera" onPress={changeAvatar} testID="photo-change-btn" />
              <Button title="Add avatar" variant="secondary" icon="happy-outline" onPress={() => { setPhotoSheet(false); setIconSheet(true); }} testID="photo-addavatar-btn" />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={iconSheet} animationType="slide" transparent onRequestClose={() => setIconSheet(false)}>
        <Pressable style={styles.mktBackdrop} onPress={() => setIconSheet(false)}>
          <Pressable style={[styles.mktSheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <Text style={[styles.mktTitle, { color: colors.onSurface }]}>Pick an avatar</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
              {SAILING_ICONS.map((a) => (
                <Pressable key={a} testID={`icon-${a}`} onPress={() => pickIcon(a)}
                  style={{ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: (!user.picture && user.avatar === a) ? colors.teal : colors.border, backgroundColor: colors.surfaceSecondary }}>
                  <Text style={{ fontSize: 24 }}>{a}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={mktOpen} animationType="slide" transparent onRequestClose={() => setMktOpen(false)}>
        <View style={styles.mktBackdrop}>
          <View style={[styles.mktSheet, { backgroundColor: colors.surface }]}>
            <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={[styles.mktTitle, { color: colors.onSurface }]}>Markets you follow</Text>
            <Text style={{ color: colors.muted, marginBottom: 12 }}>Your Hub & Crew Bank "My markets" view combines everything you follow.</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {allMarkets.map((m) => {
                const on = followed.includes(m);
                return (
                  <Pressable key={m} testID={`follow-market-${m}`} onPress={() => toggleMkt(m)} style={styles.mktRow}>
                    <Icon name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.teal : colors.muted} footprint={22} />
                    <Text style={{ color: colors.onSurface, fontSize: 16, flex: 1, flexShrink: 1 }}>{m}</Text>
                    {m === user.primary_market ? <Text style={{ color: colors.muted, fontSize: 12, flexShrink: 0, marginLeft: 8 }} numberOfLines={1}>primary</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <ButtonRow
              style={{ marginTop: 14 }}
              buttons={[
                { title: "Cancel", variant: "secondary", onPress: () => { setFollowed(user.markets || []); setMktOpen(false); } },
                { title: "Save", loading: savingMkts, testID: "save-markets-btn", onPress: saveMarkets },
              ]}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={homeMktOpen} animationType="slide" transparent onRequestClose={() => setHomeMktOpen(false)}>
        <View style={styles.mktBackdrop}>
          <View style={[styles.mktSheet, { backgroundColor: colors.surface }]}>
            <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={[styles.mktTitle, { color: colors.onSurface }]}>Home market</Text>
            <Text style={{ color: colors.muted, marginBottom: 12 }}>Your primary market. It's automatically added to the markets you follow.</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {allMarkets.map((m) => {
                const on = user.primary_market === m;
                return (
                  <Pressable key={m} testID={`home-market-${m}`} onPress={() => saveHomeMarket(m)} style={styles.mktRow}>
                    <Icon name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? colors.teal : colors.muted} footprint={22} />
                    <Text style={{ color: colors.onSurface, fontSize: 16, flex: 1 }}>{m}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={{ marginTop: 14 }}>
              <Button title="Close" variant="secondary" onPress={() => setHomeMktOpen(false)} loading={savingHome} style={{ width: "100%" }} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={orgCatOpen} animationType="slide" transparent onRequestClose={() => setOrgCatOpen(false)}>
        <View style={styles.mktBackdrop}>
          <View style={[styles.mktSheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.mktTitle, { color: colors.onSurface }]}>Club / Org category</Text>
            <Text style={{ color: colors.muted, marginBottom: 12 }}>Select all that apply.</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {orgCatOptions.map((c) => {
                const on = orgCats.includes(c);
                return (
                  <Pressable key={c} testID={`profile-orgcat-${c}`}
                    onPress={() => setOrgCats((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])}
                    style={styles.mktRow}>
                    <Icon name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.teal : colors.muted} footprint={22} />
                    <Text style={{ color: colors.onSurface, fontSize: 16, flex: 1 }}>{c}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ButtonRow
              style={{ marginTop: 14 }}
              buttons={[
                { title: "Cancel", variant: "secondary", onPress: () => { setOrgCats((user as any)?.org_categories || ((user as any)?.org_category ? [(user as any).org_category] : [])); setOrgCatOpen(false); } },
                { title: "Save", loading: savingOrgCat, testID: "save-org-category-btn", onPress: saveOrgCats },
              ]}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function Row({ icon, label, onPress, testID }: { icon: any; label: string; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.row}>
      <Icon name={icon} size={20} color={colors.onSurfaceSecondary} footprint={20} />
      <Text style={[styles.rowLabel, { color: colors.onSurface }]}>{label}</Text>
      <Icon name="chevron-forward" size={18} color={colors.borderStrong} footprint={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", paddingVertical: 24, paddingHorizontal: 20, gap: 6 },
  camBadge: { position: "absolute", right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#1F3F5B" },
  name: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 8, textAlign: "center" },
  handle: { color: "#CBD5E1", fontSize: 14 },
  heroBadges: { flexDirection: "row", gap: 8, marginTop: 8 },
  section: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  sectionLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 1, marginTop: 22, marginBottom: 8, marginLeft: 4 },
  supportInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5 },
  segmentRow: { flexDirection: "row", padding: 6, gap: 6 },
  segment: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12 },
  segmentText: { fontSize: 14, fontWeight: "700" },
  mktBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  mktSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34 },
  mktTitle: { fontSize: 20, fontWeight: "800", marginBottom: 4 },
  mktRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.06)" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 15 },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
  handleRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44 },
});
