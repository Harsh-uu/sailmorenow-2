import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, Platform, Pressable, StyleSheet, Text, View, Keyboard } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { LogoCircle } from "@/src/components/LogoCircle";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { File as ExpoFile } from "expo-file-system";
import * as LegacyFS from "expo-file-system/legacy";
import { Icon } from "@/src/components/Icon";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";
import { API, getToken } from "@/src/lib/api";
import { CropModal } from "@/src/components/CropModal";
import { ICON_BOAT_PROS } from "@/src/lib/plans";

const BANNER_ASPECT = 1024 / 224;
const GALLERY_ASPECT = 2.5; // 5:2 — shared by crop frame, editor tile and public thumbnail
type Photo = { url: string; original?: string; caption?: string };
type Data = {
  logo_url?: string; logo_original_url?: string;
  cover_url?: string; cover_original_url?: string;
  photos: Photo[]; org_name?: string; handle?: string; isCP?: boolean;
};
type Target = "logo" | "cover" | number;

export function ProfileCardEditor({ data, maxPhotos, accent, onImageChange, showCover = true, showLogo = true, badgeLabel, coverAspect = BANNER_ASPECT, galleryLocked = false, onContactUs, entityKind }: {
  data: Data; maxPhotos: number; accent: string; onImageChange: (partial: any) => Promise<void>;
  showCover?: boolean; showLogo?: boolean; badgeLabel?: string;
  coverAspect?: number; galleryLocked?: boolean; onContactUs?: () => void; entityKind?: string;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [menu, setMenu] = useState<Target | null>(null);
  const [crop, setCrop] = useState<{ target: Target; uri: string; original: string; format?: "jpeg" | "png" } | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, () => void>>({});
  const [confirmRemove, setConfirmRemove] = useState<Target | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const photos = data.photos || [];
  const keyOf = (t: Target) => (typeof t === "number" ? `g${t}` : t);
  const resolveImg = (u?: string | null) => (u && u.startsWith("/api/") ? `${process.env.EXPO_PUBLIC_BACKEND_URL}${u}` : u || undefined);

  // Upload a local image (file:// on native, blob:/data: on web) to object
  // storage and return its short /api/files URL. Mirrors the avatar upload so
  // the listing save only ever carries URLs, never large base64.
  const uploadImage = async (uri: string): Promise<string> => {
    const fd = new FormData();
    if (Platform.OS === "web") {
      const blob = await (await fetch(uri)).blob();
      const ok = ["image/jpeg", "image/png", "image/webp"];
      const type = ok.includes(blob.type) ? blob.type : "image/jpeg";
      fd.append("file", new File([blob], "photo.jpg", { type }));
    } else {
      fd.append("file", new ExpoFile(uri) as any);
    }
    const token = await getToken();
    const res = await fetch(`${API}/org-listing/upload`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    if (!res.ok) { const d = await res.text().catch(() => ""); throw new Error(`(${res.status}) ${d.slice(0, 120)}`); }
    return (await res.json()).url as string;
  };
  // Already-stored images come back as /api/files URLs — reuse them as-is.
  const ensureUrl = async (src: string) => (src.startsWith("/api/") || src.startsWith("http") ? src : uploadImage(src));

  // expo-image-manipulator can only process a LOCAL file. A stored photo lives
  // at a remote /api/files URL, so re-cropping it must download to a local file
  // first — otherwise manipulate throws and Save silently did nothing.
  const toLocalUri = async (uri: string): Promise<string> => {
    if (!uri || uri.startsWith("file://") || uri.startsWith("data:") || uri.startsWith("blob:")) return uri;
    if (Platform.OS === "web") {
      const blob = await (await fetch(uri)).blob();
      return URL.createObjectURL(blob);
    }
    const dest = `${LegacyFS.cacheDirectory || ""}crop_${Date.now()}.jpg`;
    const r = await LegacyFS.downloadAsync(uri, dest);
    return r.uri;
  };

  const persist = async (key: string, partial: any, retry: () => void) => {
    setBusy((b) => ({ ...b, [key]: true }));
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
    try {
      await onImageChange(partial);
      toast.success("Saved");
    } catch {
      setErrors((e) => ({ ...e, [key]: retry }));
      toast.error("Could not save. Tap Try again.");
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[key]; return n; });
    }
  };
  const cfg = (t: Target) => (t === "logo" ? { aspect: 1, round: true, title: "Crop logo" }
    : t === "cover" ? { aspect: coverAspect, round: false, title: "Crop cover photo" }
      : { aspect: GALLERY_ASPECT, round: false, title: "Crop photo" });

  const ensurePerm = async () => {
    const p = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (p.status === "granted") return true;
    if (!p.canAskAgain) {
      Alert.alert("Photos access needed", "Enable photo access in Settings to add photos.", [
        { text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]);
      return false;
    }
    return (await ImagePicker.requestMediaLibraryPermissionsAsync()).status === "granted";
  };

  const pickFor = async (target: Target) => {
    setMenu(null);
    Keyboard.dismiss();
    // Adding beyond the gallery cap must say so, not silently do nothing.
    if (typeof target === "number" && target >= photos.length && photos.length >= maxPhotos) {
      toast.error(`Your gallery is full (${maxPhotos} photos). Remove one to add another.`);
      return;
    }
    if (!(await ensurePerm())) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 0.9 });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    const uri = r.assets[0].uri;
    // A transparent PNG/WebP logo is kept as PNG so it never turns black; covers
    // and gallery photos (and opaque logos) stay JPEG for a small file size.
    const mime = (r.assets[0].mimeType || "").toLowerCase();
    const isPngLogo = target === "logo" && (mime.includes("png") || mime.includes("webp"));
    const fmt: "jpeg" | "png" = isPngLogo ? "png" : "jpeg";
    const saveFormat = isPngLogo ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG;
    try {
      // Stored ORIGINAL kept high quality for the full-size viewer: cover/gallery
      // up to 2000px long side at 0.8; the small logo stays modest (1000px).
      const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: target === "logo" ? 1000 : 2000 } }], { compress: 0.8, format: saveFormat });
      setCrop({ target, uri, original: small.uri, format: fmt });
    } catch {
      setCrop({ target, uri, original: uri, format: fmt });
    }
  };

  const cropCurrent = async (target: Target) => {
    setMenu(null);
    const src = target === "logo" ? (data.logo_original_url || data.logo_url)
      : target === "cover" ? (data.cover_original_url || data.cover_url)
        : (photos[target]?.original || photos[target]?.url);
    if (!src) return;
    const key = keyOf(target);
    const remote = resolveImg(src) as string;
    // Preserve a transparent logo on re-crop: a stored .png means keep PNG.
    const fmt: "jpeg" | "png" = target === "logo" && /\.png(\?|$)/i.test(src) ? "png" : "jpeg";
    // Freshly-picked local files crop directly; stored photos must be downloaded
    // to a local file first (keep `original` as the stored URL so we don't re-upload it).
    if (remote.startsWith("file://") || remote.startsWith("data:") || remote.startsWith("blob:")) {
      setCrop({ target, uri: remote, original: src, format: fmt });
      return;
    }
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      const localUri = await toLocalUri(remote);
      setCrop({ target, uri: localUri, original: src, format: fmt });
    } catch {
      toast.error("Couldn't open that photo to crop. Check your connection and try again.");
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[key]; return n; });
    }
  };

  const applyCrop = (cropped: string) => {
    if (!crop) return;
    const { target, original } = crop;
    setCrop(null);
    const key = keyOf(target);
    setPreviews((p) => ({ ...p, [key]: cropped }));
    const run = async () => {
      setBusy((b) => ({ ...b, [key]: true }));
      setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
      try {
        const url = await uploadImage(cropped);
        const originalUrl = await ensureUrl(original);
        let partial: any;
        if (target === "logo") partial = { logo_url: url, logo_original_url: originalUrl };
        else if (target === "cover") partial = { cover_url: url, cover_original_url: originalUrl };
        else {
          const next = [...photos];
          next[target] = { url, original: originalUrl, caption: photos[target]?.caption || "" };
          partial = { photos: next.filter(Boolean) };
        }
        await onImageChange(partial);
        setPreviews((p) => { const n = { ...p }; delete n[key]; return n; });
        toast.success("Saved");
      } catch {
        setErrors((e) => ({ ...e, [key]: run }));
        toast.error("Could not save. Tap Try again.");
      } finally {
        setBusy((b) => { const n = { ...b }; delete n[key]; return n; });
      }
    };
    run();
  };

  const doRemove = (target: Target) => {
    setConfirmRemove(null);
    const key = keyOf(target);
    setPreviews((p) => { const n = { ...p }; delete n[key]; return n; });
    let partial: any;
    if (target === "logo") partial = { logo_url: "", logo_original_url: "" };
    else if (target === "cover") partial = { cover_url: "", cover_original_url: "" };
    else partial = { photos: photos.filter((_, i) => i !== target) };
    persist(key, partial, () => doRemove(target));
  };

  const Overlay = ({ k }: { k: string }) => {
    if (busy[k]) return <View style={styles.overlay} testID={`slot-busy-${k}`}><ActivityIndicator color="#fff" /></View>;
    if (errors[k]) return (
      <View style={styles.overlay} testID={`slot-error-${k}`}>
        <Pressable onPress={() => errors[k]()} testID={`slot-retry-${k}`} style={styles.retry}><Text style={{ color: colors.navy, fontWeight: "800", fontSize: 12 }}>Try again</Text></Pressable>
      </View>
    );
    return null;
  };

  const Cam = () => (
    <View style={styles.cam} pointerEvents="none"><Icon name="camera" size={16} color="#fff" footprint={16} /></View>
  );

  const hasFor = (t: Target) => t === "logo" ? !!data.logo_url : t === "cover" ? !!data.cover_url : !!photos[t as number];

  return (
    <View testID="profile-card-editor">
      <View style={[styles.card, { backgroundColor: accent }]}>
        {/* Cover */}
        {showCover ? (
        <Pressable testID="edit-cover" onPress={() => setMenu("cover")} style={{ width: "100%", aspectRatio: coverAspect, backgroundColor: "rgba(255,255,255,0.1)" }}>
          {(previews.cover || data.cover_url) ? <ExpoImage source={{ uri: previews.cover || resolveImg(data.cover_url) }} style={{ width: "100%", height: "100%" }} contentFit="cover" testID="cover-img" />
            : <View style={[styles.center, { borderWidth: 2, borderColor: "rgba(255,255,255,0.6)", borderStyle: "dashed", borderRadius: 14, margin: 8 }]}><Icon name="image-outline" size={26} color="rgba(255,255,255,0.9)" footprint={26} /><Text style={styles.ph}>Add cover photo</Text><Text style={[styles.ph, { fontSize: 10, fontWeight: "400" }]}>recommended 1600 x {Math.round(1600 / (coverAspect || BANNER_ASPECT))}</Text></View>}
          <Cam />
          <Overlay k="cover" />
        </Pressable>
        ) : null}

        {/* Logo + identity */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16 }}>
          {showLogo ? (
          <Pressable testID="edit-logo" onPress={() => setMenu("logo")} style={styles.logo}>
            <LogoCircle uri={previews.logo || data.logo_url} size={76}
              fallback={<View style={[styles.center, { borderWidth: 2, borderColor: "rgba(255,255,255,0.7)", borderStyle: "dashed", borderRadius: 999, gap: 2 }]}>{entityKind === "boat_pro" ? <ExpoImage source={{ uri: ICON_BOAT_PROS }} style={{ width: 28, height: 28 }} contentFit="contain" /> : <Icon name="image-outline" size={24} color="#fff" footprint={24} />}<Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>Add logo</Text></View>} />
            <Cam />
            <Overlay k="logo" />
          </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            {data.isCP ? (
              <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                <Text style={{ color: colors.navy, fontSize: 9, fontWeight: "800", letterSpacing: 0.4 }}>{badgeLabel || "COMMUNITY PARTNER"}</Text>
              </View>
            ) : null}
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 4 }} numberOfLines={1}>{data.org_name || "Your organization"}</Text>
            {data.handle ? <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 12 }}>@{data.handle}</Text> : null}
          </View>
        </View>

        {/* Gallery */}
        {galleryLocked ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }} testID="gallery-locked">
          <View style={styles.lockRow}>
            <View style={styles.lockIcon}><Icon name="lock-closed" size={18} color="#fff" footprint={18} /></View>
            <Text style={styles.lockText}>More photos are part of Community Partner.</Text>
            <Pressable testID="gallery-contact-us" onPress={() => onContactUs?.()} style={styles.lockBtn}>
              <Text style={{ color: "#1F3F5B", fontWeight: "800", fontSize: 13 }}>Contact us</Text>
            </Pressable>
          </View>
        </View>
        ) : maxPhotos > 0 ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "800", letterSpacing: 0.5, marginBottom: 8 }}>PHOTO GALLERY</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {Array.from({ length: maxPhotos }).map((_, i) => {
              const p = photos[i];
              const slotW = maxPhotos === 1 ? "100%" as const : "31%" as const;
              const k = `g${i}`;
              const hasErr = !!errors[k];
              const pv = previews[k];
              const showUri = pv || resolveImg(p?.url);
              return (p || pv) ? (
                <Pressable key={i} testID={`gallery-slot-${i}`} onPress={() => hasErr ? errors[k]() : setMenu(i)} style={{ width: slotW, aspectRatio: GALLERY_ASPECT, borderRadius: 12, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.1)" }}>
                  <ExpoImage source={{ uri: showUri }} style={{ width: "100%", height: "100%" }} contentFit="cover" testID={`gallery-img-${i}`} />
                  <Cam />
                  {busy[k] ? <View style={styles.overlay} testID={`slot-busy-${k}`}><ActivityIndicator color="#fff" /></View> : null}
                  {hasErr ? <View style={styles.errBadge} testID={`slot-error-${k}`}><Icon name="alert-circle" size={13} color="#fff" footprint={13} /></View> : null}
                </Pressable>
              ) : (
                <Pressable key={i} testID={`gallery-empty-${i}`} onPress={() => hasErr ? errors[k]() : pickFor(photos.length)} style={{ width: slotW, aspectRatio: GALLERY_ASPECT, borderRadius: 12, borderWidth: 2, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.4)", alignItems: "center", justifyContent: "center", gap: 2 }}>
                  <Icon name="add" size={20} color="rgba(255,255,255,0.8)" footprint={20} />
                  <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "600" }}>Add photo</Text>
                  {busy[k] ? <View style={styles.overlay} testID={`slot-busy-${k}`}><ActivityIndicator color="#fff" /></View> : null}
                  {hasErr ? <View style={styles.errBadge} testID={`slot-error-${k}`}><Icon name="alert-circle" size={13} color="#fff" footprint={13} /></View> : null}
                </Pressable>
              );
            })}
          </View>
          {Object.keys(errors).some((k) => k.startsWith("g")) ? (
            <Text testID="gallery-error-line" style={{ color: colors.error, fontSize: 12.5, fontWeight: "700", marginTop: 8 }}>Upload failed. Tap the photo to try again.</Text>
          ) : null}
        </View>
        ) : null}
      </View>

      {/* Action sheet */}
      <Modal visible={menu !== null} transparent animationType="slide" onRequestClose={() => setMenu(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenu(null)} testID="image-menu">
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={(e) => e.stopPropagation()}>
            <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 15, padding: 14 }}>{menu === "logo" ? "Logo" : menu === "cover" ? "Cover photo" : "Photo"}</Text>
            <Pressable testID="menu-upload" onPress={() => menu !== null && pickFor(menu)} style={styles.sheetRow}><Icon name="image-outline" size={18} color={colors.teal} footprint={18} /><Text style={[styles.sheetText, { color: colors.onSurface }]}>Upload new photo</Text></Pressable>
            {menu !== null && hasFor(menu) ? <Pressable testID="menu-crop" onPress={() => cropCurrent(menu)} style={styles.sheetRow}><Icon name="crop" size={18} color={colors.teal} footprint={18} /><Text style={[styles.sheetText, { color: colors.onSurface }]}>Crop current photo</Text></Pressable> : null}
            {menu !== null && hasFor(menu) ? <Pressable testID="menu-remove" onPress={() => { const t = menu; setMenu(null); setConfirmRemove(t); }} style={styles.sheetRow}><Icon name="trash-outline" size={18} color={colors.error} footprint={18} /><Text style={[styles.sheetText, { color: colors.error }]}>Remove</Text></Pressable> : null}
            <Pressable testID="menu-cancel" onPress={() => setMenu(null)} style={[styles.sheetRow, { justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}><Text style={[styles.sheetText, { color: colors.muted }]}>Cancel</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Remove confirm */}
      <Modal visible={confirmRemove !== null} transparent animationType="fade" onRequestClose={() => setConfirmRemove(null)}>
        <View style={styles.centerModal} testID="remove-confirm">
          <View style={[styles.confirm, { backgroundColor: colors.surface }]}>
            <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 17 }}>Remove this photo?</Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>This can&apos;t be undone. You can upload a new one anytime.</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <Pressable testID="remove-confirm-no" onPress={() => setConfirmRemove(null)} style={[styles.cbtn, { backgroundColor: colors.surfaceSecondary }]}><Text style={{ color: colors.onSurface, fontWeight: "700" }}>Cancel</Text></Pressable>
              <Pressable testID="remove-confirm-yes" onPress={() => confirmRemove !== null && doRemove(confirmRemove)} style={[styles.cbtn, { backgroundColor: colors.error }]}><Text style={{ color: "#fff", fontWeight: "800" }}>Remove</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {crop ? <CropModal visible uri={crop.uri} {...cfg(crop.target)} format={crop.format || "jpeg"} onCancel={() => setCrop(null)} onSave={applyCrop} onError={(m) => { setCrop(null); toast.error(m); }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, overflow: "hidden" },
  center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 2 },
  ph: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600" },
  logo: { width: 76, height: 76, borderRadius: 38, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  cam: { position: "absolute", right: 6, bottom: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)" },
  retry: { backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 14, minHeight: 36, alignItems: "center", justifyContent: "center" },
  errBadge: { position: "absolute", top: 6, left: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: "#DC2626", alignItems: "center", justifyContent: "center" },
  badge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, minHeight: 52 },
  sheetText: { fontSize: 15, fontWeight: "600" },
  centerModal: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  confirm: { borderRadius: 18, padding: 20, width: "100%", maxWidth: 340 },
  cbtn: { minHeight: 44, borderRadius: 999, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  lockRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 14, backgroundColor: "rgba(255,255,255,0.1)" },
  lockIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  lockText: { flex: 1, color: "rgba(255,255,255,0.9)", fontSize: 13.5, fontWeight: "700", lineHeight: 19 },
  lockBtn: { minHeight: 44, borderRadius: 999, backgroundColor: "#fff", paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
});
