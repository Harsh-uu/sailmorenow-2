import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Image as ExpoImage } from "expo-image";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View, DeviceEventEmitter } from "react-native";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { Avatar, Badge, Button, Card, ErrorState, Loading } from "@/src/components/ui";
import { LogoCircle } from "@/src/components/LogoCircle";
import { ImageLightbox } from "@/src/components/ImageLightbox";
import { api } from "@/src/lib/api";
import { shareLink } from "@/src/lib/share";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { handleUpgrade } from "@/src/lib/upgrade";
import { useTheme } from "@/src/theme";
import { useGo, useStackBase } from "@/src/lib/stackBase";
import { ACCOUNT_TYPE_LABELS, fmtTimeAgo } from "@/src/lib/format";
import { ReviewButton } from "@/src/components/reviews/ReviewButton";
import { ReviewsSection } from "@/src/components/reviews/ReviewsSection";
import { REVIEWS_CHANGED } from "@/src/lib/events";

export default function PublicProfile() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const go = useGo();
  const stackBase = useStackBase();
  const [data, setData] = useState<any>(null);
  const [lightbox, setLightbox] = useState<{ images: { uri: string; alt?: string }[]; index: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [reviewRefresh, setReviewRefresh] = useState(0);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(REVIEWS_CHANGED, () => setReviewRefresh((k) => k + 1));
    return () => sub.remove();
  }, []);
  const [rsvpDone, setRsvpDone] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setError(null);
      const d = await api.get<any>(`/u/${handle}`);
      setData(d);
      setFollowing(!!d.is_following);
      setFollowerCount(d.follower_count || 0);
      setBlocked(!!d.is_blocked);
    } catch (e: any) {
      setError(e?.message || "Profile not found");
    } finally {
      setLoading(false);
    }
  }, [handle]);

  const signUp = useCallback(async (ev: any) => {
    if (!user) { toast.warning("Sign in to sign up for events"); return; }
    setRsvpDone((m) => ({ ...m, [ev.id]: "busy" }));
    try {
      await api.post(`/events/${ev.id}/register`, { kind: "rsvp" });
      setRsvpDone((m) => ({ ...m, [ev.id]: "done" }));
      toast.success("You're signed up!");
    } catch (e: any) {
      setRsvpDone((m) => { const n = { ...m }; delete n[ev.id]; return n; });
      handleUpgrade(e, toast);
    }
  }, [user]);

  const doBlock = useCallback(async (next: boolean) => {
    const uid = data?.user?.user_id;
    if (!uid) return;
    setBlockBusy(true);
    try {
      if (next) { await api.post(`/follows/block/${uid}`); setFollowing(false); toast.success("Blocked"); }
      else { await api.del(`/follows/block/${uid}`); toast.success("Unblocked"); }
      setBlocked(next);
    } catch { toast.error("Action failed"); }
    finally { setBlockBusy(false); }
  }, [data?.user?.user_id]);

  const toggleBlock = useCallback(() => {
    if (blockBusy) return;
    if (blocked) { doBlock(false); return; }
    const isOrgProfile = data?.user?.account_type === "partner";
    Alert.alert(isOrgProfile ? "Block this organization?" : "Block this member?", "They won't be able to follow or message you, and you'll stop following them.", [
      { text: "Cancel", style: "cancel" },
      { text: "Block", style: "destructive", onPress: () => doBlock(true) },
    ]);
  }, [blocked, blockBusy, doBlock, data?.user?.account_type]);

  const toggleFollow = useCallback(async () => {
    const uid = data?.user?.user_id;
    if (!uid || followBusy) return;
    setFollowBusy(true);
    const next = !following;
    setFollowing(next);
    setFollowerCount((c) => c + (next ? 1 : -1));
    try {
      const res = next ? await api.post(`/follows/${uid}`) : await api.del(`/follows/${uid}`);
      if (typeof res?.follower_count === "number") setFollowerCount(res.follower_count);
    } catch {
      setFollowing(!next);
      setFollowerCount((c) => c + (next ? -1 : 1));
      toast.error("Couldn't update follow");
    } finally {
      setFollowBusy(false);
    }
  }, [data?.user?.user_id, following, followBusy]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const u = data?.user;
  const isOrg = u?.account_type === "partner";
  const logoSrc = u ? (u.logo_url || u.picture || u.avatar) : undefined;
  const cats: string[] = u ? (u.org_categories?.length ? u.org_categories : (u.org_category ? [u.org_category] : [])) : [];
  const isCommunityPartner = isOrg && !!u?.partner_badge;
  // One swipeable sequence for the viewer: cover, gallery 1..5, logo (empties
  // skipped). The viewer shows the full uncropped ORIGINAL (falls back to crop).
  const orgMedia: { uri: string; alt?: string }[] = u ? [
    ...(u.cover_url ? [{ uri: (u.cover_original_url || u.cover_url) as string, alt: `${u.name} cover` }] : []),
    ...((u.photos || []).map((p: any, i: number) => ({ uri: (p.original || p.url) as string, alt: p.caption || `${u.name} photo ${i + 1}` }))),
    ...(logoSrc ? [{ uri: (u.logo_original_url || logoSrc) as string, alt: `${u.name} logo` }] : []),
  ] : [];
  const gallerySeqStart = u?.cover_url ? 1 : 0;
  const logoSeqIdx = orgMedia.length - 1;
  const img = (x?: string | null) => (x && x.startsWith("/api/") ? `${process.env.EXPO_PUBLIC_BACKEND_URL}${x}` : x || undefined);

  return (
    <Screen title={u ? `@${u.handle}` : "Profile"} showBack padded={false}>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {isOrg ? (
            <>
              {stackBase === "/directory" ? (
                <Pressable testID="org-back-to-directory" onPress={() => router.back()} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <Icon name="arrow-back" size={16} color={colors.muted} footprint={16} />
                  <Text style={{ color: colors.muted, fontWeight: "600", fontSize: 13 }}>Back to directory</Text>
                </Pressable>
              ) : null}

              <View style={[styles.orgCard, { backgroundColor: isCommunityPartner ? colors.navy : colors.teal }]} testID="org-profile-card">
                {(u.cover_url || (Array.isArray(u.photos) && u.photos.length > 0)) ? (
                  <View style={{ marginBottom: 14, gap: 6 }} testID="org-photos-gallery">
                    {u.cover_url ? (
                      <Pressable onPress={() => setLightbox({ images: orgMedia, index: 0 })} testID="org-hero-photo-btn">
                        <ExpoImage source={{ uri: img(u.cover_url) }} style={{ width: "100%", aspectRatio: 3.5, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.12)" }} contentFit="cover" testID="org-hero-photo" />
                      </Pressable>
                    ) : null}
                    {Array.isArray(u.photos) && u.photos.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                        {u.photos.slice(0, 6).map((p: any, i: number) => (
                          <Pressable key={i} onPress={() => setLightbox({ images: orgMedia, index: gallerySeqStart + i })} testID={`org-photo-btn-${i}`}>
                            <ExpoImage source={{ uri: img(p.url) }} style={{ width: 170, aspectRatio: 2.5, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.12)" }} contentFit="cover" testID={`org-photo-${i}`} />
                            {p.caption ? (
                              <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", borderBottomLeftRadius: 10, borderBottomRightRadius: 10, paddingHorizontal: 6, paddingVertical: 3 }}>
                                <Text style={{ color: "#fff", fontSize: 10 }} numberOfLines={1}>{p.caption}</Text>
                              </View>
                            ) : null}
                          </Pressable>
                        ))}
                      </ScrollView>
                    ) : null}
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
                  <Pressable disabled={!logoSrc} onPress={() => logoSrc && setLightbox({ images: orgMedia, index: logoSeqIdx })} testID="org-logo-btn">
                    <LogoCircle uri={logoSrc} size={64} accessibilityLabel={`${u.name} logo`}
                      fallback={<View style={{ width: "100%", height: "100%", backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}><Icon name="flag" size={26} color="#fff" footprint={26} /></View>} />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    {u?.partner_badge ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                        <View style={[styles.cardChip, { backgroundColor: u.partner_badge === "founding" ? colors.accent : colors.teal }]}
                              testID="org-tier-badge"
                              accessibilityLabel={u.partner_badge === "founding" ? "Founding Partner" : "Community Partner"}>
                          <Text style={{ color: colors.navy, fontWeight: "800", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{u.partner_badge === "founding" ? "Founding Partner" : "Community Partner"}</Text>
                        </View>
                      </View>
                    ) : null}
                    <Text style={styles.orgName} numberOfLines={2}>{u.name}</Text>
                    <Text style={styles.orgHandle}>@{u.handle}</Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 10 }}>
                  {u.primary_market ? (
                    <View style={styles.metaRow}>
                      <Icon name="location-outline" size={14} color="rgba(255,255,255,0.8)" footprint={14} />
                      <Text style={{ color: "rgba(255,255,255,0.85)" }}>{u.primary_market}</Text>
                    </View>
                  ) : null}
                  {data.rating != null ? (
                    <View style={styles.metaRow}>
                      <Icon name="star" size={14} color={colors.accent} footprint={14} />
                      <Text style={{ color: "#fff", fontWeight: "700" }}>{data.rating} · {data.review_count}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={{ flexDirection: "row", gap: 18, marginTop: 10 }}>
                  <Text style={{ color: "#fff" }}><Text style={{ fontWeight: "800" }} testID="profile-follower-count">{followerCount}</Text> <Text style={{ color: "rgba(255,255,255,0.8)" }}>follower{followerCount === 1 ? "" : "s"}</Text></Text>
                  <Text style={{ color: "#fff" }}><Text style={{ fontWeight: "800" }}>{data.following_count || 0}</Text> <Text style={{ color: "rgba(255,255,255,0.8)" }}>following</Text></Text>
                </View>

                {cats.length ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                    {cats.map((c) => (
                      <View key={c} style={[styles.cardChip, { backgroundColor: "rgba(255,255,255,0.14)" }]}>
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>{c}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {u.bio ? <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: 15, lineHeight: 22, marginTop: 12 }}>{u.bio}</Text> : null}

                {u.user_id !== user?.user_id ? (
                  <View style={{ gap: 10, marginTop: 16 }}>
                    {!blocked ? (
                      <>
                        <Pressable testID="follow-user-btn" onPress={toggleFollow} disabled={followBusy} style={[styles.cardBtn, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
                          <Icon name={following ? "check" : "add"} size={18} color="#fff" footprint={18} />
                          <Text style={styles.cardBtnText}>{following ? "Following" : "Follow"}</Text>
                        </Pressable>
                        <Pressable testID="message-user-btn" onPress={() => router.push({ pathname: "/messages/[id]", params: { id: u.user_id, name: u.name } })} style={[styles.cardBtn, { backgroundColor: colors.accent }]}>
                          <Icon name="chatbubble-outline" size={18} color={colors.onAccent} footprint={18} />
                          <Text style={[styles.cardBtnText, { color: colors.onAccent }]}>Message</Text>
                        </Pressable>
                      </>
                    ) : null}
                    <Pressable testID="org-share-btn" onPress={() => shareLink(`Check out ${u.name} on Sail More Now`, `/u/${u.handle}`, user?.handle || user?.name)} style={[styles.cardBtn, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
                      <Icon name="share-outline" size={18} color="#fff" footprint={18} />
                      <Text style={styles.cardBtnText}>Share</Text>
                    </Pressable>
                    <Pressable testID={blocked ? "unblock-user-btn" : "block-user-btn"} onPress={toggleBlock} disabled={blockBusy}
                      style={{ alignSelf: "center", paddingVertical: 6, marginTop: 2, opacity: blockBusy ? 0.5 : 1 }}>
                      <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, textDecorationLine: "underline" }}>{blocked ? "Unblock this organization" : "Block this organization"}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ gap: 10, marginTop: 16 }}>
                    <Pressable testID="org-edit-listing-btn" onPress={() => router.push("/profile/org-listing" as any)} style={[styles.cardBtn, { backgroundColor: colors.accent }]}>
                      <Icon name="create-outline" size={18} color={colors.onAccent} footprint={18} />
                      <Text style={[styles.cardBtnText, { color: colors.onAccent }]}>Edit my listing</Text>
                    </Pressable>
                    <Pressable testID="org-share-btn" onPress={() => shareLink(`Check out ${u.name} on Sail More Now`, `/u/${u.handle}`, user?.handle || user?.name)} style={[styles.cardBtn, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
                      <Icon name="share-outline" size={18} color="#fff" footprint={18} />
                      <Text style={styles.cardBtnText}>Share</Text>
                    </Pressable>
                  </View>
                )}

                <View style={{ marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.2)", paddingTop: 14 }} testID="org-contact-card">
                  {u.website ? (
                    <Pressable testID="org-website" onPress={() => Linking.openURL(u.website.startsWith("http") ? u.website : `https://${u.website}`)} style={styles.contactRow}>
                      <Icon name="globe-outline" size={18} color={colors.accent} footprint={18} />
                      <Text style={{ color: "#fff", fontWeight: "600", flex: 1 }} numberOfLines={1}>{u.website.replace(/^https?:\/\//, "")}</Text>
                    </Pressable>
                  ) : null}
                  {u.public_email ? (
                    <Pressable testID="org-email" onPress={() => Linking.openURL(`mailto:${u.public_email}`)} style={styles.contactRow}>
                      <Icon name="mail-outline" size={18} color={colors.accent} footprint={18} />
                      <Text style={{ color: "rgba(255,255,255,0.92)", flex: 1 }} numberOfLines={1}>{u.public_email}</Text>
                    </Pressable>
                  ) : null}
                  {u.public_phone ? (
                    <Pressable testID="org-phone" onPress={() => Linking.openURL(`tel:${u.public_phone}`)} style={styles.contactRow}>
                      <Icon name="call-outline" size={18} color={colors.accent} footprint={18} />
                      <Text style={{ color: "rgba(255,255,255,0.92)", flex: 1 }}>{u.public_phone}</Text>
                    </Pressable>
                  ) : null}
                  {!u.website && !u.public_email && !u.public_phone ? (
                    <Text style={{ color: "rgba(255,255,255,0.7)" }}>No public contact details listed yet.</Text>
                  ) : null}
                </View>
              </View>

              <Text style={[styles.section, { color: colors.onSurface }]}>Upcoming events</Text>
              {data.upcoming_events?.length ? data.upcoming_events.map((ev: any) => (
                <Card key={ev.id} style={{ marginBottom: 10 }} testID={`org-event-${ev.id}`}>
                  <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 15 }}>{ev.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 4 }}>
                    {(ev.starts_at || "").slice(0, 10)}{ev.location ? ` · ${ev.location}` : ev.market ? ` · ${ev.market}` : ""}
                  </Text>
                  <Button
                    title={rsvpDone[ev.id] === "done" ? "Signed up ✓" : "Sign up"}
                    variant={rsvpDone[ev.id] === "done" ? "secondary" : "primary"}
                    onPress={() => signUp(ev)}
                    loading={rsvpDone[ev.id] === "busy"}
                    disabled={rsvpDone[ev.id] === "done"}
                    testID={`org-event-signup-${ev.id}`}
                    style={{ marginTop: 10 }}
                  />
                </Card>
              )) : <Text style={{ color: colors.muted, marginBottom: 6 }}>No upcoming events scheduled.</Text>}

              {data.recent_posts?.length ? (
                <>
                  <Text style={[styles.section, { color: colors.onSurface }]}>Recent activity</Text>
                  {data.recent_posts.map((p: any) => {
                    const isDisc = p.type === "forum" || p.type === "blog";
                    return (
                      <Card key={p.id} onPress={() => go(isDisc ? `/hub/${p.id}` : `/post/${p.id}`)} style={{ marginBottom: 10 }}>
                        <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 15 }}>{p.title}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 4 }}>
                          {isDisc ? `${p.type} · ` : ""}{p.market} · {fmtTimeAgo(p.created_at)}
                        </Text>
                      </Card>
                    );
                  })}
                </>
              ) : null}

              <Text style={[styles.section, { color: colors.onSurface }]}>Reviews</Text>
              {user && u.user_id !== user.user_id ? (
                <View style={{ marginBottom: 8 }}>
                  <ReviewButton targetId={u.user_id} targetName={u.name} />
                </View>
              ) : null}
              <ReviewsSection targetId={u.user_id} kind="org" refreshKey={reviewRefresh} />
            </>
          ) : (
            <>
              <View style={styles.head}>
                <Avatar uri={logoSrc} name={u.name} size={72} />
                <Text style={[styles.name, { color: colors.onSurface }]}>{u.name}</Text>
                <View style={styles.badges}>
                  <Badge label={ACCOUNT_TYPE_LABELS[u.account_type] || "Member"} tone="teal" />
                  {u.identity_verified ? <Badge label="Verified" tone="navy" /> : null}
                </View>
                {u.primary_market ? (
                  <View style={styles.metaRow}>
                    <Icon name="location-outline" size={14} color={colors.muted} footprint={14} />
                    <Text style={{ color: colors.muted }}>{u.primary_market}</Text>
                  </View>
                ) : null}
                {u.account_type === "boat_owner" && (u.boat_name || u.boat_make_model) ? (
                  <View style={styles.metaRow} testID="profile-boat-info">
                    <Icon name="boat-outline" size={14} color={colors.teal} footprint={14} />
                    <Text style={{ color: colors.onSurfaceSecondary }}>
                      {u.boat_name || ""}{u.boat_name && u.boat_make_model ? " · " : ""}{u.boat_make_model || ""}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.countsRow}>
                  <View style={styles.countItem}>
                    <Text style={[styles.countNum, { color: colors.onSurface }]} testID="profile-follower-count">{followerCount}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>follower{followerCount === 1 ? "" : "s"}</Text>
                  </View>
                  <View style={[styles.countDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.countItem}>
                    <Text style={[styles.countNum, { color: colors.onSurface }]}>{data.following_count || 0}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>following</Text>
                  </View>
                </View>
              </View>

              {u.user_id !== user?.user_id && !blocked ? (
                <Button title={following ? "Following" : "Follow"} variant={following ? "secondary" : "primary"} icon={following ? "check" : "add"} onPress={toggleFollow} loading={followBusy} testID="follow-user-btn" style={{ marginTop: 16 }} />
              ) : null}

              {u.bio ? <Text style={[styles.bio, { color: colors.onSurfaceSecondary }]}>{u.bio}</Text> : null}

              {data.pro ? (
                <Button title="View Boat Pro listing" variant="secondary" icon="briefcase-outline" onPress={() => go(`/pro/${u.user_id}`)} style={{ marginTop: 16 }} />
              ) : null}

              {u.user_id !== user?.user_id && !blocked ? (
                <Button title="Message" variant="primary" icon="chatbubble-outline" onPress={() => router.push({ pathname: "/messages/[id]", params: { id: u.user_id, name: u.name } })} testID="message-user-btn" style={{ marginTop: 10 }} />
              ) : null}

              {u.user_id !== user?.user_id ? (
                <Button title={blocked ? "Unblock" : "Block"} variant="secondary" icon={blocked ? "check" : "close"} onPress={toggleBlock} loading={blockBusy} testID={blocked ? "unblock-user-btn" : "block-user-btn"} style={{ marginTop: 10 }} />
              ) : null}

              {data.recent_posts?.length ? (
                <>
                  <Text style={[styles.section, { color: colors.onSurface }]}>Recent posts</Text>
                  {data.recent_posts.map((p: any) => {
                    const isDisc = p.type === "forum" || p.type === "blog";
                    return (
                      <Card key={p.id} onPress={() => go(isDisc ? `/hub/${p.id}` : `/post/${p.id}`)} style={{ marginBottom: 10 }}>
                        <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 15 }}>{p.title}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 4 }}>
                          {isDisc ? `${p.type} · ` : ""}{p.market} · {fmtTimeAgo(p.created_at)}
                        </Text>
                      </Card>
                    );
                  })}
                </>
              ) : null}
              <Text style={[styles.section, { color: colors.onSurface }]}>Reviews</Text>
              {user && u.user_id !== user.user_id ? (
                <View style={{ marginBottom: 8 }}>
                  <ReviewButton targetId={u.user_id} targetName={u.name} targetIdentity="personal" />
                </View>
              ) : null}
              <ReviewsSection targetId={u.user_id} kind="member" identity="personal" refreshKey={reviewRefresh} />
            </>
          )}
        </ScrollView>
      )}
      <ImageLightbox open={!!lightbox} images={lightbox?.images || []} index={lightbox?.index || 0} onClose={() => setLightbox(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: "center", gap: 8 },
  name: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4, marginTop: 8 },
  badges: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  bio: { fontSize: 15, lineHeight: 22, marginTop: 16, textAlign: "center" },
  countsRow: { flexDirection: "row", alignItems: "center", gap: 20, marginTop: 14 },
  countItem: { alignItems: "center" },
  countNum: { fontSize: 18, fontWeight: "800" },
  countDivider: { width: StyleSheet.hairlineWidth, height: 26 },
  section: { fontSize: 18, fontWeight: "800", marginTop: 26, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  orgCard: { borderRadius: 24, padding: 20, marginTop: 4 },
  cardChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  orgName: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4, color: "#fff" },
  orgHandle: { fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 2 },
  cardBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 18 },
  cardBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
