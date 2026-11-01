import { useCallback, useEffect, useRef, useState } from "react";
import { DeviceEventEmitter, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { Screen } from "@/src/components/Screen";
import { Avatar, Button, ButtonRow, Loading } from "@/src/components/ui";
import { Icon } from "@/src/components/Icon";
import { LogoCircle } from "@/src/components/LogoCircle";
import { MotionModal } from "@/src/components/MotionModal";
import { KeyboardFormBody, useKbField } from "@/src/components/KeyboardFormScreen";
import { api, ApiError } from "@/src/lib/api";
import { REVIEWS_CHANGED } from "@/src/lib/events";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";
import { useNotifications } from "@/src/context/NotificationsContext";
import { canInteract } from "@/src/lib/plan";
import { FACTORS, OverallLine, FactorList } from "@/src/components/reviews/ratings";

const REPLY_MAX = 500;

function verb(rel?: string) { return rel === "customer_pro" || rel === "pro_pro" ? "worked" : "sailed"; }
function fmtDaysLeft(revealAt?: string, now = Date.now()) {
  if (!revealAt) return null;
  const ms = new Date(revealAt).getTime() - now;
  if (ms <= 0) return "today";
  const d = Math.ceil(ms / 86_400_000);
  return d === 1 ? "1 day" : `${d} days`;
}
function fmtGoLiveDate(revealAt?: string) {
  if (!revealAt) return "";
  const d = new Date(revealAt);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function AuthorBlock({ p }: { p: any }) {
  const { colors } = useTheme();
  const isPro = p?.account_type === "boat_pro" && p?.business_name;
  const name = isPro ? p.business_name : (p?.user_name || "A member");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
      {isPro
        ? <LogoCircle uri={p.business_logo} size={44} fallback={<Icon name="briefcase-outline" size={20} color={colors.muted} footprint={20} />} />
        : <Avatar uri={p?.user_avatar} name={name} size={44} />}
      <Text numberOfLines={2} style={{ color: colors.onSurface, fontWeight: "800", fontSize: 15, flex: 1 }}>{name}</Text>
    </View>
  );
}

function ReviewBody({ review }: { review: any }) {
  const { colors } = useTheme();
  if (!review) return null;
  const r = review.ratings || {};
  const rows = FACTORS.filter((f) => r[f.key]).map((f) => ({ key: f.key, label: f.label, value: r[f.key] }));
  return (
    <View style={{ marginTop: 8, gap: 8 }}>
      {review.comment ? <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, fontStyle: "italic", lineHeight: 20 }}>&ldquo;{review.comment}&rdquo;</Text> : null}
      {rows.length > 0 ? <FactorList rows={rows} /> : null}
    </View>
  );
}

function ReplyShown({ reply }: { reply: any }) {
  const { colors } = useTheme();
  if (!reply) return null;
  return (
    <View style={[styles.replyShown, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]} testID="reply-shown">
      <Text style={{ color: colors.tealText, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" }}>
        Reply from {reply.author_name || "the reviewed party"}
      </Text>
      <Text style={{ color: colors.onSurface, fontSize: 14, marginTop: 4, lineHeight: 20 }}>{reply.text}</Text>
    </View>
  );
}

// Public, one-time reply composer for a LIVE review about me. Keyboard-safe:
// the screen content sits in KeyboardFormBody, so onFocus scrolls this above
// the keyboard (the proven MOBILE-KB engine - no new measuring code).
function ReplyComposer({ sessionId, authorId, onPosted }: { sessionId: string; authorId: string; onPosted: () => void }) {
  const { colors } = useTheme();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const kb = useKbField(`reply-${sessionId}`);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      await api.post(`/review-sessions/${sessionId}/review/${authorId}/reply`, { text: t });
      toast.success("Reply posted.");
      setOpen(false); setText("");
      onPosted();
    } catch (e: any) {
      const st = e instanceof ApiError ? e.status : 0;
      if (st === 409) { toast.info("You already replied to this review."); onPosted(); }
      else toast.error(e instanceof ApiError ? e.message : "Could not post your reply. Try again.");
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Pressable testID={`reply-open-${sessionId}`} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Reply to this review"
        style={[styles.replyOpen, { borderColor: colors.border }]}>
        <Icon name="chatbubble-outline" size={14} color={colors.onSurfaceSecondary} footprint={14} />
        <Text style={{ color: colors.onSurface, fontSize: 12.5, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" }}>Reply</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ marginTop: 10 }} testID={`reply-composer-${sessionId}`}>
      <TextInput testID={`reply-input-${sessionId}`} value={text} onFocus={kb.onFocus} onChangeText={(t) => setText(t.slice(0, REPLY_MAX))} multiline
        placeholder="Write a public reply." placeholderTextColor={colors.muted}
        style={[styles.replyInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface }]} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <Text style={{ color: colors.muted, fontSize: 11 }}>Replies are public and can&apos;t be edited.</Text>
        <Text testID={`reply-counter-${sessionId}`} style={{ color: colors.muted, fontSize: 11 }}>{text.length}/{REPLY_MAX}</Text>
      </View>
      <ButtonRow
        style={{ marginTop: 10 }}
        buttons={[
          { title: "Cancel", variant: "secondary", testID: `reply-cancel-${sessionId}`, onPress: () => { setOpen(false); setText(""); } },
          { title: "Post reply", loading: busy, disabled: !text.trim(), weight: 1.3, testID: `reply-submit-${sessionId}`, onPress: send },
        ]}
      />
    </View>
  );
}

// The Reviews inbox (REVIEWS-3a). Blind two-way: no accept/reject, no pre-reveal
// ratings. Three tabs: Review requests / Waiting / Live. Mirrors the web /reviews.
export default function ProfileReviews() {
  const { colors } = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const { refresh: refreshBadges } = useNotifications();
  const { session: highlightId } = useLocalSearchParams<{ session?: string }>();

  const [sessions, setSessions] = useState<any[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [now, setNow] = useState(Date.now());
  const [active, setActive] = useState<string | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<any>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const didAutoCompose = useRef(false);

  const isPaid = canInteract(user);

  const load = useCallback(async () => {
    try {
      const data = await api.get<any[]>("/review-sessions/mine");
      setSessions(data || []);
      setState("ready");
      refreshBadges();
    } catch { setState("error"); }
  }, [refreshBadges]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(REVIEWS_CHANGED, () => load());
    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      const crossed = sessions.some((s) => s.status === "pending" && s.reveal_at && new Date(s.reveal_at).getTime() <= Date.now());
      if (crossed) load();
    }, 30_000);
    return () => clearInterval(t);
  }, [sessions, load]);

  const me = useCallback((s: any) => (s.participants || []).find((p: any) => p.user_id === user?.user_id), [user]);
  const other = useCallback((s: any) => (s.participants || []).find((p: any) => p.user_id !== user?.user_id) || {}, [user]);
  const iAmReviewer = useCallback((s: any) => !!me(s)?.is_reviewer, [me]);

  const requests = user ? sessions.filter((s) => s.status === "pending" && !iAmReviewer(s)) : [];
  const waiting = user ? sessions.filter((s) => s.status === "pending" && iAmReviewer(s)) : [];
  const live = user ? sessions.filter((s) => s.live) : [];
  const groups: Record<string, any[]> = { requests, waiting, live };
  const TABS = [
    { key: "requests", label: "Review requests", count: requests.length },
    { key: "waiting", label: "Waiting", count: waiting.length },
    { key: "live", label: "Live", count: live.length },
  ];
  const nothing = !requests.length && !waiting.length && !live.length;

  // Open on the first non-empty tab (requests -> waiting -> live).
  useEffect(() => {
    if (state !== "ready" || active) return;
    setActive(requests.length ? "requests" : waiting.length ? "waiting" : live.length ? "live" : "requests");
  }, [state, active, requests.length, waiting.length, live.length]);

  const toCompose = useCallback((s: any, mode: "back" | "edit") => {
    const o = other(s);
    const mine = s.my_review || {};
    const r = mine.ratings || {};
    router.push({
      pathname: "/review-compose",
      params: {
        mode, sessionId: s.id, relationship: s.relationship || "",
        targetName: o?.business_name || o?.user_name || "them",
        ...(mode === "edit" ? {
          initOverall: String(r.overall || 0),
          initPersonality: String(r.personality || 0), initSkill: String(r.skill || 0),
          initPromptness: String(r.promptness || 0), initCommunication: String(r.communication || 0),
          initComment: mine.comment || "", initContext: s.context_note || "",
        } : {}),
      },
    } as any);
  }, [other]);

  // ?session= deep link / notification tap: focus the tab holding it, flash it,
  // and (paid review request) open the review-back composer once.
  useEffect(() => {
    if (!highlightId || state !== "ready") return;
    const inReq = requests.some((s) => s.id === highlightId);
    const tab = inReq ? "requests" : waiting.some((s) => s.id === highlightId) ? "waiting"
      : live.some((s) => s.id === highlightId) ? "live" : null;
    if (tab) setActive(tab);
    const found = sessions.find((s) => s.id === highlightId);
    if (inReq && found && isPaid && !didAutoCompose.current) {
      didAutoCompose.current = true;
      toCompose(found, "back");
    }
    setFlash(highlightId);
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [highlightId, state, sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  const doWithdraw = async (s: any) => {
    setBusyId(`${s.id}:withdraw`);
    try {
      await api.post(`/review-sessions/${s.id}/withdraw`, {});
      toast.success("Review withdrawn.");
      setWithdrawFor(null);
      await load();
    } catch (e: any) {
      const st = e instanceof ApiError ? e.status : 0;
      if (st === 409) { toast.info("This review can no longer be withdrawn."); await load(); }
      else toast.error(e instanceof ApiError ? e.message : "Could not withdraw. Try again.");
      setWithdrawFor(null);
    } finally { setBusyId(null); }
  };

  if (!user) return null;

  const cardStyle = (id: string) => [styles.card, { backgroundColor: colors.surface, borderColor: flash === id ? colors.teal : colors.border, borderWidth: flash === id ? 2 : 1 }];

  const RequestCard = (s: any) => {
    const author = other(s);
    const left = fmtDaysLeft(s.reveal_at, now);
    return (
      <View key={s.id} testID={`review-session-${s.id}`} style={cardStyle(s.id)}>
        <AuthorBlock p={author} />
        <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, marginTop: 8, lineHeight: 20 }}>
          <Text style={{ fontWeight: "800", color: colors.onSurface }}>{author?.business_name || author?.user_name || "Someone"}</Text> says you {verb(s.relationship)} with them and left you a review.
        </Text>
        <Text testID={`countdown-${s.id}`} style={{ color: colors.muted, fontSize: 12, marginTop: 10 }}>Goes live in {left}</Text>
        {isPaid ? (
          <View style={{ flexDirection: "row", marginTop: 14 }}>
            <Button title="Review them back" variant="teal" icon="star-outline" testID={`review-back-${s.id}`} onPress={() => toCompose(s, "back")} style={{ height: 44, paddingHorizontal: 20 }} />
          </View>
        ) : (
          <View style={{ marginTop: 12, gap: 10 }}>
            <Text testID={`free-golive-${s.id}`} style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, lineHeight: 20 }}>
              It goes live on <Text style={{ fontWeight: "800", color: colors.onSurface }}>{fmtGoLiveDate(s.reveal_at)}</Text>. Upgrade to review them back.
            </Text>
            <Pressable testID={`req-plan-prompt-${s.id}`} onPress={() => router.push("/pricing" as any)}
              style={[styles.upsell, { borderColor: colors.teal, backgroundColor: colors.tealSoft }]}>
              <Icon name="star-outline" size={18} color={colors.teal} footprint={18} />
              <Text style={{ flex: 1, color: colors.onSurface, fontWeight: "700", fontSize: 13 }}>Upgrade to review them back and unlock all member features.</Text>
              <Icon name="chevron-forward" size={18} color={colors.teal} footprint={18} />
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  const WaitingCard = (s: any) => {
    const o = other(s);
    const left = fmtDaysLeft(s.reveal_at, now);
    return (
      <View key={s.id} testID={`review-session-${s.id}`} style={cardStyle(s.id)}>
        <AuthorBlock p={o} />
        <Text testID={`countdown-${s.id}`} style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, marginTop: 10, lineHeight: 20 }}>
          Waiting for <Text style={{ fontWeight: "800", color: colors.onSurface }}>{o?.business_name || o?.user_name || "them"}</Text> to review you back. Goes live in <Text style={{ fontWeight: "800", color: colors.onSurface }}>{left}</Text>.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          <Button title="Edit" variant="secondary" icon="create-outline" testID={`edit-mine-${s.id}`} onPress={() => toCompose(s, "edit")} style={{ height: 44, paddingHorizontal: 20 }} />
          <Button title="Withdraw" variant="danger" testID={`withdraw-${s.id}`} onPress={() => setWithdrawFor(s)} style={{ height: 44, paddingHorizontal: 20 }} />
        </View>
      </View>
    );
  };

  const LiveCard = (s: any) => {
    const o = other(s);
    const aboutMe = s.other_review;   // their review of me -> I may reply
    const byMe = s.my_review;         // my review of them
    return (
      <View key={s.id} testID={`review-session-${s.id}`} style={cardStyle(s.id)}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <AuthorBlock p={o} />
          <View testID={`live-label-${s.id}`} style={{ backgroundColor: colors.tealSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 0 }}>
            <Text style={{ color: colors.teal, fontWeight: "800", fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase" }}>Live</Text>
          </View>
        </View>

        {aboutMe ? (
          <View style={{ marginTop: 12 }} testID={`live-about-me-${s.id}`}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text numberOfLines={1} style={{ color: colors.accent, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", flexShrink: 1 }}>Their review of you</Text>
              <OverallLine value={aboutMe?.ratings?.overall} />
            </View>
            <ReviewBody review={aboutMe} />
            {aboutMe.reply ? <ReplyShown reply={aboutMe.reply} />
              : <ReplyComposer sessionId={s.id} authorId={aboutMe.author_id} onPosted={load} />}
            <Pressable testID={`report-${s.id}`} onPress={() => Linking.openURL(`mailto:disputes@sailmorenow.com?subject=${encodeURIComponent(`Report review ${s.id}`)}`)}
              accessibilityRole="button" accessibilityLabel="Report this review"
              style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, minHeight: 32 }}>
              <Icon name="flag-outline" size={13} color={colors.muted} footprint={13} />
              <Text style={{ color: colors.muted, fontSize: 12.5, textDecorationLine: "underline" }}>Report this review</Text>
            </Pressable>
          </View>
        ) : null}

        {byMe ? (
          <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }} testID={`live-by-me-${s.id}`}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text numberOfLines={1} style={{ color: colors.tealText, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", flexShrink: 1 }}>Your review</Text>
              <OverallLine value={byMe?.ratings?.overall} />
            </View>
            <ReviewBody review={byMe} />
            {byMe.reply ? <ReplyShown reply={byMe.reply} /> : null}
          </View>
        ) : null}
      </View>
    );
  };

  const renderGroup = (key: string) => {
    const items = groups[key];
    if (!items.length) {
      const msg = key === "requests" ? "No review requests right now."
        : key === "waiting" ? "You have no reviews waiting." : "No live reviews yet.";
      return <Text testID={`empty-${key}`} style={{ color: colors.muted, textAlign: "center", paddingVertical: 28 }}>{msg}</Text>;
    }
    const render = key === "requests" ? RequestCard : key === "waiting" ? WaitingCard : LiveCard;
    return <View style={{ gap: 10 }}>{items.map(render)}</View>;
  };

  return (
    <Screen title="Reviews" showBack padded={false}>
      {state === "loading" ? (
        <Loading />
      ) : state === "error" ? (
        <View style={{ padding: 24, alignItems: "center", gap: 12 }} testID="reviews-error">
          <Text style={{ color: colors.error, fontSize: 14 }}>We couldn&apos;t load your reviews.</Text>
          <Button title="Retry" onPress={() => { setState("loading"); load(); }} testID="reviews-retry" />
        </View>
      ) : nothing ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text testID="reviews-empty" style={{ color: colors.muted, textAlign: "center" }}>No reviews yet.</Text>
        </View>
      ) : (
        <>
          {/* Tab strip: scrolls inside itself, never pushes the page horizontally. */}
          <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} testID="reviews-tablist">
              {TABS.map((t) => {
                const selected = active === t.key;
                return (
                  <Pressable key={t.key} testID={`tab-${t.key}`} onPress={() => setActive(t.key)}
                    accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={`${t.label}, ${t.count}`}
                    style={[styles.tab, { borderBottomColor: selected ? colors.accent : "transparent" }]}>
                    <Text style={{ color: selected ? colors.onSurface : colors.muted, fontWeight: "800", fontSize: 14 }}>{t.label}</Text>
                    <View testID={`tab-count-${t.key}`} style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", backgroundColor: selected ? colors.accent : colors.surfaceSecondary }}>
                      <Text style={{ color: selected ? colors.onAccent : colors.onSurfaceSecondary, fontSize: 11, fontWeight: "800" }}>{t.count}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <KeyboardFormBody padded={false} contentBottom={48} contentContainerStyle={{ padding: 16 }} testID={`panel-${active}`}>
            {active ? renderGroup(active) : null}
          </KeyboardFormBody>
        </>
      )}

      {/* Withdraw confirm */}
      <MotionModal visible={!!withdrawFor} transparent animationType="fade" onRequestClose={() => setWithdrawFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setWithdrawFor(null)}>
          <Pressable style={[styles.confirmCard, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <Text style={{ color: colors.onSurface, fontSize: 18, fontWeight: "800", marginBottom: 8 }}>Withdraw this review?</Text>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20, marginBottom: 18 }}>
              {withdrawFor ? (other(withdrawFor)?.business_name || other(withdrawFor)?.user_name || "They") : "They"} will be told. If they want to review you, the process starts over.
            </Text>
            <ButtonRow
              buttons={[
                { title: "Cancel", variant: "secondary", testID: "withdraw-cancel", onPress: () => setWithdrawFor(null) },
                { title: "Withdraw review", variant: "danger", loading: busyId === `${withdrawFor?.id}:withdraw`, testID: "withdraw-confirm", onPress: () => doWithdraw(withdrawFor) },
              ]}
            />
          </Pressable>
        </Pressable>
      </MotionModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: 12, gap: 6 },
  tab: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, minHeight: 44, borderBottomWidth: 2 },
  card: { borderRadius: 16, padding: 16 },
  upsell: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 44 },
  replyOpen: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, marginTop: 10 },
  replyInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5, minHeight: 72, textAlignVertical: "top" },
  replyShown: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  confirmCard: { margin: 16, borderRadius: 18, padding: 20 },
});
