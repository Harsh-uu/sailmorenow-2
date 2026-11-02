import { useEffect, useState } from "react";
import { Icon } from "@/src/components/Icon";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "@/src/lib/api";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";
import { useAuth } from "@/src/context/AuthContext";
import { canParticipate } from "@/src/lib/plan";

// Up/down reactions with visible counts. Works for post | discussion | comment.
export function Reactions({ targetType, targetId }: { targetType: string; targetId: string }) {
  const { colors } = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const [state, setState] = useState<{ up: number; down: number; mine: number }>({ up: 0, down: 0, mine: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/reactions/${targetType}/${targetId}`).then((d) => alive && setState(d)).catch(() => {});
    return () => { alive = false; };
  }, [targetType, targetId]);

  const react = async (value: number) => {
    if (busy) return;
    // Free accounts can browse but not react. Nudge with a toast and stay put
    // (no redirect). If we're unsure, we still call and treat a 403 the same way.
    if (!canParticipate(user)) { toast.warning("Upgrade to react to posts"); return; }
    setBusy(true);
    try {
      const d = await api.post(`/reactions`, { target_type: targetType, target_id: targetId, value });
      setState(d);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 402 || e.status === 403) && e.code === "upgrade_required") {
        toast.warning("Upgrade to react to posts");
      } else {
        toast.error("Couldn't save your reaction");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.row}>
      <Pressable testID={`react-up-${targetId}`} onPress={() => react(1)} style={[styles.btn, { backgroundColor: state.mine === 1 ? colors.tealSoft : colors.surfaceSecondary, borderColor: state.mine === 1 ? colors.teal : colors.border }]}>
        <Icon name={state.mine === 1 ? "thumbs-up" : "thumbs-up-outline"} size={16} color={state.mine === 1 ? colors.teal : colors.muted}  footprint={16}/>
        <Text style={[styles.count, { color: state.mine === 1 ? colors.navy : colors.onSurfaceSecondary }]}>{state.up}</Text>
      </Pressable>
      <Pressable testID={`react-down-${targetId}`} onPress={() => react(-1)} style={[styles.btn, { backgroundColor: state.mine === -1 ? colors.accentSoft : colors.surfaceSecondary, borderColor: state.mine === -1 ? colors.accent : colors.border }]}>
        <Icon name={state.mine === -1 ? "thumbs-down" : "thumbs-down-outline"} size={16} color={state.mine === -1 ? colors.warning : colors.muted}  footprint={16}/>
        <Text style={[styles.count, { color: state.mine === -1 ? colors.warning : colors.onSurfaceSecondary }]}>{state.down}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  count: { fontWeight: "700", fontSize: 14 },
});
