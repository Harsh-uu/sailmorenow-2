import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { MotionModal as Modal } from "@/src/components/MotionModal";
import { Avatar } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

type Ctx = { show: (handle: string, base?: string) => void };
const PreviewCtx = createContext<Ctx>({ show: () => {} });
export const useProfilePreview = () => useContext(PreviewCtx);

const ROLE_LABELS: Record<string, string> = {
  boat_owner: "Boat Owner", boat_pro: "Boat Pro", crew: "Crew",
  organization: "Club / Org", club: "Club / Org", sailor: "Sailor",
};

export function ProfilePreviewProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [handle, setHandle] = useState<string | null>(null);
  const [base, setBase] = useState("");
  const [data, setData] = useState<any>(null);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  const show = useCallback((h: string, b: string = "") => { if (h) { setBase(b); setHandle(h); setData(null); } }, []);
  const close = () => { setHandle(null); setData(null); };

  useEffect(() => {
    if (!handle) return;
    let active = true;
    api.get<any>(`/u/${handle}`).then((d) => { if (active) { setData(d); setFollowing(!!d.is_following); } }).catch(() => {});
    return () => { active = false; };
  }, [handle]);

  const u = data?.user;
  const toggleFollow = async () => {
    if (!u) return;
    setBusy(true);
    try {
      if (following) { await api.del(`/follows/${u.user_id}`); setFollowing(false); }
      else { await api.post(`/follows/${u.user_id}`, {}); setFollowing(true); }
    } catch (e: any) { toast.error(e?.message || "Couldn't update follow"); }
    finally { setBusy(false); }
  };
  const viewProfile = () => { const h = handle; const b = base; close(); if (h) router.push(`${b}/u/${h}` as any); };

  return (
    <PreviewCtx.Provider value={{ show }}>
      {children}
      <Modal visible={!!handle} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            {!u ? (
              <Text style={{ color: colors.muted, textAlign: "center", paddingVertical: 24 }}>Loading…</Text>
            ) : (
              <View testID="profile-preview-card">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Avatar uri={u.picture || u.avatar} name={u.name} size={56} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: "800", color: colors.onSurface }} numberOfLines={1}>{u.name || "Member"}</Text>
                    <Text style={{ fontSize: 12.5, color: colors.muted }} numberOfLines={1}>
                      {(ROLE_LABELS[u.account_type] || "Member")}{u.primary_market ? ` · ${u.primary_market}` : ""}
                    </Text>
                  </View>
                </View>
                {u.bio ? <Text style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, marginTop: 10 }} numberOfLines={3}>{u.bio}</Text> : null}
                <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                  {user && user.user_id !== u.user_id ? (
                    <Pressable testID="preview-follow-btn" onPress={toggleFollow} disabled={busy}
                      style={{ flex: 1, borderRadius: 999, paddingVertical: 11, alignItems: "center", backgroundColor: following ? colors.surfaceSecondary : colors.accent, opacity: busy ? 0.6 : 1 }}>
                      <Text style={{ fontWeight: "800", fontSize: 13.5, color: following ? colors.onSurfaceSecondary : colors.onAccent }}>{following ? "Following" : "Follow"}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable testID="preview-view-profile" onPress={viewProfile}
                    style={{ flex: 1, borderRadius: 999, paddingVertical: 11, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ fontWeight: "800", fontSize: 13.5, color: colors.onSurface }}>View profile</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </PreviewCtx.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 },
});
