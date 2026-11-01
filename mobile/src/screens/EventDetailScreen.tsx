import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import dayjs from "dayjs";

import { Screen } from "@/src/components/Screen";
import { CrewListingPopup } from "@/src/components/CrewListingPopup";
import { Avatar, Badge, Button, ButtonRow, ErrorState, Loading } from "@/src/components/ui";
import { PartnerBadge } from "@/src/components/partner";
import { ReportButton } from "@/src/components/ReportButton";
import { AdminControls } from "@/src/components/AdminControls";
import { eventHasCrewBank } from "@/src/lib/eventRules";
import { displayPosition } from "@/src/lib/crewPositions";
import { api, ApiError } from "@/src/lib/api";
import { shareLink } from "@/src/lib/share";
import { useAuth } from "@/src/context/AuthContext";
import { canInteract } from "@/src/lib/plan";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";
import { fmtDateTime, fmtEventRange, eventTitleParts } from "@/src/lib/format";
import { LinkifiedText } from "@/src/lib/linkify";

type EventItem = {
  id: string;
  title: string;
  description?: string;
  market: string;
  starts_at: string;
  location?: string;
  image_url?: string | null;
  registration_url?: string | null;
  ends_at?: string | null;
  time_not_listed?: boolean | null;
  is_race?: boolean;
  is_volunteer?: boolean;
  is_paid?: boolean;
  is_free?: boolean;
  organizer_name?: string;
  organizer_id?: string;
  organizer_email?: string | null;
  source?: string;
};
type CrewEntry = { user_id: string; user_name?: string; user_avatar?: string | null; user_handle?: string | null; positions?: string[]; experience?: string | null; notes?: string | null; user_market?: string | null; status?: string };

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const isPaid = canInteract(user);
  const openDM = (uid: string, name?: string) => {
    if (!isPaid) { toast.error("Upgrade to message"); router.push("/pricing"); return; }
    router.push({ pathname: "/messages/[id]", params: { id: uid, name: name || "Sailor" } });
  };
  const [ev, setEv] = useState<EventItem | null>(null);
  const [selectedCrew, setSelectedCrew] = useState<CrewEntry | null>(null);
  const [mineKind, setMineKind] = useState<string | null>(null);
  const [crew, setCrew] = useState<CrewEntry[]>([]);
  const [canJoinCrew, setCanJoinCrew] = useState(false);
  const [inCrew, setInCrew] = useState(false);
  const [crewMine, setCrewMine] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = await api.get<EventItem[]>("/events?market=all");
      const found = list.find((e) => e.id === id) || null;
      setEv(found);
      const [regs, crewData] = await Promise.all([
        api.get<any>(`/events/${id}/registrations`).catch(() => null),
        api.get<any>(`/events/${id}/crew`).catch(() => null),
      ]);
      setMineKind(regs?.mine?.kind || null);
      if (crewData) {
        setCrew(crewData.entries || []);
        setCanJoinCrew(!!crewData.can_join);
        setInCrew(!!crewData.mine);
        setCrewMine(crewData.mine || null);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load event");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const register = async (kind: "attendee" | "volunteer") => {
    setBusy(true);
    try {
      if (mineKind === kind) {
        await api.del(`/events/${id}/register`);
        setMineKind(null);
        toast.info("RSVP cancelled");
      } else {
        await api.post(`/events/${id}/register`, { kind });
        setMineKind(kind);
        toast.success(kind === "volunteer" ? "You're on the volunteer list!" : "You're going!");
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { api.get<{ experience_types?: string[] }>("/markets").catch(() => {}); }, []);

  const openCrewForm = () => {
    if (!canJoinCrew && !crewMine) {
      Alert.alert("Premium feature", "Joining the Crew Bank requires a Premium membership.", [
        { text: "Not now", style: "cancel" },
        { text: "See plans", onPress: () => router.push("/pricing") },
      ]);
      return;
    }
    router.push({ pathname: "/crew-signup", params: { id: String(id), title: ev?.title || "" } });
  };

  const setCrewStatus = async (status: "seeking" | "found") => {
    setBusy(true);
    try {
      await api.patch(`/events/${id}/crew/status`, { status });
      toast.success(status === "found" ? "Marked as found. Fair winds!" : "Back to seeking");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Event"
      showBack
      padded={false}
      right={
        ev ? (
          <Pressable
            testID="event-share-btn"
            onPress={() => shareLink(`Check out "${ev.title}" on Sail More Now`, `/events?event=${ev.id}`, user?.handle || user?.name)}
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
      ) : !ev ? (
        <ErrorState message="Event not found" />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {ev.image_url ? <Image accessibilityLabel={ev.title ? `${ev.title} event flyer` : "Event flyer"} source={{ uri: ev.image_url }} style={styles.hero} /> : null}
          <View style={{ padding: 16 }}>
            <View style={styles.badges}>
              {eventTitleParts(ev.title).tentative ? <Badge label="Tentative" tone="accent" /> : null}
              {ev.is_race ? <Badge label="Race" tone="navy" /> : null}
              {ev.is_volunteer ? <Badge label="Volunteer" tone="teal" /> : null}
              {ev.is_free ? <Badge label="Free" tone="teal" /> : null}
            </View>
            <Text style={[styles.title, { color: colors.onSurface }]}>{eventTitleParts(ev.title).title}</Text>
            <View style={{ marginTop: 10 }}>
              <AdminControls entity="event" item={ev} onChanged={(next) => { if (!next) router.back(); }} />
            </View>

            <InfoRow icon="time-outline" text={fmtEventRange(ev.starts_at, ev.ends_at, ev.time_not_listed)} />
            {ev.location ? <InfoRow icon="location-outline" text={`${ev.location} · ${ev.market}`} /> : <InfoRow icon="location-outline" text={ev.market} />}
            {ev.organizer_name ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <InfoRow icon="person-outline" text={`Hosted by ${ev.organizer_name}`} />
                <PartnerBadge kind={(ev as any).organizer_partner_badge} />
              </View>
            ) : null}
            {(ev as any).source === "aggregator" && (ev as any).source_label ? (
              <InfoRow icon="link-outline" text={`Source: ${(ev as any).source_label}`} />
            ) : null}

            {ev.description ? <LinkifiedText text={ev.description} style={[styles.desc, { color: colors.onSurfaceSecondary }]} /> : null}

            {ev.is_volunteer && ((ev as any).volunteer_contact_email || (ev as any).volunteer_contact_phone) ? (
              user ? (
                <ButtonRow
                  testID="volunteer-contact"
                  style={{ marginTop: 12 }}
                  buttons={[
                    ...((ev as any).volunteer_contact_email ? [{ title: "Email", variant: "ghost" as const, icon: "mail-outline", testID: "volunteer-email-btn", onPress: () => Linking.openURL(`mailto:${(ev as any).volunteer_contact_email}`) }] : []),
                    ...((ev as any).volunteer_contact_phone ? [{ title: "Call", variant: "ghost" as const, icon: "call-outline", testID: "volunteer-phone-btn", onPress: () => Linking.openURL(`tel:${(ev as any).volunteer_contact_phone}`) }] : []),
                  ]}
                />
              ) : (
                <Text style={{ color: colors.muted, fontSize: 13, marginTop: 10 }} testID="volunteer-contact-locked">Sign in to see volunteer contact details</Text>
              )
            ) : null}

            <View style={{ gap: 10, marginTop: 20 }}>
              <Button
                title={mineKind === "attendee" ? "Going ✓ (tap to cancel)" : "I'm going"}
                variant={mineKind === "attendee" ? "secondary" : "primary"}
                icon="checkmark-circle-outline"
                onPress={() => register("attendee")}
                loading={busy}
                testID="rsvp-attendee-btn"
              />
              {ev.is_volunteer ? (
                <Button
                  title={mineKind === "volunteer" ? "Volunteering ✓" : "Volunteer"}
                  variant={mineKind === "volunteer" ? "secondary" : "ghost"}
                  icon="hand-left-outline"
                  onPress={() => register("volunteer")}
                  loading={busy}
                  testID="rsvp-volunteer-btn"
                />
              ) : null}
              {ev.registration_url ? (
                <Button title="Register" variant="ghost" icon="open-outline" testID="register-external-btn" onPress={() => Linking.openURL(ev.registration_url!)} />
              ) : null}
              {ev.organizer_email ? (
                <Button title="Contact" variant="ghost" icon="mail-outline" testID="event-contact-email-btn" onPress={() => Linking.openURL(`mailto:${ev.organizer_email}`)} />
              ) : null}
              {ev.organizer_id && ev.organizer_id !== user?.user_id ? (
                <Button
                  title="Message organizer"
                  variant="secondary"
                  icon="mail-outline"
                  onPress={() => router.push({ pathname: "/messages/[id]", params: { id: ev.organizer_id!, name: ev.organizer_name || "Organizer" } })}
                  testID="message-organizer-btn"
                />
              ) : null}
              <View style={{ flexDirection: "row", marginTop: 6 }}>
                <ReportButton targetType="event" targetId={ev.id} ownerId={ev.organizer_id} />
              </View>
            </View>

            {/* Crew bank — only for races (host ticked "This is a race" or category Racing) */}
            {eventHasCrewBank(ev) ? (
            <>
            <View style={styles.crewHead}>
              <Text style={[styles.section, { color: colors.onSurface }]}>Crew Bank</Text>
              <Button
                title={crewMine ? "Edit crew profile" : "Join crew pool"}
                variant={crewMine ? "ghost" : "secondary"}
                onPress={openCrewForm}
                loading={busy}
                testID="join-crew-btn"
                style={{ height: 40, paddingHorizontal: 14 }}
              />
            </View>
            {crewMine ? (
              <View style={[styles.statusRow, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="crew-my-status">
                <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13 }}>
                  Your status: <Text style={{ fontWeight: "800", color: crewMine.status === "found" ? colors.teal : colors.accent }}>{crewMine.status === "found" ? "Found a boat" : "Seeking"}</Text>
                </Text>
                <Button
                  title={crewMine.status === "found" ? "Re-open" : "Found a boat"}
                  variant="ghost"
                  onPress={() => setCrewStatus(crewMine.status === "found" ? "seeking" : "found")}
                  testID="crew-status-toggle"
                  style={{ height: 34, paddingHorizontal: 12 }}
                />
              </View>
            ) : null}
            {crew.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 14 }}>No crew signups yet.</Text>
            ) : (
              crew.map((c) => (
                <View key={c.user_id} style={[styles.crewRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Pressable onPress={() => setSelectedCrew(c)}
                    testID={`crew-profile-${c.user_id}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, flex: 1 }}>
                    <Avatar uri={c.user_avatar} name={c.user_name} size={36} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{c.user_name || "Sailor"}</Text>
                        {c.status === "found" ? <Badge label="Found a boat" tone="teal" /> : null}
                      </View>
                      {c.experience ? (
                        <Text style={{ color: colors.muted, fontSize: 12 }}>{c.experience}</Text>
                      ) : null}
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {c.positions && c.positions.length ? (
                          c.positions.map((p) => (
                            <View key={p} style={[styles.posTag, { backgroundColor: colors.surfaceSecondary }]}>
                              <Text style={{ color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 }}>{displayPosition(p)}</Text>
                            </View>
                          ))
                        ) : (
                          <Text style={{ color: colors.onSurfaceSecondary, fontSize: 11 }}>Not specified</Text>
                        )}
                      </View>
                      {c.notes ? <Text style={{ color: colors.onSurfaceSecondary, fontSize: 12.5, fontStyle: "italic", marginTop: 4 }}>&ldquo;{c.notes}&rdquo;</Text> : null}
                    </View>
                  </Pressable>
                  {c.user_id !== user?.user_id && c.status !== "found" ? (
                    <Button title="Message" variant="ghost" onPress={() => openDM(c.user_id, c.user_name)} style={{ height: 36, paddingHorizontal: 12 }} testID={`crew-msg-${c.user_id}`} />
                  ) : c.user_id === user?.user_id ? (
                    <Badge label="You" tone="teal" />
                  ) : null}
                </View>
              ))
            )}
            </>
            ) : null}
          </View>
        </ScrollView>
      )}
      <CrewListingPopup
        visible={!!selectedCrew}
        entry={selectedCrew}
        eventContext={ev ? { id: ev.id, title: ev.title, starts_at: ev.starts_at } : undefined}
        onClose={() => setSelectedCrew(null)}
      />
    </Screen>
  );
}

function InfoRow({ icon, text }: { icon: any; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.infoRow}>
      <Icon name={icon} size={17} color={colors.teal}  footprint={17}/>
      <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14.5, flex: 1 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { width: "100%", height: 200, backgroundColor: "#e2e8f0" },
  badges: { flexDirection: "row", gap: 8, marginBottom: 10 },
  title: { fontSize: 24, fontWeight: "800", letterSpacing: -0.5, marginBottom: 12 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  desc: { fontSize: 15, lineHeight: 22, marginTop: 12 },
  crewHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 28, marginBottom: 12 },
  section: { fontSize: 18, fontWeight: "800" },
  crewRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 10, marginBottom: 8 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
  posTag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
});
