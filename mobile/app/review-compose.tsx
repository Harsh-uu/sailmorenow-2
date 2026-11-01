import { useState } from "react";
import { DeviceEventEmitter, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { Button, ButtonRow } from "@/src/components/ui";
import { Screen } from "@/src/components/Screen";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { FACTORS } from "@/src/components/reviews/ratings";
import { api, ApiError } from "@/src/lib/api";
import { REVIEWS_CHANGED } from "@/src/lib/events";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

const COMMENT_MAX = 1000;
const CONTEXT_MAX = 200;

function Stars({ value, onChange, testID, size = 28 }: { value: number; onChange: (n: number) => void; testID: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 4 }} testID={testID} accessibilityRole="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} testID={`${testID}-${n}`} onPress={() => onChange(n)} hitSlop={6}
          accessibilityRole="radio" accessibilityState={{ selected: n === value }} accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}
          style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <Icon name={n <= value ? "star" : "star-outline"} size={size} color={colors.accent} footprint={size} />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The ONE two-way/one-way review editor, now a full SCREEN (not a Modal) so the
 * keyboard never covers the inputs on a real device. Reached from ReviewButton
 * (write / post-Hired) and from the Reviews inbox (review back). Field order is
 * unchanged: Overall (required) + Personality / Skill / Promptness /
 * Communication (optional) + Comment + What was this for + confirm.
 */
export default function ReviewComposeScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{
    mode?: string; relationship?: string; counterpartyId?: string; targetName?: string;
    reviewType?: string; prompt?: string; sessionId?: string; targetIdentity?: string;
    initOverall?: string; initPersonality?: string; initSkill?: string; initPromptness?: string;
    initCommunication?: string; initComment?: string; initContext?: string;
  }>();
  const mode = params.mode === "back" ? "back" : params.mode === "edit" ? "edit" : "write";
  const isOneWay = params.reviewType === "one_way";
  const targetName = params.targetName || "this member";
  const worked = params.relationship === "customer_pro" || params.relationship === "pro_pro" || params.prompt === "worked together";
  const confirmText = worked ? "We worked together." : "We sailed together.";

  const num = (v?: string) => { const n = parseInt(v || "0", 10); return Number.isFinite(n) ? n : 0; };
  const [overall, setOverall] = useState(num(params.initOverall));
  const [ratings, setRatings] = useState<Record<string, number>>({ personality: num(params.initPersonality), skill: num(params.initSkill), promptness: num(params.initPromptness), communication: num(params.initCommunication) });
  const [comment, setComment] = useState(params.initComment || "");
  const [contextNote, setContextNote] = useState(params.initContext || "");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const field = { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface, minHeight: 72, textAlignVertical: "top" as const };
  const commentKb = useKbField("comment");
  const contextKb = useKbField("context");

  const handleErr = (e: any) => {
    const st = e instanceof ApiError ? e.status : 0;
    if (st === 403) { toast.info(e instanceof ApiError ? e.message : "Reviews are for paid members."); router.back(); }
    else if (st === 400 || st === 409) { setErr(e instanceof ApiError ? e.message : "Something went wrong. Try again."); }
    else setErr(st === 422 ? "That comment is too long." : (e instanceof ApiError ? e.message : "Something went wrong. Try again."));
  };

  const submitTwoWayWrite = async () => {
    setBusy(true); setErr(null);
    try {
      const out: Record<string, number> = { overall };
      FACTORS.forEach((f) => { if (ratings[f.key]) out[f.key] = ratings[f.key]; });
      await api.post("/review-sessions", { relationship: params.relationship, counterparty_id: params.counterpartyId, target_identity: params.targetIdentity || undefined, ratings: out, comment, context_note: contextNote });
      DeviceEventEmitter.emit(REVIEWS_CHANGED);
      setDone(true);
    } catch (e) { handleErr(e); } finally { setBusy(false); }
  };

  const submitEdit = async () => {
    setBusy(true); setErr(null);
    try {
      const out: Record<string, number> = { overall };
      FACTORS.forEach((f) => { if (ratings[f.key]) out[f.key] = ratings[f.key]; });
      await api.put(`/review-sessions/${params.sessionId}/review`, { ratings: out, comment, context_note: contextNote });
      DeviceEventEmitter.emit(REVIEWS_CHANGED);
      toast.success("Review updated.");
      router.back();
    } catch (e) {
      const st = e instanceof ApiError ? e.status : 0;
      if (st === 409) { toast.info("This review can no longer be edited."); DeviceEventEmitter.emit(REVIEWS_CHANGED); router.back(); }
      else handleErr(e);
    } finally { setBusy(false); }
  };

  const submitBack = async () => {
    setBusy(true); setErr(null);
    try {
      const out: Record<string, number> = { overall };
      FACTORS.forEach((f) => { if (ratings[f.key]) out[f.key] = ratings[f.key]; });
      await api.post(`/review-sessions/${params.sessionId}/accept`, { ratings: out, comment });
      DeviceEventEmitter.emit(REVIEWS_CHANGED);
      toast.success("Your review is in. Both reviews are now live.");
      router.back();
    } catch (e) {
      const st = e instanceof ApiError ? e.status : 0;
      if (st === 409) { toast.info("This review was already handled."); DeviceEventEmitter.emit(REVIEWS_CHANGED); router.back(); }
      else handleErr(e);
    } finally { setBusy(false); }
  };

  const submitOneWay = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post("/reviews", { target_id: params.counterpartyId, rating: overall, comment: comment.trim() });
      DeviceEventEmitter.emit(REVIEWS_CHANGED);
      toast.success("Thanks. Your review is live.");
      router.back();
    } catch (e) { handleErr(e); } finally { setBusy(false); }
  };

  // Two-way write success confirmation
  if (done) {
    return (
      <Screen title="Review sent" showBack>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 }}>
          <View style={{ height: 56, width: 56, borderRadius: 28, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" }}>
            <Icon name="checkmark-circle" size={34} color={colors.teal} footprint={34} />
          </View>
          <Text style={{ color: colors.onSurfaceSecondary, fontSize: 15, lineHeight: 22, textAlign: "center" }}>
            Thanks. {targetName} has been asked to review you back. Your review stays private until they do, or it goes live on its own in 7 days.
          </Text>
          <ButtonRow
            style={{ alignSelf: "stretch", marginTop: 8 }}
            buttons={[
              { title: "Done", variant: "ghost", onPress: () => router.back(), testID: "review-success-done" },
              { title: "See my reviews", variant: "teal", weight: 1.4, testID: "see-my-reviews", onPress: () => { router.back(); router.push("/profile/reviews" as any, { withAnchor: true }); } },
            ]}
          />
        </View>
      </Screen>
    );
  }

  const onSubmit = mode === "back" ? submitBack : mode === "edit" ? submitEdit : isOneWay ? submitOneWay : submitTwoWayWrite;
  const submitLabel = mode === "back" ? "Send review" : mode === "edit" ? "Save changes" : isOneWay ? "Post review" : "Send review";
  const needsConfirm = mode === "write" && !isOneWay;
  const disabled = busy || !overall || (needsConfirm && !confirmed);
  const title = mode === "back" ? `Review ${targetName} back` : mode === "edit" ? "Edit your review" : `Review ${targetName}`;
  const helper = mode === "back" ? "When you send this, both reviews go live right away."
    : mode === "edit" ? "Editing does not restart the 7 days."
    : !isOneWay ? `Your review stays private until ${targetName} reviews you back or 7 days pass. We'll remind them on day 3 and day 6.`
    : null;

  return (
    <KeyboardFormScreen
      title={title}
      testID="mutual-review-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={[
            { title: "Cancel", variant: "ghost", onPress: () => router.back(), testID: "review-cancel-btn" },
            { title: submitLabel, variant: "teal", onPress: onSubmit, loading: busy, disabled, weight: 1.4, testID: "review-submit-btn" },
          ]}
        />
      }
    >
      <View style={{ gap: 14 }}>
        <View style={[styles.overallBox, { borderColor: colors.accent, backgroundColor: colors.tealSoft }]}>
          <Text style={{ color: colors.onSurface, fontWeight: "800" }}>Overall <Text style={{ color: colors.error }}>*</Text></Text>
          <Stars value={overall} onChange={setOverall} testID={isOneWay ? "oneway-star" : "star-overall"} />
        </View>

        {helper ? <Text testID="review-helper" style={{ color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 }}>{helper}</Text> : null}

        {!isOneWay ? (
          <>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1 }}>OPTIONAL RATINGS</Text>
            <View style={[styles.factors, { borderColor: colors.border }]}>
              {FACTORS.map((f, i) => (
                <View key={f.key} style={[styles.factorRow, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null]}>
                  <Text numberOfLines={1} style={{ color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600", marginBottom: 6 }}>{f.label}</Text>
                  <Stars value={ratings[f.key]} onChange={(n) => setRatings((r) => ({ ...r, [f.key]: n }))} testID={`star-${f.key}`} size={26} />
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View onLayout={commentKb.onLayout}>
          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 6 }}>COMMENT (OPTIONAL)</Text>
          <TextInput testID={isOneWay ? "oneway-comment" : "mutual-review-comment"} value={comment} onFocus={commentKb.onFocus} onChangeText={(t) => setComment(t.slice(0, COMMENT_MAX))} multiline
            placeholder={isOneWay ? "Share your experience with this organization." : "A quick note the other side will see once it goes live."} placeholderTextColor={colors.muted} style={field} />
          <Text testID="comment-counter" style={{ color: colors.muted, fontSize: 11, textAlign: "right", marginTop: 2 }}>{comment.length}/{COMMENT_MAX}</Text>
        </View>

        {(mode === "write" || mode === "edit") && !isOneWay ? (
          <View onLayout={contextKb.onLayout}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 6 }}>WHAT WAS THIS FOR?</Text>
            <TextInput testID="context-note" value={contextNote} onFocus={contextKb.onFocus} onChangeText={(t) => setContextNote(t.slice(0, CONTEXT_MAX))}
              placeholder="Rigging job, delivery, race crew." placeholderTextColor={colors.muted} style={[field, { minHeight: 0 }]} />
            <Text testID="context-counter" style={{ color: colors.muted, fontSize: 11, textAlign: "right", marginTop: 2 }}>{contextNote.length}/{CONTEXT_MAX}</Text>
          </View>
        ) : null}

        {mode === "write" && !isOneWay ? (
          <Pressable testID="confirm-relationship" onPress={() => setConfirmed((v) => !v)} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, minHeight: 44 }}>
            <Icon name={confirmed ? "checkbox" : "square-outline"} size={22} color={confirmed ? colors.teal : colors.muted} footprint={22} />
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, flex: 1, marginTop: 1 }}>{confirmText}</Text>
          </Pressable>
        ) : null}

        {err ? <Text testID="review-error" style={{ color: colors.error, fontSize: 13.5 }}>{err}</Text> : null}
      </View>
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  overallBox: { borderWidth: 1.5, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  factors: { borderWidth: 1, borderRadius: 12 },
  factorRow: { paddingHorizontal: 12, paddingVertical: 10 },
});
