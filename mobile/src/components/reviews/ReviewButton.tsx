import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";

type ReasonCode =
  | "ok" | "self" | "not_allowed" | "upgrade_required"
  | "switch_to_personal" | "shared_category" | "already_reviewed";

type Elig = {
  can_review: boolean;
  reason_code: ReasonCode;
  reason?: string;
  relationship?: "customer_pro" | "owner_crew" | "organization" | "pro_pro" | "sailor_sailor" | "owner_owner";
  review_type?: "two_way" | "one_way";
  prompt?: string;
};

/**
 * Entry point for writing a review. The can-review probe drives it:
 *  - ok -> "Write a review" (opens the full-screen compose route with
 *    target_identity so a Boat Pro business listing vs personal profile is sent).
 *  - upgrade_required -> "See plans" line.
 *  - switch_to_personal / shared_category / already_reviewed -> a clear message
 *    (no silent failure) using the backend's disabled reason.
 *  - self / not_allowed / signed out -> nothing.
 * `targetIdentity` = "business" from a Boat Pro business listing, "personal" from
 * a personal profile. openSignal lets a parent (post-Hired prompt) open the form.
 */
export function ReviewButton({
  targetId,
  targetName,
  targetIdentity,
  openSignal = 0,
}: {
  targetId: string;
  targetName?: string;
  targetIdentity?: "business" | "personal";
  openSignal?: number;
}) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const [elig, setElig] = useState<Elig | null>(null);

  const loadElig = useCallback(() => {
    if (!user || user.user_id === targetId) { setElig(null); return; }
    api.get<Elig>(`/reviews/can-review/${targetId}`).then(setElig).catch(() => setElig(null));
  }, [user, targetId]);
  useEffect(() => { loadElig(); }, [loadElig]); // eslint-disable-line react-hooks/set-state-in-effect

  const open = useCallback(() => {
    if (!elig || elig.reason_code !== "ok") return;
    router.push({
      pathname: "/review-compose",
      params: {
        mode: "write",
        relationship: elig.relationship ?? "",
        counterpartyId: targetId,
        targetName: targetName ?? "",
        reviewType: elig.review_type ?? "two_way",
        prompt: elig.prompt ?? "",
        targetIdentity: targetIdentity ?? "",
      },
    } as any);
  }, [elig, targetId, targetName, targetIdentity]);

  useEffect(() => { if (openSignal > 0) open(); }, [openSignal]); // eslint-disable-line

  if (!user || user.user_id === targetId || !elig) return null;
  if (elig.reason_code === "not_allowed" || elig.reason_code === "self") return null;

  if (elig.reason_code === "upgrade_required") {
    return (
      <Text testID="review-upgrade-line" style={{ color: colors.muted, fontSize: 14 }}>
        Reviews are for paid members.{" "}
        <Text testID="review-see-plans" onPress={() => router.push("/pricing" as any)} style={{ color: colors.tealText, fontWeight: "800" }}>See plans</Text>
      </Text>
    );
  }

  // Boat Pro -> Boat Pro disabled states: show a clear message, never fail silently.
  if (elig.reason_code === "switch_to_personal" || elig.reason_code === "shared_category" || elig.reason_code === "already_reviewed") {
    const msg = elig.reason_code === "switch_to_personal"
      ? "To review another Boat Pro, switch to your personal profile (on the web for now)."
      : elig.reason_code === "shared_category"
      ? (elig.reason || "You can't review a Boat Pro in the same category.")
      : (elig.reason || "You've already reviewed each other.");
    return (
      <View testID={`review-blocked-${elig.reason_code}`} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 12 }}>
        <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, lineHeight: 19 }}>{msg}</Text>
      </View>
    );
  }

  if (elig.reason_code !== "ok") return null;

  return <Button title="Write a review" icon="star-outline" onPress={open} testID="write-review-btn" />;
}
