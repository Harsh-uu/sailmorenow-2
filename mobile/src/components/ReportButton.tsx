import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { useTheme } from "@/src/theme";
import { useAuth } from "@/src/context/AuthContext";

type Props = { targetType: "post" | "discussion" | "comment" | "event"; targetId: string; ownerId?: string; compact?: boolean };

// Opens the full-screen Report form (was a Modal sheet) so its input is never
// covered by the keyboard.
export function ReportButton({ targetType, targetId, ownerId, compact = false }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  if (!user || (ownerId && ownerId === user.user_id)) return null;

  const open = () => router.push({ pathname: "/report", params: { targetType, targetId } } as any);

  return (
    <Pressable testID={`flag-${targetType}-${targetId}`} onPress={open} hitSlop={8}
      style={compact ? undefined : { flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Icon name="flag-outline" size={compact ? 16 : 14} color={colors.muted} footprint={compact ? 16 : 14} />
      {!compact ? <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "600" }}>Report</Text> : null}
    </Pressable>
  );
}
