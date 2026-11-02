import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { Avatar, Button } from "@/src/components/ui";
import { LogoCircle } from "@/src/components/LogoCircle";
import { api, ApiError } from "@/src/lib/api";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";
import { FACTORS, FactorList, OverallLine, Stars, fmtReviewDate } from "@/src/components/reviews/ratings";

function ReviewAuthor({ a }: { a: any }) {
  const { colors } = useTheme();
  const isPro = a?.account_type === "boat_pro" && a?.business_name;
  const name = isPro ? a.business_name : (a?.name || "A member");
  const go = () => {
    if (isPro && a?.business_listing_id) router.push(`/directory/pro/${a.business_listing_id}` as any);
    else if (a?.handle) router.push(`/profile/u/${a.handle}` as any);
  };
  return (
    <Pressable onPress={go} style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
      {isPro ? (
        <LogoCircle uri={a.business_logo} size={36} fallback={<Icon name="briefcase-outline" size={18} color={colors.muted} footprint={18} />} />
      ) : (
        <Avatar uri={a?.avatar} name={name} size={36} />
      )}
      <Text numberOfLines={2} style={{ color: colors.onSurface, fontWeight: "700", fontSize: 14, flex: 1, flexShrink: 1 }}>{name}</Text>
    </Pressable>
  );
}

/**
 * One review section per page (GET /reviews/list/{targetId}). Boat Pro / member
 * targets show the Overall summary plus factor averages that have >=1 rating;
 * org targets show a single Overall line. Then the live reviews, newest first,
 * 5 at a time with "Show more".
 */
export function ReviewsSection({ targetId, kind = "member", identity = "business", refreshKey = 0 }: { targetId: string; kind?: "member" | "org"; identity?: "business" | "personal"; refreshKey?: number }) {
  const { colors } = useTheme();
  const toast = useToast();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<any>(null);
  const [limit, setLimit] = useState(5);

  const load = useCallback(() => {
    setState("loading");
    api.get<any>(`/reviews/list/${targetId}?limit=100&identity=${identity}`).then((d) => { setData(d); setState("ready"); }).catch(() => setState("error"));
  }, [targetId, identity]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const confirmDelete = (r: any) => {
    const url = r.type === "two_way"
      ? `/review-sessions/${r.review_session_id}/review/${r.review_author_id}`
      : `/reviews/${r.id}`;
    Alert.alert("Delete this review?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete review", style: "destructive", onPress: async () => {
        try { await api.del(url); toast.success("Review deleted"); load(); }
        catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't delete review"); }
      } },
    ]);
  };

  const summary = data?.summary || {};
  const reviews: any[] = data?.reviews || [];
  const shown = reviews.slice(0, limit);
  const isOrg = kind === "org" || summary.target_type === "organization";
  const countLabel = `${summary.count || 0} review${summary.count === 1 ? "" : "s"}`;
  const factorRows = FACTORS.filter((f) => summary[f.key] != null).map((f) => ({ key: f.key, label: f.label, value: summary[f.key] }));

  return (
    <View style={{ marginTop: 10 }} testID="reviews-section">
      {state === "ready" && summary.overall != null ? (
        isOrg ? (
          <View testID="reviews-summary-overall" style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text numberOfLines={1} style={{ color: colors.onSurface, fontWeight: "800", fontSize: 14 }}>Overall {Number(summary.overall).toFixed(1)}</Text>
            <Stars value={summary.overall} />
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 13 }}>· {countLabel}</Text>
          </View>
        ) : (
          <View testID="reviews-summary-overall" style={{ gap: 8 }}>
            <View>
              <Text numberOfLines={2} style={{ color: colors.onSurface, fontWeight: "800", fontSize: 14 }}>Overall {Number(summary.overall).toFixed(1)} <Text style={{ color: colors.muted, fontWeight: "500" }}>· {countLabel}</Text></Text>
              <View style={{ marginTop: 1, alignSelf: "flex-start" }}><Stars value={summary.overall} /></View>
            </View>
            <FactorList rows={factorRows} />
          </View>
        )
      ) : null}

      {state === "loading" ? (
        <Text style={{ color: colors.muted, marginTop: 8 }} testID="reviews-section-loading">Loading reviews…</Text>
      ) : null}

      {state === "error" ? (
        <View style={{ marginTop: 10, alignItems: "flex-start", gap: 8 }} testID="reviews-section-error">
          <Text style={{ color: colors.error, fontSize: 13.5 }}>We couldn&apos;t load reviews.</Text>
          <Button title="Retry" variant="secondary" onPress={load} testID="reviews-section-retry" />
        </View>
      ) : null}

      {state === "ready" && reviews.length === 0 ? (
        <Text style={{ color: colors.muted, marginTop: 10 }} testID="reviews-section-empty">No reviews yet.</Text>
      ) : null}

      {state === "ready" && reviews.length > 0 ? (
        <View style={{ marginTop: 14, gap: 10 }}>
          {shown.map((r) => {
            const rows = FACTORS.filter((f) => r.ratings && r.ratings[f.key]).map((f) => ({ key: f.key, label: f.label, value: r.ratings[f.key] }));
            return (
              <View key={r.id} testID={`review-item-${r.id}`} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ReviewAuthor a={r.author} />
                  <View style={{ alignItems: "flex-end" }}>
                    <Stars value={r.overall} size={14} />
                    {r.created_at ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>{fmtReviewDate(r.created_at)}</Text> : null}
                  </View>
                </View>
                {r.comment ? <Text style={{ color: colors.onSurfaceSecondary, fontSize: 14, fontStyle: "italic", marginTop: 8, lineHeight: 20 }}>&ldquo;{r.comment}&rdquo;</Text> : null}
                {rows.length > 0 ? <View style={{ marginTop: 8 }}><FactorList rows={rows} /></View> : null}
                {r.reply ? (
                  <View testID={`review-reply-${r.id}`} style={{ marginTop: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 12 }}>
                    <Text style={{ color: colors.tealText, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" }}>Reply from {r.reply.author_name || "the reviewed party"}</Text>
                    <Text style={{ color: colors.onSurface, fontSize: 14, marginTop: 4, lineHeight: 20 }}>{r.reply.text}</Text>
                  </View>
                ) : null}
                {r.can_delete ? (
                  <View style={{ flexDirection: "row", marginTop: 12 }}>
                    <Button title="Delete" variant="danger" icon="trash-outline" onPress={() => confirmDelete(r)} testID={`review-delete-${r.id}`} style={{ height: 44, paddingHorizontal: 20 }} />
                  </View>
                ) : null}
              </View>
            );
          })}
          {reviews.length > limit ? (
            <Button title="Show more" variant="secondary" onPress={() => setLimit((l) => l + 5)} testID="reviews-show-more" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
});
