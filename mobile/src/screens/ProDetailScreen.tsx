import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { DeviceEventEmitter, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { Avatar, Badge, Button, ErrorState, Loading } from "@/src/components/ui";
import { LogoCircle } from "@/src/components/LogoCircle";
import { ImageLightbox } from "@/src/components/ImageLightbox";
import { api, ApiError } from "@/src/lib/api";
import { shareLink } from "@/src/lib/share";
import { useAuth } from "@/src/context/AuthContext";
import { canInteract } from "@/src/lib/plan";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";
import { fmtPhone } from "@/src/lib/format";
import { MotionModal } from "@/src/components/MotionModal";
import { ReviewButton } from "@/src/components/reviews/ReviewButton";
import { ReviewsSection } from "@/src/components/reviews/ReviewsSection";
import { REVIEWS_CHANGED } from "@/src/lib/events";

type Pro = {
  user_id: string;
  company_name: string;
  business_handle?: string;
  short_bio?: string;
  categories?: string[];
  markets?: string[];
  logo_url?: string | null;
  logo_original_url?: string | null;
  cover_url?: string | null;
  cover_original_url?: string | null;
  photos?: ({ url: string; original?: string } | string)[];
  website?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_locked?: boolean;
  hire_count?: number;
  viewer_hired?: boolean;
  tier?: string;
  certifications?: string[];
  licenses?: string[];
  insurance?: string[];
};
type Review = { id: string; author_id?: string; author_name?: string; author_avatar?: string | null; rating: number; comment?: string; category_ratings?: Record<string, number>; created_at: string };

export default function ProDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [pro, setPro] = useState<Pro | null>(null);
  const [reviewRefresh, setReviewRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hired, setHired] = useState(false);
  const [hireCount, setHireCount] = useState(0);
  const [hireBusy, setHireBusy] = useState(false);
  const [reviewSignal, setReviewSignal] = useState(0);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(REVIEWS_CHANGED, () => setReviewRefresh((k) => k + 1));
    return () => sub.remove();
  }, []);
  const [showHirePrompt, setShowHirePrompt] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: { uri: string; alt?: string }[]; index: number } | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get<{ pro: Pro; reviews: Review[] }>(`/boat-pros/${id}`);
      setPro(data.pro);
      setHired(!!data.pro.viewer_hired);
      setHireCount(data.pro.hire_count || 0);
    } catch (e: any) {
      setError(e?.message || "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const markHired = async () => {
    if (!user) return toast.warning("Sign in to hire");
    if (hired) return;
    setHireBusy(true);
    try {
      const res = await api.post<{ hired: boolean; count: number }>(`/boat-pros/${id}/hire`);
      setHired(res.hired);
      setHireCount(res.count);
      if (res.hired) { toast.success("You hired this pro"); if (user.account_type !== "boat_pro" && canInteract(user)) setShowHirePrompt(true); }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't update");
    } finally {
      setHireBusy(false);
    }
  };

  // Un-hiring is a deliberate, separate action — a tap on the hired state never
  // removes the hire. The backend /hire route toggles, so this only fires when
  // currently hired.
  const unHire = async () => {
    if (!hired) return;
    setHireBusy(true);
    try {
      const res = await api.post<{ hired: boolean; count: number }>(`/boat-pros/${id}/hire`);
      setHired(res.hired);
      setHireCount(res.count);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't update");
    } finally {
      setHireBusy(false);
    }
  };

  // Tapping the hired state re-opens the review prompt for paid, non-pro members
  // (never un-hires); for everyone else it is a non-destructive no-op.
  const onHiredTap = () => {
    if (user && user.account_type !== "boat_pro" && canInteract(user)) setShowHirePrompt(true);
  };

  const isOwner = !!user && pro?.user_id === user.user_id;
  const resolveU = (u?: string | null) => (u && u.startsWith("/api/") ? `${process.env.EXPO_PUBLIC_BACKEND_URL}${u}` : u || undefined);
  const galleryPhotos = (pro?.photos || []).map((p) => (typeof p === "string" ? { url: p } : p));
  const media: { uri: string; alt?: string }[] = [];
  const coverSrc = pro?.cover_original_url || pro?.cover_url;
  if (coverSrc) media.push({ uri: coverSrc, alt: `${pro?.company_name} cover` });
  const galleryStart = media.length;
  galleryPhotos.forEach((p, i) => { const s = p.original || p.url; if (s) media.push({ uri: s, alt: `${pro?.company_name} photo ${i + 1}` }); });
  if (pro?.logo_url) media.push({ uri: pro.logo_original_url || pro.logo_url, alt: `${pro?.company_name} logo` });
  const openLightbox = (index: number) => setLightbox({ images: media, index });
  const hasCreds = ((pro?.certifications || []).length + (pro?.licenses || []).length + (pro?.insurance || []).length) > 0;
  const showCredsPublic = pro?.tier === "premium" && hasCreds;
  const ownerLockedCreds = isOwner && pro?.tier !== "premium";

  return (
    <Screen
      title={pro?.company_name || "Boat Pro"}
      showBack
      padded={false}
      right={
        pro ? (
          <Pressable
            testID="pro-share-btn"
            onPress={() => shareLink(`Check out ${pro.company_name} on Sail More Now`, `/directory/${pro.user_id}`, user?.handle || user?.name)}
            hitSlop={10}
          >
            <Icon name="share-outline" size={22} color={colors.onBrandPrimary}  footprint={22}/>
          </Pressable>
        ) : null
      }
    >
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !pro ? (
        <ErrorState message="Profile not found" />
      ) : (
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {coverSrc ? (
            <Pressable testID="pro-cover-btn" onPress={() => openLightbox(0)} accessibilityRole="imagebutton" accessibilityLabel="View cover photo">
              <Image accessibilityLabel="Cover photo" source={{ uri: resolveU(coverSrc) }} style={styles.cover} />
            </Pressable>
          ) : null}
          <View style={styles.head}>
            <View style={[styles.logoWrap, { borderColor: colors.border }]}>
              <LogoCircle uri={pro.logo_url} size={60} testID="pro-logo"
                fallback={<Avatar uri={null} name={pro.company_name} size={60} />} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.onSurface }]} numberOfLines={2}>{pro.company_name}</Text>
              {pro.business_handle ? <Text testID="pro-handle" style={{ color: colors.muted, fontSize: 13 }}>@{pro.business_handle}</Text> : null}
            </View>
          </View>

          {isOwner ? (
            <Button title="Edit listing" variant="secondary" icon="create-outline" onPress={() => router.push({ pathname: "/directory/boat-pro-listing", params: { from: "directory" } } as any)} testID="pro-edit-listing-btn" style={{ marginTop: 14 }} />
          ) : null}

          {pro.short_bio ? <Text style={[styles.bio, { color: colors.onSurfaceSecondary }]}>{pro.short_bio}</Text> : null}

          <View style={styles.chips}>
            {(pro.categories || []).map((c) => (
              <Badge key={c} label={c} tone="teal" maxScale={2} />
            ))}
          </View>
          <View style={styles.chips}>
            {(pro.markets || []).map((m) => (
              <Badge key={m} label={m} tone="muted" maxScale={2} />
            ))}
          </View>

          {galleryPhotos.length ? (
            <View style={styles.gallery} testID="pro-gallery">
              {galleryPhotos.map((p, i) => (
                <Pressable key={i} testID={`pro-gallery-${i}`} onPress={() => openLightbox(galleryStart + i)} style={[styles.galleryTile, { backgroundColor: colors.surfaceSecondary }]} accessibilityRole="imagebutton" accessibilityLabel={`View photo ${i + 1}`}>
                  <Image accessibilityLabel={`Work sample ${i + 1}`} source={{ uri: resolveU(p.url) }} style={{ width: "100%", height: "100%" }} />
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={{ gap: 10, marginTop: 20 }}>
            {pro.user_id !== user?.user_id ? (
              <Button
                title="Message"
                variant="primary"
                icon="chatbubble-outline"
                onPress={() => router.push({ pathname: "/messages/[id]", params: { id: pro.user_id, name: pro.company_name, as: "business", label: pro.company_name, peer: "business" } })}
                testID="message-pro-btn"
              />
            ) : null}
            {user && pro.user_id !== user.user_id ? (
              hired ? (
                <View style={{ gap: 6 }}>
                  <Button
                    title="You hired this pro"
                    variant="teal"
                    icon="checkmark-circle"
                    loading={hireBusy}
                    onPress={onHiredTap}
                    testID="hire-btn"
                  />
                  <Pressable testID="unhire-btn" onPress={unHire} disabled={hireBusy} hitSlop={8} style={{ alignSelf: "center", paddingVertical: 6, paddingHorizontal: 12 }}>
                    <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 13 }}>Undo</Text>
                  </Pressable>
                </View>
              ) : (
                <Button
                  title="Hired?"
                  variant="secondary"
                  loading={hireBusy}
                  onPress={markHired}
                  testID="hire-btn"
                />
              )
            ) : null}
            {user && pro.user_id === user.user_id ? (
              <Text testID="hire-count" style={{ color: colors.onSurfaceSecondary, fontWeight: "700" }}>{hireCount} hire{hireCount === 1 ? "" : "s"}</Text>
            ) : null}
            {pro.contact_locked ? (
              <Button title="Sign in to see contact details" variant="ghost" icon="lock-closed-outline" onPress={() => router.push("/signin")} testID="contact-locked" />
            ) : (
              <>
                {pro.website ? <Button title="Visit website" variant="ghost" icon="globe-outline" onPress={() => Linking.openURL(pro.website!.startsWith("http") ? pro.website! : `https://${pro.website}`)} /> : null}
                {pro.contact_phone ? <Button title={fmtPhone(pro.contact_phone)} variant="ghost" icon="call-outline" onPress={() => Linking.openURL(`tel:${(pro.contact_phone || "").replace(/\D/g, "")}`)} /> : null}
              </>
            )}
          </View>

          {showCredsPublic || ownerLockedCreds ? (
            <View style={{ marginTop: 22 }}>
              <Text style={[styles.section, { color: colors.onSurface, marginTop: 0, marginBottom: 10 }]}>Trust and credentials</Text>
              {ownerLockedCreds ? (
                <View testID="pro-credentials-locked" style={{ flexDirection: "row", gap: 12, alignItems: "center", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 14 }}>
                  <Icon name="lock-closed" size={20} color={colors.muted} footprint={20} />
                  <Text style={{ flex: 1, color: colors.onSurfaceSecondary, fontSize: 13.5, lineHeight: 19 }}>Trust and credentials is part of Premium. Upgrade to show yours on your listing.</Text>
                </View>
              ) : (
                <View testID="pro-credentials" style={{ gap: 12 }}>
                  {([["certifications", "Certifications"], ["licenses", "Licenses"], ["insurance", "Insurance"]] as const).map(([k, label]) => (
                    (pro as any)[k]?.length ? (
                      <View key={k} testID={`pro-creds-${k}`}>
                        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>{label}</Text>
                        {((pro as any)[k] as string[]).map((v, i) => (
                          <Text key={i} style={{ color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21 }}>• {v}</Text>
                        ))}
                      </View>
                    ) : null
                  ))}
                </View>
              )}
            </View>
          ) : null}

          {/* Reviews (single review system) */}
          <Text style={[styles.section, { color: colors.onSurface }]}>Reviews</Text>
          {pro.user_id !== user?.user_id ? (
            <View style={{ marginBottom: 4 }}>
              <ReviewButton targetId={pro.user_id} targetName={pro.company_name} targetIdentity="business" openSignal={reviewSignal} />
            </View>
          ) : null}
          <ReviewsSection targetId={pro.user_id} kind="member" identity="business" refreshKey={reviewRefresh} />
        </ScrollView>
      )}
      <ImageLightbox open={!!lightbox} images={lightbox?.images || []} index={lightbox?.index || 0} onClose={() => setLightbox(null)} />

      <MotionModal visible={showHirePrompt} transparent animationType="fade" onRequestClose={() => setShowHirePrompt(false)}>
        <Pressable testID="hire-review-prompt" style={styles.promptBackdrop} onPress={() => setShowHirePrompt(false)}>
          <Pressable style={[styles.promptSheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <Text style={[styles.promptTitle, { color: colors.onSurface }]}>Want to leave a review?</Text>
            <Text style={[styles.promptBody, { color: colors.onSurfaceSecondary }]}>
              You hired {pro?.company_name}. Your review helps other boat owners.
            </Text>
            <Button
              title="Leave a review"
              variant="teal"
              testID="hire-review-write"
              onPress={() => { setShowHirePrompt(false); setReviewSignal((s) => s + 1); }}
              style={{ marginTop: 16 }}
            />
            <Button
              title="Not now"
              variant="primary"
              testID="hire-review-not-now"
              onPress={() => setShowHirePrompt(false)}
              style={{ marginTop: 10 }}
            />
          </Pressable>
        </Pressable>
      </MotionModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 14 },
  logoWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#FFFFFF", borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  cover: { width: "100%", aspectRatio: 3.5, borderRadius: 14, marginBottom: 14, backgroundColor: "#e2e8f0" },
  name: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  bio: { fontSize: 15, lineHeight: 22, marginTop: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  gallery: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  galleryTile: { width: "31.5%", aspectRatio: 1, borderRadius: 12, overflow: "hidden" },
  photo: { width: 140, height: 100, borderRadius: 12, marginRight: 10, backgroundColor: "#e2e8f0" },
  section: { fontSize: 18, fontWeight: "800", marginTop: 26, marginBottom: 12 },
  reviewForm: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 },
  stars: { flexDirection: "row", gap: 6, marginBottom: 10 },
  catRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  catChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, gap: 2 },
  textarea: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 70, textAlignVertical: "top", fontSize: 15 },
  reviewCard: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 10 },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  promptBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  promptSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingVertical: 22, paddingHorizontal: 16 },
  promptTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  promptBody: { fontSize: 14.5, lineHeight: 21, marginTop: 8 },
});
